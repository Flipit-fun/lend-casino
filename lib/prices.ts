/**
 * Prices (§8) — pluggable provider behind a stable interface.
 *
 * Today: PRICE_SOURCE=static uses the built-in table below (no network).
 * Later:  set PRICE_SOURCE=api and fill PRICE_FEED_URL/PRICE_FEED_KEY — the
 *         call sites (deposit intent, redemption quote, liquidation) don't
 *         change at all, they just start getting live marks.
 *
 * Contract used everywhere else:
 *   getMark(symbol) -> { cents, asOf }
 *   getEthUsd()     -> { cents, asOf }
 * Both throw PriceStaleError if the mark is older than PRICE_MAX_STALENESS_SEC,
 * so a deposit/quote/liquidation never runs on a stale price.
 */
import { priceConfig } from "./env";
import { getRedis } from "./redis";
import { getPublicClient } from "./chain";
import { mulDivFloor } from "./money";
import { ROBINHOOD_FEEDS, AGGREGATOR_V3_ABI, DEXSCREENER_TOKENS } from "./priceFeeds";

/**
 * Price precision. Marks are carried as `scaledCents` = USD-cents × PRICE_SCALE
 * so we can represent a price far below one cent per unit (e.g. a token worth
 * $0.000036 → 0.0036 cents → scaledCents 3_600_000). `cents` (whole cents) is
 * kept for display/back-compat; all COLLATERAL VALUATION uses `scaledCents`.
 */
export const PRICE_SCALE = 1_000_000_000n; // 1e9

export interface PriceQuote {
  cents: bigint; // whole USD cents per unit (display / back-compat, floored)
  scaledCents: bigint; // cents × PRICE_SCALE — exact price for valuation math
  asOf: Date;
}

/** Build a quote from a scaled-cents price; derives whole `cents` for display. */
export function quoteFromScaledCents(scaledCents: bigint, asOf: Date = new Date()): PriceQuote {
  return { cents: scaledCents / PRICE_SCALE, scaledCents, asOf };
}

/** USD dollars/unit -> scaled cents (cents × PRICE_SCALE), full precision. */
export function usdToScaledCents(usd: number): bigint {
  return BigInt(Math.round(usd * 100 * Number(PRICE_SCALE)));
}

/** Build a quote from a USD-dollar float price. */
export function quoteFromUsd(usd: number, asOf: Date = new Date()): PriceQuote {
  return quoteFromScaledCents(usdToScaledCents(usd), asOf);
}

/**
 * Collateral value in whole USD cents for `qtyRaw` base units at a given mark.
 *   value = qtyRaw × scaledCents / (10^decimals × PRICE_SCALE)
 */
export function collateralValueCents(qtyRaw: bigint, scaledCents: bigint, decimals: number): bigint {
  return mulDivFloor(qtyRaw, scaledCents, 10n ** BigInt(decimals) * PRICE_SCALE);
}

/**
 * Token base units purchasable for `usdCents` at a given mark — inverse of
 * collateralValueCents. qtyRaw = usdCents × PRICE_SCALE × 10^decimals / scaledCents.
 */
export function qtyRawFromUsdCents(usdCents: bigint, scaledCents: bigint, decimals: number): bigint {
  return mulDivFloor(usdCents * PRICE_SCALE, 10n ** BigInt(decimals), scaledCents);
}

export interface PriceProvider {
  getMark(symbol: string): Promise<PriceQuote>;
  getEthUsd(): Promise<PriceQuote>;
}

export class PriceStaleError extends Error {
  constructor(public symbol: string, public ageSec: number) {
    super(`Pricing is stale for ${symbol} (${ageSec.toFixed(1)}s old).`);
    this.name = "PriceStaleError";
  }
}

export class PriceUnavailableError extends Error {
  constructor(symbol: string) {
    super(`No price available for ${symbol}.`);
    this.name = "PriceUnavailableError";
  }
}

/** USD dollar float -> integer cents. Boundary conversion only (external data). */
export function usdToCents(usd: number): bigint {
  return BigInt(Math.round(usd * 100));
}

/* --------------------------- live ETH price -------------------------------- */
// ETH/USD from Coinbase spot (no API key). Cached 10s in Redis (best-effort).
// On any failure it falls back to the static ETH price so the critical
// chip<->ETH conversions never hard-fail.
async function fetchEthUsdScaledCents(): Promise<bigint> {
  const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`ETH price feed ${res.status}`);
  const json = (await res.json()) as { data?: { amount?: string } };
  const amount = Number(json?.data?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("bad ETH price payload");
  return usdToScaledCents(amount);
}

export async function liveEthQuote(): Promise<PriceQuote> {
  const cacheKey = "price:ETH";
  let redis: ReturnType<typeof getRedis> | null = null;
  try {
    redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      const p = JSON.parse(cached);
      return quoteFromScaledCents(BigInt(p.scaledCents), new Date(p.asOf));
    }
  } catch {
    redis = null; // Redis unavailable — proceed without cache
  }

  let scaledCents: bigint;
  try {
    scaledCents = await fetchEthUsdScaledCents();
  } catch {
    scaledCents = usdToScaledCents(STATIC_USD.ETH); // fallback, still marked fresh
  }
  const quote = quoteFromScaledCents(scaledCents, new Date());
  if (redis) {
    try {
      await redis.set(
        cacheKey,
        JSON.stringify({ scaledCents: scaledCents.toString(), asOf: quote.asOf.toISOString() }),
        "EX",
        10
      );
    } catch {
      /* ignore cache write failure */
    }
  }
  return quote;
}

/* ----------------------- DexScreener live price ---------------------------- */
/**
 * Live USD price for a DEX-traded token (no oracle) via the DexScreener public
 * API. Picks the pair with the deepest USD liquidity (ignores dust pairs) so a
 * near-empty pool can't set the mark. Cached 30s in Redis (best-effort). Throws
 * PriceUnavailableError if no usable pair is found — callers decide the
 * fallback (see resolver in getMark), so we never silently mark a bad price.
 */
async function fetchDexScreenerScaledCents(tokenAddress: string): Promise<bigint> {
  const res = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
    { cache: "no-store", signal: AbortSignal.timeout(4000) }
  );
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  const json = (await res.json()) as {
    pairs?: Array<{ priceUsd?: string; liquidity?: { usd?: number } }>;
  };
  const pairs = json?.pairs ?? [];
  let best: { usd: number; liq: number } | null = null;
  for (const p of pairs) {
    const usd = Number(p?.priceUsd);
    const liq = Number(p?.liquidity?.usd ?? 0);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    if (!best || liq > best.liq) best = { usd, liq };
  }
  if (!best) throw new Error("no usable DexScreener pair");
  // Scaled cents preserves sub-cent precision (a $0.000036 token would round to
  // 0 whole cents and break valuation).
  return usdToScaledCents(best.usd);
}

async function dexScreenerQuote(symbol: string, tokenAddress: string): Promise<PriceQuote> {
  const cacheKey = `price:dex:${symbol.toUpperCase()}`;
  let redis: ReturnType<typeof getRedis> | null = null;
  try {
    redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      const p = JSON.parse(cached);
      return quoteFromScaledCents(BigInt(p.scaledCents), new Date(p.asOf));
    }
  } catch {
    redis = null;
  }

  const scaledCents = await fetchDexScreenerScaledCents(tokenAddress);
  const quote = quoteFromScaledCents(scaledCents, new Date());
  if (redis) {
    try {
      await redis.set(
        cacheKey,
        JSON.stringify({ scaledCents: scaledCents.toString(), asOf: quote.asOf.toISOString() }),
        "EX",
        30
      );
    } catch {
      /* ignore cache write failure */
    }
  }
  return quote;
}

/* -------------------------- static provider ------------------------------- */
// Prices in whole USD dollars; converted to cents at read time. Edit freely.
const STATIC_USD: Record<string, number> = {
  AAPL: 231.4,
  NVDA: 174.82,
  TSLA: 318.05,
  MSFT: 442.6,
  GOOGL: 179.9,
  AMZN: 221.3,
  META: 601.5,
  PLTR: 64.8,
  COIN: 251.7,
  MSTR: 389.11,
  AMD: 165.2,
  INTC: 22.4,
  ETH: 3412.55,
};

export class StaticPriceProvider implements PriceProvider {
  async getMark(symbol: string): Promise<PriceQuote> {
    const usd = STATIC_USD[symbol.toUpperCase()];
    if (usd === undefined) throw new PriceUnavailableError(symbol);
    return quoteFromUsd(usd); // always fresh
  }
  getEthUsd(): Promise<PriceQuote> {
    return this.getMark("ETH");
  }
}

/* -------------------------- hybrid provider -------------------------------- */
/**
 * Default provider: stock marks from the static table, ETH from the live feed.
 * Lets you run with a dynamic ETH price while stock prices stay static until a
 * stock feed is configured.
 */
export class HybridPriceProvider implements PriceProvider {
  private readonly stat = new StaticPriceProvider();
  getMark(symbol: string): Promise<PriceQuote> {
    return symbol.toUpperCase() === "ETH" ? liveEthQuote() : this.stat.getMark(symbol);
  }
  getEthUsd(): Promise<PriceQuote> {
    return liveEthQuote();
  }
}

/* --------------------------- http provider -------------------------------- */
/**
 * Skeleton for a live feed. Caches each symbol in Redis for 10s (§8). The only
 * thing to adapt when you plug in a real API is `parseResponse()` — map your
 * feed's JSON shape to { usd, asOf }.
 */
export class HttpPriceProvider implements PriceProvider {
  private readonly url: string;
  private readonly key: string | undefined;

  constructor(url: string, key?: string) {
    this.url = url;
    this.key = key;
  }

  // Adjust this to your feed's response shape.
  private parseResponse(json: unknown): { usd: number; asOf: Date } {
    const obj = json as { price?: number; asOf?: string | number };
    if (typeof obj?.price !== "number") {
      throw new Error("Unexpected price feed response shape (expected { price }).");
    }
    return { usd: obj.price, asOf: obj.asOf ? new Date(obj.asOf) : new Date() };
  }

  async getMark(symbol: string): Promise<PriceQuote> {
    const sym = symbol.toUpperCase();
    const redis = getRedis();
    const cacheKey = `price:${sym}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      const { scaledCents, asOf } = JSON.parse(cached);
      return quoteFromScaledCents(BigInt(scaledCents), new Date(asOf));
    }
    const res = await fetch(`${this.url}?symbol=${encodeURIComponent(sym)}`, {
      headers: this.key ? { Authorization: `Bearer ${this.key}` } : undefined,
      cache: "no-store",
    });
    if (!res.ok) throw new PriceUnavailableError(sym);
    const { usd, asOf } = this.parseResponse(await res.json());
    const quote = quoteFromUsd(usd, asOf);
    await redis.set(
      cacheKey,
      JSON.stringify({ scaledCents: quote.scaledCents.toString(), asOf: quote.asOf.toISOString() }),
      "EX",
      10
    );
    return quote;
  }

  // ETH always comes from the crypto feed, even in api mode (a stock feed
  // usually can't price ETH).
  getEthUsd(): Promise<PriceQuote> {
    return liveEthQuote();
  }
}

/* -------------------------- on-chain provider ------------------------------ */
/**
 * Reads Robinhood stock-token prices from their on-chain Chainlink feeds
 * (AggregatorV3 latestRoundData) — the multiplier-adjusted per-token price.
 * ETH comes from the live crypto feed. Symbols without a configured feed (in
 * lib/priceFeeds.ts) fall back to the static table. Marks cached 10s in Redis.
 */
export class OnchainPriceProvider implements PriceProvider {
  private readonly stat = new StaticPriceProvider();

  async getMark(symbol: string): Promise<PriceQuote> {
    const sym = symbol.toUpperCase();
    if (sym === "ETH") return liveEthQuote();

    const feed = ROBINHOOD_FEEDS[sym];
    if (!feed) return this.stat.getMark(symbol); // no feed configured yet

    const cacheKey = `price:onchain:${sym}`;
    let redis: ReturnType<typeof getRedis> | null = null;
    try {
      redis = getRedis();
      const cached = await redis.get(cacheKey);
      if (cached) {
        const p = JSON.parse(cached);
        return quoteFromScaledCents(BigInt(p.scaledCents), new Date(p.asOf));
      }
    } catch {
      redis = null;
    }

    try {
      // viem's readContract generics are over-strict against our shared client
      // type; a loose local alias keeps this readable.
      const client = getPublicClient() as unknown as {
        readContract: (a: Record<string, unknown>) => Promise<unknown>;
      };
      const [round, decimals] = await Promise.all([
        client.readContract({ address: feed, abi: AGGREGATOR_V3_ABI, functionName: "latestRoundData" }),
        client.readContract({ address: feed, abi: AGGREGATOR_V3_ABI, functionName: "decimals" }),
      ]);
      const answer = (round as readonly bigint[])[1]; // int256 price
      if (answer <= 0n) throw new Error("non-positive feed answer");
      // scaledCents = answer × 100 × PRICE_SCALE / 10^feedDecimals
      const scaledCents = mulDivFloor(answer, 100n * PRICE_SCALE, 10n ** BigInt(decimals as number));
      // Treat the read as fresh: stock feeds hold last price off-hours by design,
      // so we don't reject on updatedAt here (see docs; harden with oraclePaused
      // + sequencer-uptime + heartbeat for production).
      const quote = quoteFromScaledCents(scaledCents, new Date());
      if (redis) {
        try {
          await redis.set(
            cacheKey,
            JSON.stringify({ scaledCents: scaledCents.toString(), asOf: quote.asOf.toISOString() }),
            "EX",
            10
          );
        } catch {
          /* ignore */
        }
      }
      return quote;
    } catch {
      return this.stat.getMark(symbol); // fall back if the read fails
    }
  }

  getEthUsd(): Promise<PriceQuote> {
    return liveEthQuote();
  }
}

/* ----------------------------- selection ---------------------------------- */
let _provider: PriceProvider | null = null;

export function getPriceProvider(): PriceProvider {
  if (_provider) return _provider;
  const cfg = priceConfig();
  if (cfg.PRICE_SOURCE === "onchain") {
    // on-chain Chainlink feeds for stocks + live ETH
    _provider = new OnchainPriceProvider();
  } else if (cfg.PRICE_SOURCE === "api") {
    if (!cfg.PRICE_FEED_URL) {
      throw new Error("PRICE_SOURCE=api requires PRICE_FEED_URL to be set.");
    }
    _provider = new HttpPriceProvider(cfg.PRICE_FEED_URL, cfg.PRICE_FEED_KEY);
  } else {
    // static stocks + live ETH
    _provider = new HybridPriceProvider();
  }
  return _provider;
}

function assertFresh(symbol: string, asOf: Date) {
  const maxStale = priceConfig().PRICE_MAX_STALENESS_SEC;
  const ageSec = (Date.now() - asOf.getTime()) / 1000;
  if (ageSec > maxStale) throw new PriceStaleError(symbol, ageSec);
}

/** Live mark for an asset symbol, in USD cents. Throws if stale/unavailable. */
export async function getMark(symbol: string): Promise<PriceQuote> {
  const sym = symbol.toUpperCase();
  // DEX-priced tokens (no oracle) resolve via DexScreener regardless of the
  // configured PRICE_SOURCE — they have no Chainlink feed or static entry.
  const dexToken = DEXSCREENER_TOKENS[sym];
  const q = dexToken
    ? await dexScreenerQuote(sym, dexToken)
    : await getPriceProvider().getMark(symbol);
  assertFresh(symbol, q.asOf);
  return q;
}

/** Live ETH/USD mark, in USD cents. Throws if stale. */
export async function getEthUsd(): Promise<PriceQuote> {
  const q = await getPriceProvider().getEthUsd();
  assertFresh("ETH", q.asOf);
  return q;
}
