/**
 * Get-back-collateral flows (§9.3).
 *   - Pay ETH: quote the ETH owed (+50 bps), player sends it, the watcher marks
 *     it PAID and a payout releases the asset.
 *   - Settle with chips: burn chips equal to the debt, release the asset.
 * Full redemption only (partial is a later enhancement). The asset release is an
 * outbound token transfer handled by the payout worker.
 */
import { db } from "./db";
import { getEthUsd } from "./prices";
import { ethOwedWei, applyBps } from "./money";
import { ApiError } from "./errors";
import { InsufficientChipsError, withTxRetry, applyLedger } from "./ledger";
import { treasuryAddress } from "./treasury/signer";
import { normalizeAddress } from "./auth";

const QUOTE_TTL_MS = 120_000; // 120s
const REDEEM_FEE_BPS = 50;

export interface RedeemQuote {
  redemptionId: string;
  positionId: string;
  debtCents: bigint;
  ethOwedWei: bigint;
  treasuryAddress: string;
  expiresAt: Date;
}

export async function quoteRedeem(userId: string, positionId: string): Promise<RedeemQuote> {
  const position = await db.position.findUnique({ where: { id: positionId } });
  if (!position || position.userId !== userId) throw new ApiError("NO_TICKET", "No such ticket.", 404);
  if (position.status !== "OPEN") throw new ApiError("NOT_OPEN", "This ticket can't be redeemed.", 409);

  const eth = await getEthUsd();
  const base = ethOwedWei(position.debtCents, eth.cents);
  const total = base + applyBps(base, REDEEM_FEE_BPS);
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);

  const redemption = await db.redemption.create({
    data: {
      positionId: position.id,
      method: "ETH",
      quotedEthWei: total.toString(),
      quoteExpires: expiresAt,
      status: "QUOTED",
    },
  });

  return {
    redemptionId: redemption.id,
    positionId: position.id,
    debtCents: position.debtCents,
    ethOwedWei: total,
    treasuryAddress: treasuryAddress(),
    expiresAt,
  };
}

export async function redeemWithChips(userId: string, positionId: string) {
  return withTxRetry(async (tx) => {
    const position = await tx.position.findUnique({
      where: { id: positionId },
      include: { asset: true },
    });
    if (!position || position.userId !== userId) throw new ApiError("NO_TICKET", "No such ticket.", 404);
    if (position.status !== "OPEN") throw new ApiError("NOT_OPEN", "This ticket can't be settled.", 409);

    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.chipsCents < position.debtCents) {
      throw new InsufficientChipsError(position.debtCents - user.chipsCents);
    }

    await applyLedger({
      tx,
      userId,
      deltaCents: -position.debtCents,
      reason: "REDEEM_BURN",
      refType: "Position",
      refId: position.id,
    });

    await tx.position.update({
      where: { id: position.id },
      data: { debtCents: 0n, status: "SETTLING" },
    });
    await tx.redemption.create({
      data: {
        positionId: position.id,
        method: "CHIPS",
        chipsBurned: position.debtCents,
        status: "PAID",
      },
    });

    // Queue the on-chain asset release (idempotent per position).
    await tx.payout.create({
      data: {
        userId,
        kind: "COLLATERAL_RELEASE",
        amountWei: "0",
        toAddress: normalizeAddress(user.address),
        tokenAddress: position.asset.tokenAddress,
        tokenAmountRaw: position.qtyRaw,
        positionId: position.id,
        idempotencyKey: `release:${position.id}`,
      },
    });

    return { positionId: position.id, status: "SETTLING" as const };
  });
}

/**
 * Watcher entry: an inbound ETH payment to the treasury matched to a QUOTED
 * redemption. Marks it PAID and queues the asset release. Idempotent.
 */
export async function settleConfirmedRedemption(args: {
  fromAddress: string;
  valueWei: bigint;
  txHash: string;
  logIndex: number;
}): Promise<"paid" | "duplicate" | "no-quote" | "no-user"> {
  const from = normalizeAddress(args.fromAddress);
  return withTxRetry(async (tx) => {
    const dup = await tx.processedTx.findUnique({
      where: { txHash_logIndex: { txHash: args.txHash, logIndex: args.logIndex } },
    });
    if (dup) return "duplicate";
    await tx.processedTx.create({
      data: { txHash: args.txHash, logIndex: args.logIndex, kind: "REDEEM_ETH" },
    });

    const user = await tx.user.findUnique({ where: { address: from } });
    if (!user) return "no-user";

    // Match a live quote for one of this user's positions, by exact amount.
    const redemption = await tx.redemption.findFirst({
      where: {
        method: "ETH",
        status: "QUOTED",
        quotedEthWei: args.valueWei.toString(),
        quoteExpires: { gt: new Date() },
        position: { userId: user.id, status: "OPEN" },
      },
      orderBy: { createdAt: "asc" },
      include: { position: { include: { asset: true } } },
    });
    if (!redemption) return "no-quote";

    await tx.redemption.update({
      where: { id: redemption.id },
      data: { status: "PAID", paidTxHash: args.txHash },
    });
    await tx.position.update({
      where: { id: redemption.positionId },
      data: { debtCents: 0n, status: "SETTLING" },
    });
    await tx.payout.create({
      data: {
        userId: user.id,
        kind: "COLLATERAL_RELEASE",
        amountWei: "0",
        toAddress: from,
        tokenAddress: redemption.position.asset.tokenAddress,
        tokenAmountRaw: redemption.position.qtyRaw,
        positionId: redemption.positionId,
        idempotencyKey: `release:${redemption.positionId}`,
      },
    });

    return "paid";
  });
}
