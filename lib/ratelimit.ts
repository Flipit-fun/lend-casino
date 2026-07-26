/**
 * Per-user, per-action rate limiting (§10.4) — a fixed-window Redis counter,
 * ~10 actions/sec. Fails OPEN if Redis is unavailable (a protective control,
 * not a correctness one), so local dev without Redis still works.
 */
import { getRedis } from "./redis";
import { ApiError } from "./errors";

const LIMIT = 10; // actions
const WINDOW_SEC = 1;

export async function rateLimit(userId: string, bucket: string): Promise<void> {
  let count: number;
  try {
    const redis = getRedis();
    const key = `rl:${bucket}:${userId}`;
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, WINDOW_SEC);
  } catch {
    return; // fail open
  }
  if (count > LIMIT) {
    throw new ApiError("RATE_LIMITED", "Slow down a moment.", 429);
  }
}
