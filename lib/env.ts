/**
 * Environment parsing for Lend.Casino (§3).
 *
 * Rules:
 *  - Every env var is declared and validated here with zod.
 *  - Nothing else in the codebase reads `process.env` directly.
 *  - Parsing is lazy + memoised so importing this module never throws during
 *    the Next.js build; it throws the first time a value is actually needed.
 *  - Public (client-safe) vars are split from server-only secrets so that
 *    `TREASURY_PRIVATE_KEY` and friends can never be pulled into a client
 *    bundle by accident.
 */
import { z } from "zod";

const bigintString = z
  .string()
  .regex(/^\d+$/, "must be a base-10 integer (wei/cents)")
  .transform((s) => BigInt(s));

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");

// Treat empty-string env values ("") the same as unset, so blank optional
// fields in .env don't fail stricter validators like .url().
const optionalUrl = z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional());
const optionalNonEmpty = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

/* ----------------------------- client / public ---------------------------- */
const publicSchema = z.object({
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().int().positive(),
  NEXT_PUBLIC_CHAIN_NAME: z.string().min(1),
  NEXT_PUBLIC_RPC_URL: z.string().url(),
  NEXT_PUBLIC_EXPLORER_URL: z.string().url(),
  NEXT_PUBLIC_TREASURY_ADDRESS: hexAddress,
  // WalletConnect Cloud project id — only used by the web app's wagmi config,
  // so it's optional here (the worker doesn't have it) and enforced in wagmi.ts.
  NEXT_PUBLIC_WC_PROJECT_ID: z.string().min(1).optional(),
});

/* ------------------------------- server only ------------------------------ */
const serverSchema = z.object({
  RPC_URL_PRIVATE: z.string().url(),
  // Only the worker signs payouts, so the web app doesn't need the key. The
  // signer enforces its presence at use time.
  TREASURY_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte 0x key")
    .optional(),
  TREASURY_MIN_ETH_WEI: bigintString,
  PAYOUT_DAILY_CAP_WEI: bigintString,
  PAYOUT_PER_TX_CAP_WEI: bigintString,

  DATABASE_URL: z.string().url(), // Supabase pooled (pgbouncer :6543)
  DIRECT_URL: z.string().url(), // Supabase direct (:5432), for migrations
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 bytes"),

  // Price source: "static" = built-in table + live ETH; "onchain" = Chainlink
  // feeds for stocks + live ETH; "api" hits PRICE_FEED_URL.
  PRICE_SOURCE: z.enum(["static", "onchain", "api"]).default("static"),
  PRICE_FEED_URL: optionalUrl,
  PRICE_FEED_KEY: optionalNonEmpty,

  SELL_POLICY: z.enum(["winnings_only", "full"]).default("winnings_only"),
  DEPOSIT_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(12),
  PRICE_MAX_STALENESS_SEC: z.coerce.number().int().positive().default(60),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function parseOrThrow<T>(schema: z.ZodType<T>, source: Record<string, unknown>, label: string): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid ${label} environment:\n${issues}`);
  }
  return result.data;
}

let _public: PublicEnv | null = null;
let _server: ServerEnv | null = null;

/** Client-safe, inlined NEXT_PUBLIC_* values. Usable in browser + server. */
export function publicEnv(): PublicEnv {
  if (_public) return _public;
  // NEXT_PUBLIC_* are statically inlined by Next; reference them explicitly.
  _public = parseOrThrow(
    publicSchema,
    {
      NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
      NEXT_PUBLIC_CHAIN_NAME: process.env.NEXT_PUBLIC_CHAIN_NAME,
      NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
      NEXT_PUBLIC_EXPLORER_URL: process.env.NEXT_PUBLIC_EXPLORER_URL,
      NEXT_PUBLIC_TREASURY_ADDRESS: process.env.NEXT_PUBLIC_TREASURY_ADDRESS,
      NEXT_PUBLIC_WC_PROJECT_ID: process.env.NEXT_PUBLIC_WC_PROJECT_ID,
    },
    "public"
  );
  return _public;
}

/** Server-only secrets. Throws if called in a browser bundle. */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() must never be called on the client.");
  }
  if (_server) return _server;
  _server = parseOrThrow(serverSchema, process.env as Record<string, unknown>, "server");
  return _server;
}

/* --------------------- focused getters (server/worker) --------------------- */
// These parse only the slice they need, so a module (prices, redis) can run
// without the entire server env being populated. All process.env access still
// lives in this file.

const priceSchema = z.object({
  PRICE_SOURCE: z.enum(["static", "onchain", "api"]).default("static"),
  PRICE_FEED_URL: optionalUrl,
  PRICE_FEED_KEY: optionalNonEmpty,
  PRICE_MAX_STALENESS_SEC: z.coerce.number().int().positive().default(60),
});
export type PriceConfig = z.infer<typeof priceSchema>;

export function priceConfig(): PriceConfig {
  if (typeof window !== "undefined") {
    throw new Error("priceConfig() must never be called on the client.");
  }
  return parseOrThrow(priceSchema, process.env as Record<string, unknown>, "price");
}

export function sellPolicy(): "winnings_only" | "full" {
  if (typeof window !== "undefined") {
    throw new Error("sellPolicy() must never be called on the client.");
  }
  return parseOrThrow(
    z.object({ SELL_POLICY: z.enum(["winnings_only", "full"]).default("winnings_only") }),
    process.env as Record<string, unknown>,
    "policy"
  ).SELL_POLICY;
}

export function sessionSecret(): string {
  if (typeof window !== "undefined") {
    throw new Error("sessionSecret() must never be called on the client.");
  }
  return parseOrThrow(
    z.object({ SESSION_SECRET: z.string().min(32) }),
    process.env as Record<string, unknown>,
    "session"
  ).SESSION_SECRET;
}

export function redisUrl(): string {
  if (typeof window !== "undefined") {
    throw new Error("redisUrl() must never be called on the client.");
  }
  return parseOrThrow(
    z.object({ REDIS_URL: z.string().url() }),
    process.env as Record<string, unknown>,
    "redis"
  ).REDIS_URL;
}

/** Treasury caps + alert threshold (wei). Used by the sell route + worker. */
export function treasuryCaps(): { perTxWei: bigint; dailyWei: bigint; minEthWei: bigint } {
  if (typeof window !== "undefined") {
    throw new Error("treasuryCaps() must never be called on the client.");
  }
  const c = parseOrThrow(
    z.object({
      PAYOUT_PER_TX_CAP_WEI: bigintString,
      PAYOUT_DAILY_CAP_WEI: bigintString,
      TREASURY_MIN_ETH_WEI: bigintString,
    }),
    process.env as Record<string, unknown>,
    "treasury-caps"
  );
  return {
    perTxWei: c.PAYOUT_PER_TX_CAP_WEI,
    dailyWei: c.PAYOUT_DAILY_CAP_WEI,
    minEthWei: c.TREASURY_MIN_ETH_WEI,
  };
}

/** Confirmations to wait before crediting a deposit. Worker only. */
export function depositConfirmations(): number {
  if (typeof window !== "undefined") {
    throw new Error("depositConfirmations() must never be called on the client.");
  }
  return parseOrThrow(
    z.object({ DEPOSIT_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(12) }),
    process.env as Record<string, unknown>,
    "deposit-confirmations"
  ).DEPOSIT_CONFIRMATIONS;
}

/** Treasury signing key. Worker only; undefined elsewhere. */
export function treasuryKey(): string | undefined {
  if (typeof window !== "undefined") {
    throw new Error("treasuryKey() must never be called on the client.");
  }
  return parseOrThrow(
    z.object({
      TREASURY_PRIVATE_KEY: z
        .string()
        .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte 0x key")
        .optional(),
    }),
    process.env as Record<string, unknown>,
    "treasury-key"
  ).TREASURY_PRIVATE_KEY;
}
