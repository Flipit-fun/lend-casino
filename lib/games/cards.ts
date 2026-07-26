/** Card display helpers shared by Hi-Lo and Blackjack. Values are 1 (A) .. 13 (K). */
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUITS = [
  { s: "\u2660", c: "b" }, // spade
  { s: "\u2665", c: "r" }, // heart
  { s: "\u2666", c: "r" }, // diamond
  { s: "\u2663", c: "b" }, // club
];

export interface CardView {
  value: number;
  rank: string;
  suit: string;
  color: "r" | "b";
}

export function cardView(value: number, suitIdx: number): CardView {
  const su = SUITS[suitIdx % 4];
  return { value, rank: RANKS[value - 1], suit: su.s, color: su.c as "r" | "b" };
}
