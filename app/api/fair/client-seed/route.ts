import { z } from "zod";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

const bodySchema = z.object({
  clientSeed: z.string().min(1).max(64),
});

// POST /api/fair/client-seed — set the player-controlled client seed (§10.1).
export const POST = handle(async (req) => {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Client seed must be 1–64 characters.", 400);

  await db.user.update({ where: { id: user.id }, data: { clientSeed: parsed.data.clientSeed } });
  return ok({ clientSeed: parsed.data.clientSeed });
});
