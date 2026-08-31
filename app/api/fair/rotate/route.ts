import { ok, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateServerSeed, hashSeed } from "@/lib/fair";

// POST /api/fair/rotate — reveal the current server seed and issue a new one,
// resetting the nonce (§10.1). The revealed seed lets the player verify every
// past outcome under the old hash.
export const POST = handle(async () => {
  const user = await requireUser();

  const result = await db.$transaction(async (tx) => {
    let revealed: { seed: string; seedHash: string } | null = null;
    if (user.serverSeedId) {
      const old = await tx.serverSeed.update({
        where: { id: user.serverSeedId },
        data: { revealedAt: new Date() },
      });
      revealed = { seed: old.seed, seedHash: old.seedHash };
    }

    const seed = generateServerSeed();
    const next = await tx.serverSeed.create({
      data: { userId: user.id, seed, seedHash: hashSeed(seed) },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { serverSeedId: next.id, nonce: 0 },
    });

    return { revealed, nextHash: next.seedHash };
  });

  return ok({
    revealedSeed: result.revealed?.seed ?? null,
    revealedHash: result.revealed?.seedHash ?? null,
    serverSeedHash: result.nextHash,
    nonce: 0,
  });
});
