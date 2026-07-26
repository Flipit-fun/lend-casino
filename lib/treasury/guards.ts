/**
 * Treasury guardrails (§6). Solvency is checked before every payout; the
 * exposure ceiling is checked before every chip sale. Both read the live
 * treasury ETH balance.
 */
import { getPublicClient } from "../chain";
import { treasuryAddress } from "./signer";
import { db } from "../db";
import { serverEnv, sellPolicy } from "../env";
import { getEthUsd } from "../prices";
import { ethOwedWei, mulDivFloor } from "../money";

const GAS_BUFFER_WEI = 1_000_000_000_000_000n; // ~0.001 ETH headroom for gas

export async function treasuryEthWei(): Promise<bigint> {
  return getPublicClient().getBalance({ address: treasuryAddress() });
}

/** ETH already committed to payouts not yet confirmed. */
export async function pendingPayoutWei(): Promise<bigint> {
  const rows = await db.payout.findMany({
    where: { kind: "CHIP_SALE", status: { in: ["QUEUED", "SENDING", "SENT"] } },
    select: { amountWei: true },
  });
  return rows.reduce((a, r) => a + BigInt(r.amountWei), 0n);
}

export interface SolvencyCheck {
  ok: boolean;
  balanceWei: bigint;
  pendingWei: bigint;
  requiredWei: bigint;
}

/** balance − pending ≥ amount + gasBuffer (§6.1). Never partially pay. */
export async function checkSolvency(amountWei: bigint): Promise<SolvencyCheck> {
  const [balanceWei, pendingWei] = await Promise.all([treasuryEthWei(), pendingPayoutWei()]);
  const requiredWei = amountWei + GAS_BUFFER_WEI;
  return { ok: balanceWei - pendingWei >= requiredWei, balanceWei, pendingWei, requiredWei };
}

/**
 * Exposure ceiling (§6.2): total sellable chips (in ETH terms) must stay under
 * 80% of the treasury balance. Returns whether a sale of `saleCents` keeps us
 * within the ceiling.
 */
export async function checkExposure(saleCents: bigint): Promise<{ ok: boolean }> {
  const [{ _sum: chipSum }, { _sum: debtSum }] = await Promise.all([
    db.user.aggregate({ _sum: { chipsCents: true } }),
    db.position.aggregate({ _sum: { debtCents: true }, where: { status: "OPEN" } }),
  ]);
  const totalChips = chipSum.chipsCents ?? 0n;
  const totalDebt = debtSum.debtCents ?? 0n;

  const sellableCents =
    sellPolicy() === "full" ? totalChips : totalChips - totalDebt > 0n ? totalChips - totalDebt : 0n;

  const eth = await getEthUsd();
  const exposureWei = ethOwedWei(sellableCents, eth.cents); // current sellable in ETH
  const saleWei = ethOwedWei(saleCents, eth.cents);
  const balanceWei = await treasuryEthWei();
  const ceilingWei = mulDivFloor(balanceWei, 8000n, 10_000n); // 80%

  return { ok: exposureWei + saleWei <= ceilingWei };
}

export function caps() {
  const env = serverEnv();
  return { perTxWei: env.PAYOUT_PER_TX_CAP_WEI, dailyWei: env.PAYOUT_DAILY_CAP_WEI };
}
