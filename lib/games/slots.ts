/**
 * Slots — pure resolution (§10.2). Three independent reels drawn from a shared
 * weighted strip. Pays on three-of-a-kind (all symbols) and two-of-a-kind for
 * the higher symbols only. Multipliers are ×100 (basis of a whole multiplier)
 * so fractional payouts stay in integer math; the return is stake-inclusive.
 *
 * Target RTP ≈ 0.96 (3.51% edge), computed by enumerating the full 32^3 outcome
 * distribution. If you edit STRIP / PAY_3 / PAY_2, recompute the RTP the same
 * way so the house edge stays where you want it.
 */
import type { RandomSource } from "../fair";
import { mulDivFloor } from "../money";

export type SlotSymbol = "cherry" | "lemon" | "bell" | "star" | "diamond" | "seven";

/** Reel strip: each symbol repeated by its weight. All three reels use it. */
export const STRIP: SlotSymbol[] = [
  ...Array<SlotSymbol>(9).fill("cherry"),
  ...Array<SlotSymbol>(7).fill("lemon"),
  ...Array<SlotSymbol>(6).fill("bell"),
  ...Array<SlotSymbol>(5).fill("star"),
  ...Array<SlotSymbol>(3).fill("diamond"),
  ...Array<SlotSymbol>(2).fill("seven"),
]; // length 32

/** Three-of-a-kind multipliers (×100, stake-inclusive). */
export const PAY_3: Record<SlotSymbol, bigint> = {
  cherry: 400n, // ×4
  lemon: 500n, // ×5
  bell: 1000n, // ×10
  star: 2000n, // ×20
  diamond: 5000n, // ×50
  seven: 20000n, // ×200
};

/** Two-of-a-kind multipliers (×100). Only the higher symbols pay a pair. */
export const PAY_2: Partial<Record<SlotSymbol, bigint>> = {
  bell: 150n, // ×1.5
  star: 200n, // ×2
  diamond: 500n, // ×5
  seven: 2000n, // ×20
};

/** Draw three reels as indices into STRIP (indices kept for UI animation). */
export function drawSlots(src: RandomSource): { indices: [number, number, number]; reels: [SlotSymbol, SlotSymbol, SlotSymbol] } {
  const i = src.int(STRIP.length);
  const j = src.int(STRIP.length);
  const k = src.int(STRIP.length);
  return { indices: [i, j, k], reels: [STRIP[i], STRIP[j], STRIP[k]] };
}

/** The matched pair symbol when exactly two of three reels match, else null. */
export function pairSymbol(reels: [SlotSymbol, SlotSymbol, SlotSymbol]): SlotSymbol | null {
  const [a, b, c] = reels;
  if (a === b && b === c) return null; // that's a triple, not a pair
  if (a === b || a === c) return a;
  if (b === c) return b;
  return null;
}

/** Chips returned (stake-inclusive) for a spin. */
export function resolveSlots(stakeCents: bigint, reels: [SlotSymbol, SlotSymbol, SlotSymbol]): bigint {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    return mulDivFloor(stakeCents, PAY_3[a], 100n);
  }
  const pair = pairSymbol(reels);
  if (pair && PAY_2[pair] !== undefined) {
    return mulDivFloor(stakeCents, PAY_2[pair] as bigint, 100n);
  }
  return 0n;
}
