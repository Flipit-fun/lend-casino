import { ok, handle, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/fair/current — active server seed HASH (never the seed), client seed,
// and current nonce (§10.1).
export const GET = handle(async () => {
  const user = await requireUser();
  if (!user.serverSeedId) {
    throw new ApiError("NO_SEED", "No active server seed. Rotate to create one.", 409);
  }
  const seed = await db.serverSeed.findUniqueOrThrow({ where: { id: user.serverSeedId } });
  return ok({
    serverSeedHash: seed.seedHash,
    clientSeed: user.clientSeed,
    nonce: user.nonce,
  });
});
