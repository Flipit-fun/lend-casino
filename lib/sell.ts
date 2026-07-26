/**
 * Sell chips for ETH (§9.2). Under SELL_POLICY=full the whole balance is
 * sellable; under winnings_only only chips above open debt. A 50 bps fee is
 * taken in chips before conversion. The sale debits chips and queues an ETH
 * payout; the payout worker performs the solvency-checked send.
 */
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { getEthUsd } from "./prices";
import { ethOwedWei, applyBps } from "./money";
import { ApiError } from "./errors";
import { InsufficientChipsError, withTxRetry, applyLedger, totalDebtCents } from "./ledger";
import { sellPolicy } from "./env";
import { checkExposure, caps } from "./treasury/guards";
import { normalizeAddress } from "./auth";

const SELL_FEE_BPS = 50;

export interface SellResult {
  payoutId: string;
  chipsSold: bigint;
  feeChips: bigint;
  ethOutWei: bigint;
}

export async function sellChips(
  userId: string,
  chipsCents: bigint,
  idempotencyKey?: string
): Promise<SellResult> {
  if (chipsCents < 1n) throw new ApiError("BAD_AMOUNT", "Enter chips to sell.", 400);

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const debt = await totalDebtCents(userId);
  const sellable =
    sellPolicy() === "full" ? user.chipsCents : user.chipsCents - debt > 0n ? user.chipsCents - debt : 0n;
  if (chipsCents > sellable) {
    throw new ApiError("NOT_FREE", "You can only cash out your free chips.", 400);
  }

  // Exposure ceiling — honest close rather than a silent queue (§6.2).
  const exposure = await checkExposure(chipsCents);
  if (!exposure.ok) {
    throw new ApiError("WINDOW_CLOSED", "The cash-out window is closed while the treasury rebalances.", 503);
  }

  const feeChips = applyBps(chipsCents, SELL_FEE_BPS);
  const netCents = chipsCents - feeChips;
  const eth = await getEthUsd();
  const ethOutWei = ethOwedWei(netCents, eth.cents);

  if (ethOutWei > caps().perTxWei) {
    throw new ApiError("OVER_CAP", "That exceeds the per-transaction cash-out limit.", 400);
  }

  const key = idempotencyKey ?? `sell:${userId}:${randomUUID()}`;

  return withTxRetry(async (tx) => {
    const existing = await tx.payout.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      return {
        payoutId: existing.id,
        chipsSold: chipsCents,
        feeChips,
        ethOutWei: BigInt(existing.amountWei),
      };
    }

    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const fresh = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (fresh.chipsCents < chipsCents) throw new InsufficientChipsError(chipsCents - fresh.chipsCents);

    await applyLedger({
      tx,
      userId,
      deltaCents: -chipsCents,
      reason: "CHIP_SALE",
      refType: "Payout",
      refId: key,
    });

    const payout = await tx.payout.create({
      data: {
        userId,
        kind: "CHIP_SALE",
        amountWei: ethOutWei.toString(),
        toAddress: normalizeAddress(fresh.address),
        status: "QUEUED",
        idempotencyKey: key,
      },
    });

    return { payoutId: payout.id, chipsSold: chipsCents, feeChips, ethOutWei };
  });
}
