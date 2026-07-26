# Lend.Casino

A collateral-backed casino on Robinhood Chain. Nobody buys in with cash — a
player deposits a tokenized real-world asset into a single treasury wallet and
the house credits chips against it. They play. To get the asset back they pay
ETH.

**There are no smart contracts.** The chain is used only to receive inbound
transfers to the treasury and send outbound transfers from it. All balances,
debts, bets, and payouts are rows in Postgres.

## ⚠️ What this is — and is not (§18)

Lend.Casino is **custodial**. Players' assets sit in a wallet the operator
controls, and every balance is an entry in the operator's database. There is no
on-chain guarantee that a chip is redeemable — the guarantee is the operator's
solvency and honesty. That is the direct consequence of the no-contracts
decision. It is a legitimate architecture (it's how every centralised exchange
and most online casinos work), but it is stated here rather than implied.

Two consequences worth planning around before real value flows:

- The treasury key is the entire security model, so it belongs behind a KMS or
  multisig. The code keeps a single seam (`lib/treasury/signer.ts`, to be added)
  so swapping the signer is a one-file change.
- A custodial product that takes deposits, extends credit, and books wagers sits
  inside gambling, lending, and money-transmission regimes at once. That is a
  licensing question, not a technical one.

## Build status

This repo is being built in the staged order from the spec (§15).

**Done and verified**

- **Step 1 — Rename + branding.** `The Cage` → `Lend.Casino` across metadata,
  nav, loader, footers, and package name. The counter keeps the in-world name
  "cage". Design system untouched. `next build` passes.
- **Foundations (decision-independent, unit-tested):**
  - `lib/money.ts` — BigInt minor-unit money primitives, integer multiplier
    math rounding toward the house, formatters (§7).
  - `lib/fair.ts` — provably-fair core: server seed, sha256 hash, HMAC byte
    stream, **rejection sampling** (no modulo bias), Fisher–Yates shuffle (§10.1).
  - `lib/games/*` — pure resolution + RTP math for rollit, coin, dice, mines,
    hi-lo (§10.2–10.3).
  - `lib/env.ts` — zod-validated env, split public/server, lazy + memoised (§3).
  - `prisma/schema.prisma` — full data model (§5), validated, client generated.
  - `tests/` — 19 tests incl. Monte-Carlo RTP checks (rollit 0.9730, coin/dice
    0.98, mines 0.97, hi-lo 0.97) and the ledger-invariant replay (§16).

- **Chain + treasury layer** — `lib/chain.ts` (viem read client) and
  `lib/treasury/signer.ts` (single key-holder, KMS seam) wired to env (§4.1,§6.5).
- **Prices** — `lib/prices.ts` pluggable provider: static table active now,
  HTTP provider ready behind `PRICE_SOURCE` (§8). Redis client (`lib/redis.ts`)
  local-now / Upstash-later.
- **Step 4 — Ledger + DB (live).** Schema migrated to Supabase and assets
  seeded. `lib/db.ts` (Prisma singleton) + `lib/ledger.ts`: every balance change
  goes through a row-locked, idempotent, retry-on-contention transaction that
  writes a `LedgerEntry`. Integration tests (`npm run test:integration`) prove
  the replay invariant, the insufficient-funds guard, idempotency, and
  concurrency safety against the real database.

- **Step 3 — Auth (server, verified).** SIWE nonce/verify/logout with
  iron-session, `requireUser` guard, `getOrCreateUser` (provisions a server seed
  + client seed on signup), `GET /api/me` (chips/free/debt/positions) and
  `GET /api/assets` (live marks). API envelope `{ok,data}` / `{ok,error}` with
  BigInt-safe serialisation. Verified end-to-end via `scripts/authflow.mjs`
  (real key signs a SIWE message against the dev server).
- **Step 5 — Provably fair (server, verified).** `GET /api/fair/current`,
  `POST /api/fair/rotate` (reveals old seed, issues new, resets nonce),
  `POST /api/fair/client-seed`.
- **Step 6 — Stateless games (server, verified).** `POST /api/game/{rollit,coin,
  dice}` resolve server-side from the seeded stream via `lib/gameplay.ts`
  (`settleStateless`): row-locked, idempotent, nonce-advancing, writes a
  `GameRound` + ledger entries.
- **Step 7 — Stateful games (server, verified).** `lib/stateful.ts` round engine
  (`startRound`/`actOnRound`) + `lib/blackjackService.ts`. Endpoints:
  `mines/{start,pick,cashout}`, `hilo/{start,call,cashout}`,
  `blackjack/{deal,hit,stand,double}`. Hidden state (bomb positions, dealer hole
  card, upcoming cards, full shoe) stays server-side and is never in a client
  projection. Blackjack is simple (no split/surrender, ≈1.0% edge, 3:2). Double
  debits a second stake. Integration tests cover the engine (start debits,
  cash-out credits, invariant, can't-act-on-finished) and blackjack
  deal/stand/double balance + ledger consistency.
- **Assets** seeded with the real Robinhood Chain testnet stock-token addresses
  (AAPL, NVDA, TSLA, SPY, MSTR; all 18-decimal ERC-20s). TBIL/XAUT removed.

- **Step 8 — Deposits (server, verified off-chain).** `POST /api/deposit/intent`
  (fresh-mark quote, PENDING position, 60s expiry) and `GET /api/positions`.
  `settleConfirmedDeposit` credits chips + opens the ticket, idempotent via
  `ProcessedTx`, with re-quote on wrong amount.
- **Step 9 — Get back collateral (server, verified off-chain).**
  `POST /api/redeem/quote` (ETH owed +50 bps, 120s expiry) and
  `POST /api/redeem/with-chips` (burn debt, queue asset release).
  `settleConfirmedRedemption` matches inbound ETH and queues the release.
- **Step 10 — Sell chips + guards (server).** `POST /api/chips/sell` with the
  50 bps fee, exposure-ceiling check, and per-tx cap; queues a `CHIP_SALE`
  payout. `GET /api/payouts/:id`. `lib/treasury/guards.ts` = solvency + exposure.
- **Step 11 — Health.** `GET /api/health` (db, redis, rpc, treasury balance,
  price freshness).
- **Step 13 — Worker** (`npm run worker`): deposit/redemption watcher,
  single-flight payout processor (explicit nonce, solvency + caps, backoff, max
  5 attempts), liquidation cron (110% floor), round reaper (voids/refunds
  abandoned rounds). Payouts are sourced from Postgres and polled single-flight
  rather than enqueued to BullMQ, avoiding a dual-write hazard (see worker note).
- **Rate limiting (§10.4)** — `lib/ratelimit.ts` fixed-window Redis bucket,
  fail-open; applied to bet/round-entry routes.

**On-chain amounts:** wei and 18-decimal token base units exceed Postgres
`BIGINT` (int64), so they're stored as exact integer strings and converted to
`bigint` for arithmetic (no floating point / decimal.js). Cents stay `BigInt`.

- **Step 12 — Frontend rewire (done, builds).** `app/providers.tsx` +
  `lib/wagmi.ts` (wagmi v2 + RainbowKit, EIP-6963 discovery, WalletConnect
  fallback). `components/AppBridge.tsx` owns wallet connect / switch-chain /
  SIWE sign-in / account states in the nav pill, reads `/api/me`, writes
  chips·free·ETH-owed into the purse, and exposes `window.LC` (deposit / payEth /
  refetch) for the imperative UI. `components/casino.ts` was rewritten to be
  fully server-driven: **all client RNG deleted** — the wheel, coin, dice, cards
  and mines animate toward the outcome the API returns. All six games, the three
  cage tabs (get chips via wagmi ERC-20 transfer + polling, sell chips, get back
  collateral via ETH or chips), and the fairness panel are wired to the
  endpoints. Design system untouched.

**Live-only verification (needs a funded treasury + faucet tokens):** the
deposit watcher crediting a real transfer, the payout worker sending ETH /
releasing tokens, and the sell exposure/solvency checks against a real balance.
The off-chain logic for all of these is unit/integration tested.

Test totals: unit 23, integration 14, 29 API routes.

Asset token addresses in the seed are PLACEHOLDERS — swap in the real Robinhood
Chain contract addresses before processing any on-chain deposit.

## Decisions (locked)

- **`SELL_POLICY = full`** — players can cash out their entire chip balance,
  including chips drawn against collateral. This makes Lend.Casino a real
  lending desk: the treasury fronts ETH against deposited assets, so it must be
  sized for that credit/liquidity exposure (the §6 exposure ceiling and
  solvency checks are the guardrails). The asset is the only recourse if a
  ticket is never settled.
- **Liquidation threshold = 110% health floor** — maintained as specified.
- **Fees = 50 bps** on chip sales and 50 bps on redemption — kept.
- **Blackjack — keep it simple**: no split/surrender, keep the printed ≈1.0%.
- **Robinhood Chain values** — found and wired into `.env.example` (testnet by
  default): chainId `46630`, RPC `rpc.testnet.chain.robinhood.com`, explorer
  `explorer.testnet.chain.robinhood.com`. Mainnet is chainId `4663`.
- **Database = Supabase Postgres** — pooled `DATABASE_URL` (:6543) for the app,
  `DIRECT_URL` (:5432) for migrations.

## Still needed in `.env` before the backend can run end-to-end

Fill these in your gitignored `.env` (shapes in `.env.example`):

- `DATABASE_URL` + `DIRECT_URL` — Supabase project connection strings
- `NEXT_PUBLIC_TREASURY_ADDRESS` + `TREASURY_PRIVATE_KEY` — the custodial wallet
- `NEXT_PUBLIC_WC_PROJECT_ID` — WalletConnect/Reown project id (RainbowKit)
- `SESSION_SECRET` — `openssl rand -hex 32`
- `REDIS_URL` — local Redis or hosted (Upstash works)
- `PRICE_FEED_URL` + `PRICE_FEED_KEY` — a feed that covers the tokenized
  equities/ETFs/RWAs **and** ETH-USD (still an open choice — see below)
- The tokenized **asset contract addresses + decimals + LTV** on Robinhood Chain,
  to seed the `Asset` table

Open question: which **price feed**? The assets are tokenized equities/ETFs/
treasuries/metals plus ETH-USD, so it needs both equity and crypto coverage
(e.g. a market-data API for the RWAs and an ETH oracle). Tell me the provider
and I'll wire `lib/prices.ts` to it.

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000  (frontend runs today)
npm test           # money + fair + game RTP tests (Monte-Carlo, ~7s)
npm run build      # production build
```

Prisma:

```bash
cp .env.example .env    # fill in real values
npm run prisma:generate
npm run prisma:migrate  # needs a live Postgres
```

## Structure

```
app/
  layout.tsx      Root layout, fonts, metadata (renamed)
  page.tsx        Renders the client component
  globals.css     Original approved design system — unchanged
components/
  TheCage.tsx     Client component; injects markup, boots logic on mount
  markup.ts       Static markup (loader, nav, pages, games)
  casino.ts       Current client-side game logic (to be replaced by server
                  calls in later steps; client RNG will be deleted)
lib/
  env.ts          zod env parsing (public/server split)
  money.ts        BigInt minor-unit money primitives (§7)
  fair.ts         Provably-fair core (§10.1)
  games/          Pure game resolution + RTP math (rollit, coin, dice, mines, hilo)
prisma/
  schema.prisma   Full data model (§5)
tests/            money / fair / games unit + RTP tests
```

## Money rules (non-negotiable)

Every monetary value is a `bigint` in minor units — cents for chips/fiat, wei
for ETH, basis points for ratios. No floating-point money anywhere. Division
always truncates toward zero, i.e. down / toward the house, on every payout. See
`lib/money.ts` and the tests.

## Notes

- `reactStrictMode` is disabled so the imperative frontend init runs once in dev.
- `tsconfig.json` currently uses `strict: false` to match the ported client
  logic; new backend modules under `lib/` are written to be type-safe regardless.
- Remaining `npm audit` advisories are transitive (postcss/sharp inside Next's
  build tooling); their only automated fix downgrades Next, so they are left.
