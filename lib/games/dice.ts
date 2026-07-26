/**
 * Dice — pure resolution (§10.2). Roll 0..9999; win if roll < target*100.
 * Return = stake × 9800 / (target*100). RTP 0.98 at every line.
 * target ∈ [2, 95].
 */
import type { RandomSource } from "../fair";
import { mulDivFloor } from "../money";

export const DICE_MIN_TARGET = 2;
export const DICE_MAX_TARGET = 95;

export function drawDice(src: RandomSource): number {
  return src.int(10_000); // 0..9999, i.e. 0.00..99.99
}

export function resolveDice(target: number, stakeCents: bigint, roll: number): bigint {
  if (!Number.isInteger(target) || target < DICE_MIN_TARGET || target > DICE_MAX_TARGET) {
    throw new Error("resolveDice: target must be an integer in [2,95]");
  }
  const won = roll < target * 100;
  return won ? mulDivFloor(stakeCents, 9800n, BigInt(target * 100)) : 0n;
}
