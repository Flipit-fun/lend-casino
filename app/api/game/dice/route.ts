import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { idempotencyKey } from "@/lib/http";
import { settleStateless } from "@/lib/gameplay";
import { rateLimit } from "@/lib/ratelimit";
import { drawDice, resolveDice, DICE_MIN_TARGET, DICE_MAX_TARGET } from "@/lib/games/dice";

const bodySchema = z.object({
  target: z.number().int().min(DICE_MIN_TARGET).max(DICE_MAX_TARGET),
  stakeCents: z.number().int().positive(),
});

// POST /api/game/dice (§10.2)
export const POST = handle(async (req) => {
  const user = await requireUser();
  await rateLimit(user.id, "dice");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Set a line (2–95) and a stake.", 400);

  const stakeCents = BigInt(parsed.data.stakeCents);
  const { target } = parsed.data;
  const result = await settleStateless({
    userId: user.id,
    game: "DICE",
    stakeCents,
    idempotencyKey: idempotencyKey(req),
    resolve: (src) => {
      const roll = drawDice(src);
      const returnCents = resolveDice(target, stakeCents, roll);
      return { returnCents, outcome: { roll, target, win: returnCents > 0n } };
    },
  });

  return ok(result);
});
