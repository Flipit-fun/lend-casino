import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { idempotencyKey } from "@/lib/http";
import { sellChips } from "@/lib/sell";

const bodySchema = z.object({ chipsCents: z.number().int().positive() });

// POST /api/chips/sell (§9.2) — queue an ETH payout for sold chips.
export const POST = handle(async (req) => {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Enter chips to sell.", 400);
  return ok(await sellChips(user.id, BigInt(parsed.data.chipsCents), idempotencyKey(req)));
});
