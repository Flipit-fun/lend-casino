import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSource, type RandomSource } from "../lib/fair";
import { drawRollit, resolveRollit } from "../lib/games/rollit";
import { drawCoin, resolveCoin } from "../lib/games/coin";
import { drawDice, resolveDice } from "../lib/games/dice";
import { placeMines, minesPayout, MINES_TILES } from "../lib/games/mines";
import { drawRank, hiloStepMultBps, hiloWin, type HiloDir } from "../lib/games/hilo";

// A uniform RandomSource for RTP measurement (unbiased outcome distribution).
function mathSource(): RandomSource {
  return makeSource(() => Math.floor(Math.random() * 256));
}

// Large stake so per-round flooring is negligible against the theoretical RTP.
const STAKE = 100_000n; // cents

function rtp(totalReturn: bigint, totalStake: bigint): number {
  return Number(totalReturn) / Number(totalStake);
}

test("rollit RTP ~= 0.9730 on even-money (red)", () => {
  const src = mathSource();
  const rounds = 200_000;
  let ret = 0n;
  for (let i = 0; i < rounds; i++) {
    ret += resolveRollit({ red: STAKE }, drawRollit(src).number);
  }
  assert.ok(Math.abs(rtp(ret, STAKE * BigInt(rounds)) - 0.973) < 0.01);
});

test("rollit RTP ~= 0.9730 on a dozen", () => {
  const src = mathSource();
  const rounds = 300_000;
  let ret = 0n;
  for (let i = 0; i < rounds; i++) {
    ret += resolveRollit({ "d:1": STAKE }, drawRollit(src).number);
  }
  assert.ok(Math.abs(rtp(ret, STAKE * BigInt(rounds)) - 0.973) < 0.012);
});

test("rollit RTP ~= 0.9730 on a straight (high variance)", () => {
  const src = mathSource();
  const rounds = 500_000;
  let ret = 0n;
  for (let i = 0; i < rounds; i++) {
    ret += resolveRollit({ "n:17": STAKE }, drawRollit(src).number);
  }
  assert.ok(Math.abs(rtp(ret, STAKE * BigInt(rounds)) - 0.973) < 0.045);
});

test("coin RTP ~= 0.98", () => {
  const src = mathSource();
  const rounds = 200_000;
  let ret = 0n;
  for (let i = 0; i < rounds; i++) ret += resolveCoin("H", STAKE, drawCoin(src));
  assert.ok(Math.abs(rtp(ret, STAKE * BigInt(rounds)) - 0.98) < 0.01);
});

test("dice RTP ~= 0.98 at every line", () => {
  const src = mathSource();
  const rounds = 200_000;
  for (const target of [2, 25, 50, 75, 95]) {
    let ret = 0n;
    for (let i = 0; i < rounds; i++) ret += resolveDice(target, STAKE, drawDice(src));
    const r = rtp(ret, STAKE * BigInt(rounds));
    // Assert against the theoretical standard error (extreme lines like
    // target=2 pay 49x at 2% odds, so a flat tolerance would be flaky).
    const winProb = target / 100;
    const mult = 98 / target; // return multiple on a win
    const variance = winProb * mult * mult - 0.98 * 0.98;
    const stdErr = Math.sqrt(variance / rounds);
    assert.ok(
      Math.abs(r - 0.98) < 5 * stdErr,
      `target ${target} rtp ${r.toFixed(4)} (5σ=${(5 * stdErr).toFixed(4)})`
    );
  }
});

test("mines RTP ~= 0.97 across mine counts and cash-out depths", () => {
  const src = mathSource();
  for (const m of [1, 3, 5, 10]) {
    for (const cashAt of [1, 3, 5]) {
      if (cashAt > MINES_TILES - m) continue;
      const rounds = 200_000;
      let ret = 0n;
      for (let i = 0; i < rounds; i++) {
        const bombs = placeMines(m, src);
        // Reveal tiles 0,1,2,... until we hit `cashAt` safe picks or a bomb.
        let safe = 0;
        let tile = 0;
        let busted = false;
        while (safe < cashAt) {
          if (bombs.has(tile)) {
            busted = true;
            break;
          }
          safe++;
          tile++;
        }
        if (!busted) ret += minesPayout(STAKE, cashAt, m);
      }
      const r = rtp(ret, STAKE * BigInt(rounds));
      assert.ok(Math.abs(r - 0.97) < 0.02, `m=${m} cashAt=${cashAt} rtp ${r.toFixed(4)}`);
    }
  }
});

test("hilo RTP ~= 0.97 per call, both directions", () => {
  const src = mathSource();
  for (const dir of ["hi", "lo"] as HiloDir[]) {
    const rounds = 300_000;
    let ret = 0n;
    for (let i = 0; i < rounds; i++) {
      const current = drawRank(src);
      const next = drawRank(src);
      if (hiloWin(dir, current, next)) {
        ret += minesLikePayout(STAKE, hiloStepMultBps(current, dir));
      }
    }
    const r = rtp(ret, STAKE * BigInt(rounds));
    assert.ok(Math.abs(r - 0.97) < 0.02, `${dir} rtp ${r.toFixed(4)}`);
  }
});

// stake * multBps / 10000, floored — mirrors server payout math.
function minesLikePayout(stakeCents: bigint, multBps: bigint): bigint {
  return (stakeCents * multBps) / 10_000n;
}
