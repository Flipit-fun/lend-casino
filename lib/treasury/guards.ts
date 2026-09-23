/**
 * Treasury guardrails (§6). Solvency is checked before every payout, against
 * the live treasury ETH balance.
 *
 * The aggregate exposure ceiling that used to gate chip sales (§6.2, "total
 * sellable chips must stay under 80% of the treasury balance") was removed:
 * it summed every user's balance, so long-dormant chips blocked cash-outs for
 * active players. Per-payout solvency in checkSolvency is the real protection —
 * the worker leaves a payout QUEUED rather than overdrawing the treasury.
 */
import { getPublicClient } from "../chain";
import { treasuryAddress } from "./signer";
import { db } from "../db";
import { treasuryCaps } from "../env";

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

export function caps() {
  const c = treasuryCaps();
  return { perTxWei: c.perTxWei, dailyWei: c.dailyWei };
}
