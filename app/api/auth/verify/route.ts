import { SiweMessage } from "siwe";
import { z } from "zod";
import { ok, fail, handle, ApiError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { getOrCreateUser, normalizeAddress } from "@/lib/auth";

const bodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
});

// POST /api/auth/verify — verify the signed SIWE message against the session
// nonce, then create/load the user and establish the session.
export const POST = handle(async (req) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Malformed sign-in payload.", 400);

  const session = await getSession();
  if (!session.nonce) {
    throw new ApiError("NO_NONCE", "Sign-in expired. Try connecting again.", 400);
  }

  const siwe = new SiweMessage(parsed.data.message);
  const result = await siwe
    .verify({ signature: parsed.data.signature, nonce: session.nonce })
    .catch(() => ({ success: false }) as { success: boolean; data?: SiweMessage });

  if (!result.success || !result.data) {
    throw new ApiError("BAD_SIGNATURE", "Signature check failed. Please sign in again.", 401);
  }

  const address = normalizeAddress(result.data.address);
  const user = await getOrCreateUser(address);

  session.address = address;
  session.userId = user.id;
  session.nonce = undefined; // one-time use
  await session.save();

  return ok({ address });
});
