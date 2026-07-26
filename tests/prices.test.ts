import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StaticPriceProvider,
  usdToCents,
  PriceUnavailableError,
  getMark,
  getEthUsd,
} from "../lib/prices";

test("usdToCents converts at the boundary", () => {
  assert.equal(usdToCents(231.4), 23_140n);
  assert.equal(usdToCents(100.14), 10_014n);
  assert.equal(usdToCents(2684.3), 268_430n);
});

test("static provider returns fresh marks in cents", async () => {
  const p = new StaticPriceProvider();
  const aapl = await p.getMark("aapl"); // case-insensitive
  assert.equal(aapl.cents, 23_140n);
  assert.ok(Date.now() - aapl.asOf.getTime() < 1000);
  const eth = await p.getEthUsd();
  assert.equal(eth.cents, 341_255n);
});

test("static provider throws on unknown symbol", async () => {
  const p = new StaticPriceProvider();
  await assert.rejects(() => p.getMark("DOGE"), PriceUnavailableError);
});

test("top-level getMark/getEthUsd work with default static source", async () => {
  const m = await getMark("SPY");
  assert.equal(m.cents, 61_277n);
  const e = await getEthUsd();
  assert.equal(e.cents, 341_255n);
});
