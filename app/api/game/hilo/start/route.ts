import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { idempotencyKey } from "@/lib/http";
import { startRound } from "@/lib/stateful";
import { cardView } from "@/lib/games/cards";
import { rateLimit } from "@/lib/ratelimit";

const bodySchema = z.object({ stakeCents: z.number().int().positive() });

const SEQ = 60; // pre-derived upcoming cards (hidden); plenty for any chain

// POST /api/game/hilo/start (§10.3)
export const POST = handle(async (req) => {
  const user = await requireUser();
  await rateLimit(user.id, "hilo");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Set a stake.", 400);

  const started = await startRound({
    userId: user.id,
    game: "HILO",
    stakeCents: BigInt(parsed.data.stakeCents),
    idempotencyKey: idempotencyKey(req),
    build: (src) => {
      const cards = Array.from({ length: SEQ }, () => ({ v: src.int(13) + 1, s: src.int(4) }));
      return { cards, idx: 1, multBps: 10_000, calls: 0 };
    },
  });

  const first = (started.state.cards as { v: number; s: number }[])[0];
  return ok({
    roundId: started.roundId,
    card: cardView(first.v, first.s),
    multBps: 10_000,
    calls: 0,
    balanceAfter: started.balanceAfter,
  });
});
