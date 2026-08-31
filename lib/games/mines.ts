/**
 * Mines — pure resolution (§10.3). 25 tiles, m mines. RTP 0.97 at every mine
 * count and every cash-out depth.
 *
 * Multiplier in basis points:
 *   mult(k) = 9700 × Π[i=0..k-1] (25 − i) / (25 − m − i) / 10000
 * applied stepwise with integer mulDivFloor.
 */
import { type RandomSource, shuffle } from "../fair";
import { mulDivFloor } from "../money";

export const MINES_TILES = 25;

/** Choose `mines` distinct bomb positions in [0,25) from the seed stream. */
export function placeMines(mines: number, src: RandomSource): Set<number> {
  if (!Number.isInteger(mines) || mines < 1 || mines >= MINES_TILES) {
    throw new Error("placeMines: mines must be in [1,24]");
  }
  const idx = Array.from({ length: MINES_TILES }, (_, i) => i);
  shuffle(idx, src);
  return new Set(idx.slice(0, mines));
}

/** Multiplier after k safe picks, as basis points (10000 = 1.00×). */
export function minesMultBps(k: number, mines: number): bigint {
  let acc = 9700n; // 0.97 in bps
  for (let i = 0; i < k; i++) {
    acc = mulDivFloor(acc, BigInt(MINES_TILES - i), BigInt(MINES_TILES - mines - i));
  }
  return acc;
}

/** Chips returned on cash-out after k safe picks. */
export function minesPayout(stakeCents: bigint, k: number, mines: number): bigint {
  return mulDivFloor(stakeCents, minesMultBps(k, mines), 10_000n);
}
