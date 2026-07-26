import { generateNonce } from "siwe";
import { ok, handle } from "@/lib/api";
import { getSession } from "@/lib/session";

// GET /api/auth/nonce — issue a nonce and stash it in the session for SIWE.
export const GET = handle(async () => {
  const session = await getSession();
  session.nonce = generateNonce();
  await session.save();
  return ok({ nonce: session.nonce });
});
