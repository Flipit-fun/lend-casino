/**
 * Money primitives for Lend.Casino (§7).
 *
 * THE ONLY RULE: every monetary value is a `bigint` in minor units.
 *  - chips  -> cents      (1 chip = 100 cents = $1.00)
 *  - fiat   -> cents
 *  - ETH    -> wei
 *  - ratios -> basis points as plain integers (7000 = 70%, 9700 = 97%)
 *
 * There is no floating-point money anywhere. Division always truncates toward
 * zero, which for the non-negative amounts we deal in means rounding DOWN —
 * i.e. toward the house — on every payout.
 */

export const CENTS_PER_CHIP = 100n;
export const BPS_DENOMINATOR = 10_000n;
export const WEI_PER_ETH = 1_000_000_000_000_000_000n; // 10^18

/**
 * floor((value * numerator) / denominator) using pure bigint arithmetic.
 * Guards against division by zero. Only valid for non-negative inputs
 * (all money here is non-negative); negative inputs would round toward zero,
 * not toward negative infinity, so don't feed it signed values.
 */
export function mulDivFloor(value: bigint, numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("mulDivFloor: division by zero");
  if (value < 0n || numerator < 0n || denominator < 0n) {
    throw new Error("mulDivFloor: expects non-negative operands");
  }
  return (value * numerator) / denominator;
}

/** Apply a basis-point rate, rounding down. applyBps(1000, 9700) -> 970. */
export function applyBps(value: bigint, bps: bigint | number): bigint {
  return mulDivFloor(value, BigInt(bps), BPS_DENOMINATOR);
}

/** Amount kept after a fee expressed in bps. netAfterFeeBps(10000, 50) -> 9950. */
export function netAfterFeeBps(value: bigint, feeBps: bigint | number): bigint {
  return value - applyBps(value, feeBps);
}

/* -------------------------------- chips ---------------------------------- */

/** Whole chips -> cents. */
export const chipsToCents = (chips: bigint): bigint => chips * CENTS_PER_CHIP;

/** Cents -> whole chips, rounded down. */
export const centsToChips = (cents: bigint): bigint => cents / CENTS_PER_CHIP;

/* --------------------------------- eth ----------------------------------- */

/**
 * ETH owed in wei for a debt expressed in USD cents, given the ETH/USD mark
 * in cents. wei = debtCents * 10^18 / ethUsdCents, rounded down.
 */
export function ethOwedWei(debtCents: bigint, ethUsdCents: bigint): bigint {
  if (ethUsdCents <= 0n) throw new Error("ethOwedWei: ethUsdCents must be positive");
  return mulDivFloor(debtCents, WEI_PER_ETH, ethUsdCents);
}

/** USD cents value of a wei amount at a given ETH/USD mark, rounded down. */
export function weiToCents(wei: bigint, ethUsdCents: bigint): bigint {
  return mulDivFloor(wei, ethUsdCents, WEI_PER_ETH);
}

/* ------------------------------ formatting -------------------------------- */
// Formatting divides by the minor unit at the very last moment, for display
// only. Never feed a formatted string back into arithmetic.

function groupInt(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 123456n cents -> "$1,234.56". */
export function formatUsdCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const dollars = abs / 100n;
  const rem = abs % 100n;
  return `${neg ? "-" : ""}$${groupInt(dollars.toString())}.${rem.toString().padStart(2, "0")}`;
}

/** Chip balance in cents -> whole-chip count with grouping, e.g. "1,250". */
export function formatChips(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  return `${neg ? "-" : ""}${groupInt(centsToChips(abs).toString())}`;
}

/** wei -> fixed-decimals ETH string, rounded down. formatEthWei(x, 4). */
export function formatEthWei(wei: bigint, decimals = 4): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / WEI_PER_ETH;
  const frac = abs % WEI_PER_ETH;
  const fracFull = frac.toString().padStart(18, "0");
  const fracCut = decimals > 0 ? "." + fracFull.slice(0, decimals) : "";
  return `${neg ? "-" : ""}${groupInt(whole.toString())}${fracCut}`;
}
