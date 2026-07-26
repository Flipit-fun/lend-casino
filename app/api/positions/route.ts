import { ok, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMark, collateralValueCents } from "@/lib/prices";

// GET /api/positions — open + closed tickets, with a live health figure (§9.3).
export const GET = handle(async () => {
  const user = await requireUser();
  const positions = await db.position.findMany({
    where: { userId: user.id, status: { in: ["OPEN", "SETTLING", "CLOSED", "LIQUIDATED"] } },
    orderBy: { openedAt: "desc" },
    include: { asset: true },
  });

  const out = await Promise.all(
    positions.map(async (p) => {
      let currentValueCents: bigint | null = null;
      let healthBps: number | null = null;
      if (p.status === "OPEN" || p.status === "SETTLING") {
        try {
          const mark = await getMark(p.assetSymbol);
          currentValueCents = collateralValueCents(BigInt(p.qtyRaw), mark.scaledCents, p.asset.decimals);
          if (p.debtCents > 0n) {
            healthBps = Number((currentValueCents * 10_000n) / p.debtCents);
          }
        } catch {
          /* leave null if pricing unavailable */
        }
      }
      return {
        id: p.id,
        ticketNo: p.ticketNo,
        symbol: p.assetSymbol,
        unitLabel: p.asset.unitLabel,
        qtyRaw: p.qtyRaw,
        markPriceCents: p.markPriceCents,
        valueCents: p.valueCents,
        drawnCents: p.drawnCents,
        debtCents: p.debtCents,
        currentValueCents,
        healthBps,
        status: p.status,
        openedAt: p.openedAt,
        closedAt: p.closedAt,
      };
    })
  );

  return ok({ positions: out });
});
