/**
 * Shared Redis client (server/worker only).
 *
 * Works unchanged against a local Redis now (redis://localhost:6379) and a
 * hosted Upstash instance later (rediss://… — ioredis enables TLS automatically
 * from the scheme). Nothing else needs to change to deploy.
 */
import Redis from "ioredis";
import { redisUrl } from "./env";

function assertServer() {
  if (typeof window !== "undefined") {
    throw new Error("Redis client must never be loaded on the client.");
  }
}

let _redis: Redis | null = null;

export function getRedis(): Redis {
  assertServer();
  if (_redis) return _redis;
  const url = redisUrl();
  _redis = new Redis(url, {
    // Fail fast rather than buffering commands forever if Redis is down.
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });
  return _redis;
}
