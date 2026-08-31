import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { idempotencyKey } from "@/lib/http";
import { deal } from "@/lib/blackjackService";
import { rateLimit } from "@/lib/ratelimit";

const bodySchema = z.object({ stakeCents: z.number().int().positive() });

// POST /api/game/blackjack/deal (§10.3)
export const POST = handle(async (req) => {
  const user = await requireUser();
  await rateLimit(user.id, "blackjack");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Set a stake and deal.", 400);
  return ok(await deal(user.id, BigInt(parsed.data.stakeCents), idempotencyKey(req)));
});
