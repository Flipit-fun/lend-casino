import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { quoteRedeem } from "@/lib/redeem";

const bodySchema = z.object({ positionId: z.string().min(1) });

// POST /api/redeem/quote (§9.3) — ETH owed, 120s expiry.
export const POST = handle(async (req) => {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Missing ticket.", 400);
  return ok(await quoteRedeem(user.id, parsed.data.positionId));
});
