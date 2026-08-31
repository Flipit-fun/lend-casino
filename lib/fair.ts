/**
 * Provably-fair core for Lend.Casino (§10.1).
 *
 *   serverSeed     = 32 random bytes, per user, rotated on demand
 *   serverSeedHash = sha256(serverSeed)   -> shown to the player immediately
 *   clientSeed     = player-settable string
 *   nonce          = increments on every resolved bet
 *   stream(i)      = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}:${i}`)
 *
 * The HMAC output is consumed as a byte stream. Uniform integers are produced
 * with REJECTION SAMPLING — never modulo on a raw byte, which biases results.
 * The active server seed never leaves the server; only its hash does.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

export interface RandomSource {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Uniform float in [0, 1). */
  float(): number;
}

export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function hashSeed(seed: string): string {
  return createHash("sha256").update(seed, "utf8").digest("hex");
}

/**
 * Deterministic byte stream from HMAC-SHA256, keyed by the server seed and
 * salted by `${clientSeed}:${nonce}:${block}`. Blocks are produced lazily.
 */
function byteStream(serverSeed: string, clientSeed: string, nonce: number): () => number {
  let block: Buffer = Buffer.alloc(0);
  let offset = 0;
  let counter = 0;
  return function nextByte(): number {
    if (offset >= block.length) {
      block = createHmac("sha256", serverSeed)
        .update(`${clientSeed}:${nonce}:${counter}`)
        .digest();
      counter += 1;
      offset = 0;
    }
    return block[offset++];
  };
}

/**
 * A RandomSource driven by the HMAC byte stream, using rejection sampling for
 * unbiased integers and 48 bits of entropy for floats.
 */
export function fairSource(serverSeed: string, clientSeed: string, nonce: number): RandomSource {
  const nextByte = byteStream(serverSeed, clientSeed, nonce);
  return makeSource(nextByte);
}

/** Build a RandomSource from any byte generator (shared by fair + tests). */
export function makeSource(nextByte: () => number): RandomSource {
  function int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error("int: maxExclusive must be a positive integer");
    }
    if (maxExclusive === 1) return 0;
    // Number of bytes needed to represent maxExclusive-1.
    let bytesNeeded = 1;
    while (2 ** (bytesNeeded * 8) < maxExclusive) bytesNeeded++;
    const range = 2 ** (bytesNeeded * 8);
    // Largest multiple of maxExclusive that fits; reject the biased tail.
    const limit = range - (range % maxExclusive);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let x = 0;
      for (let i = 0; i < bytesNeeded; i++) x = x * 256 + nextByte();
      if (x < limit) return x % maxExclusive;
    }
  }

  function float(): number {
    // 48 bits -> [0, 1). 2^48 is exactly representable as a JS number.
    let x = 0;
    for (let i = 0; i < 6; i++) x = x * 256 + nextByte();
    return x / 2 ** 48;
  }

  return { int, float };
}

/** In-place Fisher–Yates shuffle driven by a RandomSource. */
export function shuffle<T>(arr: T[], src: RandomSource): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = src.int(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
