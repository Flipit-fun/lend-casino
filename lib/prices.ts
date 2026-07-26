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

export interface PriceQuote {
  cents: bigint; // USD cents per unit
  asOf: Date;
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

/* -------------------------- static provider ------------------------------- */
// Prices in whole USD dollars; converted to cents at read time. Edit freely.
const STATIC_USD: Record<string, number> = {
  AAPL: 231.4,
  NVDA: 174.82,
  TSLA: 318.05,
  SPY: 612.77,
  MSTR: 389.11,
  ETH: 3412.55,
};

export class StaticPriceProvider implements PriceProvider {
  async getMark(symbol: string): Promise<PriceQuote> {
    const usd = STATIC_USD[symbol.toUpperCase()];
    if (usd === undefined) throw new PriceUnavailableError(symbol);
    return { cents: usdToCents(usd), asOf: new Date() }; // always fresh
  }
  getEthUsd(): Promise<PriceQuote> {
    return this.getMark("ETH");
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
      const { cents, asOf } = JSON.parse(cached);
      return { cents: BigInt(cents), asOf: new Date(asOf) };
    }
    const res = await fetch(`${this.url}?symbol=${encodeURIComponent(sym)}`, {
      headers: this.key ? { Authorization: `Bearer ${this.key}` } : undefined,
      cache: "no-store",
    });
    if (!res.ok) throw new PriceUnavailableError(sym);
    const { usd, asOf } = this.parseResponse(await res.json());
    const quote: PriceQuote = { cents: usdToCents(usd), asOf };
    await redis.set(
      cacheKey,
      JSON.stringify({ cents: quote.cents.toString(), asOf: quote.asOf.toISOString() }),
      "EX",
      10
    );
    return quote;
  }

  getEthUsd(): Promise<PriceQuote> {
    return this.getMark("ETH");
  }
}

/* ----------------------------- selection ---------------------------------- */
let _provider: PriceProvider | null = null;

export function getPriceProvider(): PriceProvider {
  if (_provider) return _provider;
  const cfg = priceConfig();
  if (cfg.PRICE_SOURCE === "api") {
    if (!cfg.PRICE_FEED_URL) {
      throw new Error("PRICE_SOURCE=api requires PRICE_FEED_URL to be set.");
    }
    _provider = new HttpPriceProvider(cfg.PRICE_FEED_URL, cfg.PRICE_FEED_KEY);
  } else {
    _provider = new StaticPriceProvider();
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
  const q = await getPriceProvider().getMark(symbol);
  assertFresh(symbol, q.asOf);
  return q;
}

/** Live ETH/USD mark, in USD cents. Throws if stale. */
export async function getEthUsd(): Promise<PriceQuote> {
  const q = await getPriceProvider().getEthUsd();
  assertFresh("ETH", q.asOf);
  return q;
}
