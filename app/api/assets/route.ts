import { ok, handle } from "@/lib/api";
import { db } from "@/lib/db";
import { getMark } from "@/lib/prices";

// GET /api/assets — enabled assets with live marks (§11). Public (no auth).
export const GET = handle(async () => {
  const assets = await db.asset.findMany({
    where: { enabled: true },
    orderBy: { symbol: "asc" },
  });

  const withMarks = await Promise.all(
    assets.map(async (a) => {
      let markCents: bigint | null = null;
      let markScaledCents: bigint | null = null;
      let asOf: Date | null = null;
      try {
        const q = await getMark(a.symbol);
        markCents = q.cents;
        markScaledCents = q.scaledCents;
        asOf = q.asOf;
      } catch {
        // Leave mark null if pricing is unavailable/stale for this symbol.
      }
      return {
        symbol: a.symbol,
        name: a.name,
        kind: a.kind,
        decimals: a.decimals,
        ltvBps: a.ltvBps,
        unitLabel: a.unitLabel,
        markCents,
        markScaledCents,
        asOf,
      };
    })
  );

  return ok({ assets: withMarks });
});
