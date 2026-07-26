/**
 * Deposit intent / quoting (§9.1). The player is pledging collateral, not
 * buying chips: we quote a draw against a fresh mark, create a PENDING position
 * with a short expiry, and hand back the exact transfer to make. The deposit
 * watcher credits chips only once the on-chain transfer confirms.
 */
import { db } from "./db";
import { getMark, collateralValueCents, qtyRawFromUsdCents } from "./prices";
import { applyBps } from "./money";
import { ApiError } from "./errors";
import { treasuryAddress } from "./treasury/signer";

const INTENT_TTL_MS = 60_000; // 60s quote validity

export interface DepositQuote {
  positionId: string;
  symbol: string;
  qtyRaw: bigint;
  markPriceCents: bigint;
  valueCents: bigint;
  drawnCents: bigint;
  treasuryAddress: string;
  tokenAddress: string;
  expiresAt: Date;
}

export async function createDepositIntent(
  userId: string,
  symbol: string,
  usdCents: bigint
): Promise<DepositQuote> {
  const asset = await db.asset.findUnique({ where: { symbol: symbol.toUpperCase() } });
  if (!asset || !asset.enabled) throw new ApiError("NO_ASSET", "That asset isn't accepted.", 400);
  if (usdCents < 1n) throw new ApiError("BAD_AMOUNT", "Enter a dollar amount.", 400);

  const mark = await getMark(asset.symbol); // throws if stale

  // Convert the requested USD amount into a (fractional) token quantity in base
  // units, then re-derive the value/draw from that exact quantity.
  const qtyRaw = qtyRawFromUsdCents(usdCents, mark.scaledCents, asset.decimals);
  if (qtyRaw < BigInt(asset.minDepositRaw)) {
    throw new ApiError("MIN_DEPOSIT", "Amount is below the minimum for this asset.", 400);
  }

  const valueCents = collateralValueCents(qtyRaw, mark.scaledCents, asset.decimals);
  const drawnCents = applyBps(valueCents, asset.ltvBps);
  if (drawnCents < 1n) throw new ApiError("TOO_SMALL", "That deposit draws less than one chip.", 400);

  const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
  const position = await db.position.create({
    data: {
      userId,
      assetSymbol: asset.symbol,
      qtyRaw: qtyRaw.toString(),
      markPriceCents: mark.cents,
      valueCents,
      drawnCents,
      debtCents: drawnCents,
      status: "PENDING",
      intentExpires: expiresAt,
    },
  });

  return {
    positionId: position.id,
    symbol: asset.symbol,
    qtyRaw,
    markPriceCents: mark.cents,
    valueCents,
    drawnCents,
    treasuryAddress: treasuryAddress(),
    tokenAddress: asset.tokenAddress,
    expiresAt,
  };
}

import { withTxRetry, applyLedger } from "./ledger";
import { normalizeAddress } from "./auth";

export type DepositSettleOutcome =
  | "credited"
  | "requoted"
  | "duplicate"
  | "no-user"
  | "no-intent";

/**
 * Settle a confirmed inbound ERC-20 transfer to the treasury (§9.1). Matches a
 * PENDING position for the sender + token, credits the draw, and opens the
 * ticket. Idempotent via ProcessedTx. If the amount differs from the quote, the
 * draw is re-quoted at the current mark against the amount actually received.
 */
export async function settleConfirmedDeposit(args: {
  fromAddress: string;
  tokenAddress: string;
  receivedRaw: bigint;
  txHash: string;
  logIndex: number;
}): Promise<DepositSettleOutcome> {
  const from = normalizeAddress(args.fromAddress);
  const token = normalizeAddress(args.tokenAddress);

  return withTxRetry(async (tx) => {
    const dup = await tx.processedTx.findUnique({
      where: { txHash_logIndex: { txHash: args.txHash, logIndex: args.logIndex } },
    });
    if (dup) return "duplicate";
    await tx.processedTx.create({
      data: { txHash: args.txHash, logIndex: args.logIndex, kind: "DEPOSIT" },
    });

    const asset = await tx.asset.findFirst({ where: { tokenAddress: token } });
    if (!asset) return "no-intent";

    const user = await tx.user.findUnique({ where: { address: from } });
    if (!user) return "no-user"; // tokens from an address with no account — flag for review

    // Match any PENDING position for this sender + asset. We do NOT require the
    // quote to still be unexpired: a real on-chain deposit + confirmations takes
    // far longer than the 60s quote TTL, and the transfer is real regardless.
    // (If the quoted price is stale, the amount-mismatch path re-quotes below.)
    const position = await tx.position.findFirst({
      where: { userId: user.id, assetSymbol: asset.symbol, status: "PENDING" },
      orderBy: { openedAt: "asc" },
    });
    if (!position) return "no-intent"; // received tokens with no matching intent — flag for review

    let drawnCents = position.drawnCents;
    let valueCents = position.valueCents;
    let requoted = false;
    if (args.receivedRaw !== BigInt(position.qtyRaw)) {
      // Wrong amount: re-quote against what actually arrived, at the current mark.
      const mark = await getMark(asset.symbol);
      valueCents = collateralValueCents(args.receivedRaw, mark.scaledCents, asset.decimals);
      drawnCents = applyBps(valueCents, asset.ltvBps);
      requoted = true;
    }

    await tx.position.update({
      where: { id: position.id },
      data: {
        status: "OPEN",
        qtyRaw: args.receivedRaw.toString(),
        valueCents,
        drawnCents,
        debtCents: drawnCents,
        depositTxHash: args.txHash,
        intentExpires: null,
      },
    });

    await applyLedger({
      tx,
      userId: user.id,
      deltaCents: drawnCents,
      reason: "COLLATERAL_DRAW",
      refType: "Position",
      refId: position.id,
    });

    return requoted ? "requoted" : "credited";
  });
}
