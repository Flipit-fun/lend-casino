/**
 * Hi-Lo — pure resolution (§10.3). Aces low (1) to Kings high (13).
 *   hi wins on higher-or-same, lo wins on lower-or-same.
 *   p = (14 − v)/13 for hi, v/13 for lo.
 *   step multiplier (bps) = 9700 / p  = 9700 × den / num.
 * RTP 0.97 per call.
 */
import type { RandomSource } from "../fair";
import { mulDivFloor } from "../money";

export type HiloDir = "hi" | "lo";

/** Draw a card rank value in [1,13]. */
export function drawRank(src: RandomSource): number {
  return src.int(13) + 1;
}

/** Probability numerator/denominator for a direction at value v. */
export function hiloProb(v: number, dir: HiloDir): { num: number; den: number } {
  return dir === "hi" ? { num: 14 - v, den: 13 } : { num: v, den: 13 };
}

/** Step multiplier in basis points for calling `dir` at current value v. */
export function hiloStepMultBps(v: number, dir: HiloDir): bigint {
  const { num, den } = hiloProb(v, dir);
  // 9700 * den / num, floored.
  return mulDivFloor(9700n, BigInt(den), BigInt(num));
}

export function hiloWin(dir: HiloDir, current: number, next: number): boolean {
  return dir === "hi" ? next >= current : next <= current;
}
