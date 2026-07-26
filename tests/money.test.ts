import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mulDivFloor,
  applyBps,
  netAfterFeeBps,
  chipsToCents,
  centsToChips,
  ethOwedWei,
  weiToCents,
  formatUsdCents,
  formatChips,
  formatEthWei,
  WEI_PER_ETH,
} from "../lib/money";

test("mulDivFloor rounds down (toward the house)", () => {
  assert.equal(mulDivFloor(7n, 1n, 2n), 3n); // 3.5 -> 3
  assert.equal(mulDivFloor(99n, 1n, 100n), 0n);
  assert.equal(mulDivFloor(100n, 196n, 100n), 196n);
  assert.equal(mulDivFloor(101n, 196n, 100n), 197n); // 197.96 -> 197
});

test("mulDivFloor guards", () => {
  assert.throws(() => mulDivFloor(1n, 1n, 0n));
  assert.throws(() => mulDivFloor(-1n, 1n, 1n));
});

test("applyBps / netAfterFeeBps", () => {
  assert.equal(applyBps(10_000n, 9700), 9700n);
  assert.equal(applyBps(1_000n, 50), 5n); // 0.5%
  assert.equal(netAfterFeeBps(10_000n, 50), 9950n);
});

test("chip <-> cents", () => {
  assert.equal(chipsToCents(25n), 2500n);
  assert.equal(centsToChips(2599n), 25n); // floor
});

test("ethOwedWei and weiToCents round-trip within flooring", () => {
  const ethUsdCents = 341_255n; // $3,412.55
  const debtCents = 1_000_00n; // $1,000.00
  const wei = ethOwedWei(debtCents, ethUsdCents);
  // 1000 / 3412.55 ETH ~= 0.293036 ETH
  assert.ok(wei > 0n && wei < WEI_PER_ETH);
  const back = weiToCents(wei, ethUsdCents);
  assert.ok(back <= debtCents && debtCents - back < 100n); // within a dollar of flooring
  assert.throws(() => ethOwedWei(1n, 0n));
});

test("formatters", () => {
  assert.equal(formatUsdCents(123_456n), "$1,234.56");
  assert.equal(formatUsdCents(0n), "$0.00");
  assert.equal(formatUsdCents(-500n), "-$5.00");
  assert.equal(formatChips(1_250_00n), "1,250");
  assert.equal(formatEthWei(WEI_PER_ETH + WEI_PER_ETH / 2n, 4), "1.5000");
  assert.equal(formatEthWei(293_036_000_000_000_000n, 4), "0.2930");
});

test("ledger invariant: balanceAfter chain sums to total delta", () => {
  // Pure simulation of the §7 ledger invariant. Each entry records the
  // running balance; replaying deltas must equal the final stored balance.
  const deltas = [10_000n, -2_500n, 4_900n, -100n, -7_000n, 3_333n];
  let balance = 0n;
  const entries: { delta: bigint; balanceAfter: bigint }[] = [];
  for (const d of deltas) {
    balance += d;
    assert.ok(balance >= 0n, "balance must never go negative");
    entries.push({ delta: d, balanceAfter: balance });
  }
  const replayed = entries.reduce((a, e) => a + e.delta, 0n);
  assert.equal(replayed, balance);
  assert.equal(entries.at(-1)!.balanceAfter, replayed);
});
