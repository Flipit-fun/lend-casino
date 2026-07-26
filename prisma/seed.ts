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

// Real Robinhood Chain (testnet) stock-token ERC-20 addresses, 18 decimals.
const ASSETS = [
  { symbol: "AAPL", name: "Apple Inc.", kind: "Tokenized equity", ltvBps: 7000, unitLabel: "shares", token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
  { symbol: "NVDA", name: "NVIDIA Corp.", kind: "Tokenized equity", ltvBps: 6500, unitLabel: "shares", token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
  { symbol: "TSLA", name: "Tesla Inc.", kind: "Tokenized equity", ltvBps: 6000, unitLabel: "shares", token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
  { symbol: "SPY", name: "S&P 500 Trust", kind: "Tokenized ETF", ltvBps: 7000, unitLabel: "units", token: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" },
  { symbol: "MSTR", name: "MicroStrategy", kind: "Tokenized equity", ltvBps: 5000, unitLabel: "shares", token: "0xec262a75e413fAfD0dF80480274532C79D42da09" },
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
