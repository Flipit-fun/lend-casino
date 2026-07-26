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
  MSFT: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E",
  GOOGL: "0xF6f373a037c30F0e5010d854385cA89185AE638b",
  AMZN: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C",
  META: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1",
  PLTR: "0x820ABedFF239034956B7A9d2F0a331f9F075eB4c",
  COIN: "0xA3a468A452940B7D6b69991207B508c609a98Ef2",
  MSTR: "0x396118bdFB181e6240E74D243F266B061c0edc3D",
  AMD: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72",
  INTC: "0x3f390C5C24628Ac7C489515402235FeAD71D1913",
};
