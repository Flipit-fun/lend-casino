import { parseAbi } from "viem";

/**
 * Chainlink AggregatorV3 interface (standard proxy) — used by every Robinhood
 * stock-token and crypto feed on Robinhood Chain.
 */
export const AGGREGATOR_V3_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

/**
 * Chainlink STANDARD PROXY feed addresses on Robinhood Chain mainnet, per
 * symbol. Source of truth (read, don't guess):
 *   https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood
 *
 * Only the three confirmed from the docs are filled in. Add the rest from the
 * Chainlink page (use the "Standard Proxy", NOT the SVR proxy). Any symbol
 * missing here falls back to the static price.
 */
export const ROBINHOOD_FEEDS: Record<string, `0x${string}`> = {
  AAPL: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0",
  NVDA: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",
  TSLA: "0x4A1166a659A55625345e9515b32adECea5547C38",
};
