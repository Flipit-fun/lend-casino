import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { idempotencyKey } from "@/lib/http";
import { startRound } from "@/lib/stateful";
import { rateLimit } from "@/lib/ratelimit";
import { placeMines, minesMultBps, MINES_TILES } from "@/lib/games/mines";

const bodySchema = z.object({
  mines: z.number().int().min(1).max(24),
  stakeCents: z.number().int().positive(),
});

// POST /api/game/mines/start (§10.3)
export const POST = handle(async (req) => {
  const user = await requireUser();
  await rateLimit(user.id, "mines");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Choose 1–24 mines and a stake.", 400);

  const { mines, stakeCents } = parsed.data;
  const started = await startRound({
    userId: user.id,
    game: "MINES",
    stakeCents: BigInt(stakeCents),
    idempotencyKey: idempotencyKey(req),
    build: (src) => ({ mines, bombs: [...placeMines(mines, src)], picks: [] }),
  });

  // Never expose bomb positions while the round is live.
  return ok({
    roundId: started.roundId,
    mines,
    tiles: MINES_TILES,
    picks: [],
    multBps: 10_000,
    nextMultBps: Number(minesMultBps(1, mines)),
    balanceAfter: started.balanceAfter,
  });
});
