/**
 * Auth helpers (§4.3). A wallet connection is not a session — a valid SIWE
 * session cookie is required for every money/game endpoint.
 */
import type { User } from "@prisma/client";
import { db } from "./db";
import { getSession } from "./session";
import { ApiError } from "./errors";
import { generateServerSeed, hashSeed } from "./fair";

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

/**
 * Load the user for the current session, or throw 401. This is the guard every
 * protected route calls first.
 */
export async function requireUser(): Promise<User> {
  const session = await getSession();
  if (!session.userId || !session.address) {
    throw new ApiError("UNAUTHENTICATED", "Connect your Robinhood wallet to continue.", 401);
  }
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    throw new ApiError("UNAUTHENTICATED", "Session expired. Sign in again.", 401);
  }
  if (user.bannedAt) {
    throw new ApiError("BANNED", "This account is not permitted to play.", 403);
  }
  return user;
}

/**
 * Find or create a user by address, provisioning an initial server seed and a
 * default client seed so the account is provably-fair ready from first login.
 */
export async function getOrCreateUser(address: string): Promise<User> {
  const addr = normalizeAddress(address);
  const existing = await db.user.findUnique({ where: { address: addr } });
  if (existing) return existing;

  const seed = generateServerSeed();
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { address: addr, clientSeed: generateServerSeed().slice(0, 16) },
    });
    const serverSeed = await tx.serverSeed.create({
      data: { userId: user.id, seed, seedHash: hashSeed(seed) },
    });
    return tx.user.update({ where: { id: user.id }, data: { serverSeedId: serverSeed.id } });
  });
}
