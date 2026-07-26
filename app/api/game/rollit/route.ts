import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { idempotencyKey } from "@/lib/http";
import { settleStateless } from "@/lib/gameplay";
import { rateLimit } from "@/lib/ratelimit";
import { drawRollit, resolveRollit, colorOf } from "@/lib/games/rollit";

const bodySchema = z.object({
  // bet key -> stake in cents (e.g. { "n:17": 500, "red": 100 })
  bets: z.record(z.string(), z.number().int().positive()).refine((b) => Object.keys(b).length > 0, {
    message: "Put something on the layout first.",
  }),
});

// POST /api/game/rollit (§10.2)
export const POST = handle(async (req) => {
  const user = await requireUser();
  await rateLimit(user.id, "rollit");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Put something on the layout first.", 400);

  const betsCents: Record<string, bigint> = {};
  let stakeCents = 0n;
  for (const [k, v] of Object.entries(parsed.data.bets)) {
    const c = BigInt(v);
    betsCents[k] = c;
    stakeCents += c;
  }

  const result = await settleStateless({
    userId: user.id,
    game: "ROLLIT",
    stakeCents,
    idempotencyKey: idempotencyKey(req),
    resolve: (src) => {
      const { index, number } = drawRollit(src);
      const returnCents = resolveRollit(betsCents, number);
      return { returnCents, outcome: { index, number, color: colorOf(number) } };
    },
  });

  return ok(result);
});
