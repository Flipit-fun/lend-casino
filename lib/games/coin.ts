/**
 * Coin Toss — pure resolution (§10.2). Correct call pays ×1.96. RTP 0.98.
 */
import type { RandomSource } from "../fair";
import { mulDivFloor } from "../money";

export type CoinSide = "H" | "T";

export function drawCoin(src: RandomSource): CoinSide {
  return src.int(2) === 0 ? "H" : "T";
}

/** Chips returned (stake-inclusive). Winner gets stake × 196 / 100, floored. */
export function resolveCoin(side: CoinSide, stakeCents: bigint, outcome: CoinSide): bigint {
  return outcome === side ? mulDivFloor(stakeCents, 196n, 100n) : 0n;
}
