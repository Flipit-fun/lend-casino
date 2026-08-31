import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { redeemWithChips } from "@/lib/redeem";

const bodySchema = z.object({ positionId: z.string().min(1) });

// POST /api/redeem/with-chips (§9.3) — burn chips equal to the debt, release asset.
export const POST = handle(async (req) => {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Missing ticket.", 400);
  return ok(await redeemWithChips(user.id, parsed.data.positionId));
});
