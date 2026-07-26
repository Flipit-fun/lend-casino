# Deploying Lend.Casino

## Architecture (what runs where)

Lend.Casino is two deployables plus managed backing services:

```
┌─────────────────────┐     ┌──────────────────────┐
│  Web app (Next.js)  │     │  Worker (Node loop)  │
│  Vercel             │     │  Railway / Render     │
│  - API routes + UI  │     │  - deposit watcher    │
│  - reads chain      │     │  - payout sender ★    │
│  - NO private key   │     │  - liquidation/reaper │
└─────────┬───────────┘     └───────────┬───────────┘
          │                             │
          └──────────┬──────────────────┘
                     │
      ┌──────────────┼───────────────┐
      │              │               │
  Supabase        Upstash        Robinhood Chain
  (Postgres)      (Redis)        (RPC, via Alchemy)
```

★ The worker is the only component that holds `TREASURY_PRIVATE_KEY` and signs
transactions. The web app never signs — it only reads the treasury balance and
quotes. Vercel's serverless model can't run the always-on watcher/payout loops,
so the worker needs a host that runs a persistent process.

## Prerequisites

- [ ] Supabase project (Postgres) — pooled + direct connection strings
- [ ] Upstash Redis (or any Redis) — `rediss://…` URL
- [ ] WalletConnect / Reown project id (add your deploy domain to its allowlist)
- [ ] Alchemy Robinhood Chain app + API key (public RPC is rate-limited — don't
      use it in production)
- [ ] A treasury wallet, **funded with testnet/mainnet ETH for gas** (and holding
      any tokens it will release)
- [ ] `SESSION_SECRET` — `openssl rand -hex 32`

## Environment matrix

| Var | Web (Vercel) | Worker | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_CHAIN_ID` / `_NAME` / `_RPC_URL` / `_EXPLORER_URL` | ✅ | ✅ | public |
| `NEXT_PUBLIC_TREASURY_ADDRESS` | ✅ | ✅ | public |
| `NEXT_PUBLIC_WC_PROJECT_ID` | ✅ | — | RainbowKit |
| `RPC_URL_PRIVATE` | ✅ | ✅ | Alchemy URL |
| `DATABASE_URL` (pooled :6543) | ✅ | ✅ | pgbouncer |
| `DIRECT_URL` (:5432) | (migrations) | (migrations) | release step |
| `REDIS_URL` | ✅ | ✅ | Upstash `rediss://` |
| `SESSION_SECRET` | ✅ | — | cookie auth |
| `PRICE_SOURCE` (+ `PRICE_FEED_URL/KEY`) | ✅ | ✅ | `static` or `api` |
| `SELL_POLICY`, `DEPOSIT_CONFIRMATIONS`, `PRICE_MAX_STALENESS_SEC` | ✅ | ✅ | policy |
| `TREASURY_MIN_ETH_WEI`, `PAYOUT_PER_TX_CAP_WEI`, `PAYOUT_DAILY_CAP_WEI` | ✅ | ✅ | caps/health |
| `TREASURY_PRIVATE_KEY` | ❌ | ✅ | **worker only** |

`NEXT_PUBLIC_*` are inlined at build time, so they must be set in Vercel before
the build runs.

## Steps

### 1. Provision Redis (Upstash)
Create a database, copy the `rediss://…` connection string → `REDIS_URL`.

### 2. Run migrations + seed against the production DB
From your machine (or a CI release step), with prod `DATABASE_URL`/`DIRECT_URL`:

```bash
npm ci
npm run migrate:deploy      # prisma migrate deploy
npm run prisma:seed         # seed the 5 assets (edit prisma/seed.ts for real addresses)
```

### 3. Deploy the web app (Vercel)
- Import the repo in Vercel.
- Framework preset: Next.js (build `next build`, output handled automatically).
- Add all env vars from the "Web" column above (Production + Preview).
- Deploy. `postinstall` runs `prisma generate` automatically.

### 4. Deploy the worker (Railway or Render)
- New service from the same repo.
- Build command: `npm ci` (runs `postinstall` → `prisma generate`).
- Start command: `npm run worker`.
- Add all env vars from the "Worker" column **including `TREASURY_PRIVATE_KEY`**.
- Ensure it's a single instance (the payout loop is single-flight; don't scale to >1).

### 5. Post-deploy checks
- `GET https://<web>/api/health` → `healthy: true` (db, redis, rpc, treasury, price).
- Open the site, connect Robinhood Wallet, sign in (SIWE), confirm the purse loads.
- Watch the worker logs; confirm the watcher advances (`DepositWatch.lastBlock`).
- Do a small faucet-token deposit → confirm it credits chips after
  `DEPOSIT_CONFIRMATIONS` blocks.

## Production hardening (before real value)

- **Key management:** move `TREASURY_PRIVATE_KEY` to a KMS or multisig. The seam
  is `lib/treasury/signer.ts` — swap the body there only.
- **RPC:** use Alchemy (or another provider) for both `RPC_URL_PRIVATE` and the
  public RPC; the public endpoint is rate-limited.
- **Caps:** set `PAYOUT_PER_TX_CAP_WEI` / `PAYOUT_DAILY_CAP_WEI` conservatively.
- **Cookies:** already `secure` + `httpOnly` + `sameSite=lax` in production.
- **WalletConnect:** add the deploy domain to the project's allowlist.
- **Legal:** custodial + credit + wagering touches gambling / lending / money
  transmission regimes — a licensing question, not a technical one.
