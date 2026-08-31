/**
 * Blackjack pure logic (§10.3, kept simple: no split/surrender, ≈1.0% edge).
 * Six decks, dealer stands on all 17, blackjack pays 3:2.
 */
import { type RandomSource, shuffle } from "../fair";

export interface Card {
  v: number; // 1 (A) .. 13 (K)
  s: number; // suit index 0..3
}

export const DECKS = 6;

export function buildShoe(src: RandomSource): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < DECKS; d++) {
    for (let s = 0; s < 4; s++) {
      for (let v = 1; v <= 13; v++) shoe.push({ v, s });
    }
  }
  shuffle(shoe, src);
  return shoe;
}

/** Best blackjack total (aces count 11 then drop to 1 as needed). */
export function score(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.v === 1) {
      aces++;
      total += 11;
    } else {
      total += c.v >= 10 ? 10 : c.v;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && score(cards) === 21;
}
