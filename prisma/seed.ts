/**
 * Seed the Asset table (§5).
 *
 * NOTE: tokenAddress values are PLACEHOLDERS. Replace each with the real
 * tokenized-asset contract address on Robinhood Chain before any on-chain
 * deposit is processed. LTVs and unit labels mirror the approved design.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const ONE_UNIT = 1_000_000_000_000_000_000n; // 10^18 (assumes 18-decimal tokens)

// Canonical Robinhood Chain MAINNET stock-token ERC-20 addresses (18 decimals),
// from https://docs.robinhood.com/chain/contracts/ . LTVs are our own risk
// policy per asset. Equities, ETFs, a treasury fund, and a metal ETF — matching
// the original design's collateral themes.
// token = ERC-20 contract (deposits/watcher), from docs.robinhood.com/chain/contracts
const ASSETS = [
  { symbol: "AAPL", name: "Apple Inc.", kind: "Tokenized equity", ltvBps: 6500, unitLabel: "shares", token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
  { symbol: "NVDA", name: "NVIDIA Corp.", kind: "Tokenized equity", ltvBps: 6500, unitLabel: "shares", token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
  { symbol: "TSLA", name: "Tesla Inc.", kind: "Tokenized equity", ltvBps: 6000, unitLabel: "shares", token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
  { symbol: "MSFT", name: "Microsoft Corp.", kind: "Tokenized equity", ltvBps: 7000, unitLabel: "shares", token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74" },
  { symbol: "GOOGL", name: "Alphabet Class A", kind: "Tokenized equity", ltvBps: 6500, unitLabel: "shares", token: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" },
  { symbol: "AMZN", name: "Amazon.com Inc.", kind: "Tokenized equity", ltvBps: 6500, unitLabel: "shares", token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54" },
  { symbol: "META", name: "Meta Platforms", kind: "Tokenized equity", ltvBps: 6500, unitLabel: "shares", token: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35" },
  { symbol: "PLTR", name: "Palantir Technologies", kind: "Tokenized equity", ltvBps: 5000, unitLabel: "shares", token: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A" },
  { symbol: "COIN", name: "Coinbase Global", kind: "Tokenized equity", ltvBps: 5000, unitLabel: "shares", token: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b" },
  { symbol: "MSTR", name: "Strategy Inc.", kind: "Tokenized equity", ltvBps: 5000, unitLabel: "shares", token: "0xec262a75e413fAfD0dF80480274532C79D42da09" },
  { symbol: "AMD", name: "Advanced Micro Devices", kind: "Tokenized equity", ltvBps: 6000, unitLabel: "shares", token: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC" },
  { symbol: "INTC", name: "Intel Corp.", kind: "Tokenized equity", ltvBps: 6000, unitLabel: "shares", token: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681" },
  // $LEND — our own token. No Chainlink oracle: priced live via DexScreener
  // (see DEXSCREENER_TOKENS in lib/priceFeeds.ts). Low LTV: thin liquidity + high volatility.
  { symbol: "LEND", name: "Lend Casino", kind: "Platform token", ltvBps: 5000, unitLabel: "tokens", token: "0x808945DaBDc5cC8D6b12eAaFE2629e73E3B8406f" },
];

async function main() {
  const symbols = ASSETS.map((a) => a.symbol);

  for (const a of ASSETS) {
    const token = a.token.toLowerCase(); // store lowercase for on-chain compares
    const fields = {
      name: a.name,
      kind: a.kind,
      tokenAddress: token,
      decimals: 18,
      ltvBps: a.ltvBps,
      unitLabel: a.unitLabel,
      enabled: true,
      minDepositRaw: (ONE_UNIT / 100n).toString(), // 0.01 unit
    };
    await db.asset.upsert({
      where: { symbol: a.symbol },
      update: fields,
      create: { symbol: a.symbol, ...fields },
    });
  }

  // Remove assets no longer offered (e.g. earlier placeholder TBIL/XAUT).
  const removed = await db.asset.deleteMany({ where: { symbol: { notIn: symbols } } });
  console.log(`Seeded ${ASSETS.length} assets; removed ${removed.count} stale.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
