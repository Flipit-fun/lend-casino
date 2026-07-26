import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createDepositIntent } from "@/lib/deposit";

const bodySchema = z.object({
  symbol: z.string().min(1).max(12),
  qtyRaw: z.string().regex(/^\d+$/, "qtyRaw must be an integer string of base units"),
});

// POST /api/deposit/intent (§9.1)
export const POST = handle(async (req) => {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Pick an asset and an amount.", 400);

  const quote = await createDepositIntent(user.id, parsed.data.symbol, BigInt(parsed.data.qtyRaw));
  return ok(quote);
});
