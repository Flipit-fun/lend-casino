import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { idempotencyKey } from "@/lib/http";
import { settleStateless } from "@/lib/gameplay";
import { rateLimit } from "@/lib/ratelimit";
import { drawSlots, resolveSlots } from "@/lib/games/slots";

const bodySchema = z.object({
  stakeCents: z.number().int().positive(),
});

// POST /api/game/slots (§10.2)
export const POST = handle(async (req) => {
  const user = await requireUser();
  await rateLimit(user.id, "slots");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Set a stake first.", 400);

  const stakeCents = BigInt(parsed.data.stakeCents);
  const result = await settleStateless({
    userId: user.id,
    game: "SLOTS",
    stakeCents,
    idempotencyKey: idempotencyKey(req),
    resolve: (src) => {
      const { indices, reels } = drawSlots(src);
      const returnCents = resolveSlots(stakeCents, reels);
      return { returnCents, outcome: { indices, reels, win: returnCents > 0n } };
    },
  });

  return ok(result);
});
