/**
 * Liquidation cron (§9.3). Every OPEN position with health below the 110% floor
 * (currentValue < debt × 1.10) is force-closed: marked LIQUIDATED, debt zeroed,
 * asset kept, and a LIQUIDATION ledger entry written.
 */
import { db } from "../lib/db";
import { getMark } from "../lib/prices";
import { mulDivFloor } from "../lib/money";

const HEALTH_FLOOR_BPS = 11_000n; // 110%

function alert(msg: string) {
  console.warn(`[ALERT] ${msg}`);
}

export async function runLiquidationOnce(): Promise<void> {
  const open = await db.position.findMany({ where: { status: "OPEN" }, include: { asset: true } });
  for (const p of open) {
    if (p.debtCents <= 0n) continue;
    let markCents: bigint;
    try {
      markCents = (await getMark(p.assetSymbol)).cents;
    } catch {
      continue; // don't liquidate on stale/unavailable pricing
    }
    const currentValue = mulDivFloor(BigInt(p.qtyRaw), markCents, 10n ** BigInt(p.asset.decimals));
    // currentValue < debt * 1.10  <=>  currentValue*10000 < debt*11000
    if (currentValue * 10_000n < p.debtCents * HEALTH_FLOOR_BPS) {
      await db.$transaction(async (tx) => {
        const fresh = await tx.position.findUnique({ where: { id: p.id } });
        if (!fresh || fresh.status !== "OPEN") return;
        await tx.position.update({
          where: { id: p.id },
          data: { status: "LIQUIDATED", debtCents: 0n, closedAt: new Date() },
        });
        const user = await tx.user.findUniqueOrThrow({ where: { id: p.userId } });
        await tx.ledgerEntry.create({
          data: {
            userId: p.userId,
            deltaCents: 0n, // liquidation seizes collateral; chip balance is unchanged
            balanceAfter: user.chipsCents,
            reason: "LIQUIDATION",
            refType: "Position",
            refId: p.id,
          },
        });
      });
      alert(`Liquidated position ${p.id} (${p.assetSymbol}) — value ${currentValue} < 110% of debt ${p.debtCents}.`);
    }
  }
}
