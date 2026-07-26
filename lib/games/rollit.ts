/**
 * Rollit (single-zero roulette) — pure resolution (§10.2).
 * RTP is exactly 36/37 (2.70% edge) on every bet type.
 * Multipliers are applied to the STAKE and include the stake in the return.
 */
import type { RandomSource } from "../fair";

export const ROLLIT_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
export const ROLLIT_REDS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export function colorOf(n: number): "green" | "red" | "black" {
  return n === 0 ? "green" : ROLLIT_REDS.has(n) ? "red" : "black";
}

/** Draw a wheel result. Returns the pocket index (for animation) and number. */
export function drawRollit(src: RandomSource): { index: number; number: number } {
  const index = src.int(37);
  return { index, number: ROLLIT_ORDER[index] };
}

/**
 * Total chips returned (stake-inclusive) for a set of bets given the winning
 * number. Bet keys match the frontend layout:
 *   n:X (0..36) straight ×36 | d:1..3 dozen ×3 | c:1..3 column ×3
 *   red|black|odd|even|low|high even-money ×2 (zero loses all outside bets)
 */
export function resolveRollit(bets: Record<string, bigint>, win: number): bigint {
  let ret = 0n;
  const isRed = ROLLIT_REDS.has(win);
  for (const k in bets) {
    const amt = bets[k];
    if (amt <= 0n) continue;
    if (k === "n:" + win) ret += amt * 36n;
    else if (k.startsWith("d:")) {
      if (win > 0 && Math.ceil(win / 12) === +k[2]) ret += amt * 3n;
    } else if (k.startsWith("c:")) {
      if (win > 0 && (win % 3 || 3) === +k[2]) ret += amt * 3n;
    } else if (k === "red" && win > 0 && isRed) ret += amt * 2n;
    else if (k === "black" && win > 0 && !isRed) ret += amt * 2n;
    else if (k === "odd" && win > 0 && win % 2 === 1) ret += amt * 2n;
    else if (k === "even" && win > 0 && win % 2 === 0) ret += amt * 2n;
    else if (k === "low" && win >= 1 && win <= 18) ret += amt * 2n;
    else if (k === "high" && win >= 19) ret += amt * 2n;
  }
  return ret;
}
