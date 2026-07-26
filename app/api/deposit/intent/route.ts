import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createDepositIntent } from "@/lib/deposit";

const bodySchema = z.object({
  symbol: z.string().min(1).max(12),
  usdCents: z.number().int().positive(), // dollar amount to deposit, in cents
});

// POST /api/deposit/intent (§9.1) — quote a (fractional) deposit from a USD amount.
export const POST = handle(async (req) => {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Pick an asset and a dollar amount.", 400);

  const quote = await createDepositIntent(user.id, parsed.data.symbol, BigInt(parsed.data.usdCents));
  return ok(quote);
});
