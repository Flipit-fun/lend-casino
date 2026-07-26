/**
 * Round reaper (§10.4). Voids ACTIVE game rounds older than 30 minutes and
 * refunds the stake, so abandoned hands don't lock chips forever.
 */
import { db } from "../lib/db";
import { applyLedger } from "../lib/ledger";

const MAX_AGE_MS = 30 * 60 * 1000;

export async function runReaperOnce(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_AGE_MS);
  const stale = await db.gameRound.findMany({
    where: { status: "ACTIVE", createdAt: { lt: cutoff } },
    select: { id: true, userId: true, stakeCents: true },
  });

  for (const r of stale) {
    // Refund the stake (idempotent) and void the round.
    await applyLedger({
      userId: r.userId,
      deltaCents: r.stakeCents,
      reason: "BET_RETURN",
      refType: "GameRound",
      refId: r.id,
      idempotencyKey: `void:${r.id}`,
    });
    await db.gameRound.update({ where: { id: r.id }, data: { status: "VOIDED", settledAt: new Date() } });
  }
}
