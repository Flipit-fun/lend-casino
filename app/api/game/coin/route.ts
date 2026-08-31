import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { idempotencyKey } from "@/lib/http";
import { settleStateless } from "@/lib/gameplay";
import { rateLimit } from "@/lib/ratelimit";
import { drawCoin, resolveCoin } from "@/lib/games/coin";

const bodySchema = z.object({
  side: z.enum(["H", "T"]),
  stakeCents: z.number().int().positive(),
});

// POST /api/game/coin (§10.2)
export const POST = handle(async (req) => {
  const user = await requireUser();
  await rateLimit(user.id, "coin");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Pick a side and a stake.", 400);

  const stakeCents = BigInt(parsed.data.stakeCents);
  const result = await settleStateless({
    userId: user.id,
    game: "COIN",
    stakeCents,
    idempotencyKey: idempotencyKey(req),
    resolve: (src) => {
      const outcome = drawCoin(src);
      const returnCents = resolveCoin(parsed.data.side, stakeCents, outcome);
      return { returnCents, outcome: { result: outcome, win: returnCents > 0n } };
    },
  });

  return ok(result);
});
