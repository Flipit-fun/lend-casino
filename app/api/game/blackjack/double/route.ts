import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { double } from "@/lib/blackjackService";

const bodySchema = z.object({ roundId: z.string().min(1) });

// POST /api/game/blackjack/double (§10.3)
export const POST = handle(async (req) => {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Missing round.", 400);
  return ok(await double(user.id, parsed.data.roundId));
});
