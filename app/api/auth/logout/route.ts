import { ok, handle } from "@/lib/api";
import { getSession } from "@/lib/session";

// POST /api/auth/logout — destroy the session.
export const POST = handle(async () => {
  const session = await getSession();
  session.destroy();
  return ok({ ok: true });
});
