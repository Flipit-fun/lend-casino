import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateServerSeed,
  hashSeed,
  fairSource,
  makeSource,
  shuffle,
} from "../lib/fair";

test("server seed is 32 bytes hex and hash is sha256", () => {
  const seed = generateServerSeed();
  assert.match(seed, /^[0-9a-f]{64}$/);
  const h = hashSeed(seed);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hashSeed(seed), h); // stable
  assert.notEqual(hashSeed(generateServerSeed()), h);
});

test("fairSource is deterministic for the same (seed, client, nonce)", () => {
  const seed = "a".repeat(64);
  const seq = (nonce: number) => {
    const s = fairSource(seed, "player-seed", nonce);
    return Array.from({ length: 20 }, () => s.int(37));
  };
  assert.deepEqual(seq(0), seq(0));
  assert.notDeepEqual(seq(0), seq(1)); // nonce advances the stream
});

test("int(1) is always 0; float stays in [0,1)", () => {
  const s = fairSource(generateServerSeed(), "c", 0);
  for (let i = 0; i < 100; i++) assert.equal(s.int(1), 0);
  for (let i = 0; i < 1000; i++) {
    const f = s.float();
    assert.ok(f >= 0 && f < 1);
  }
});

test("rejection sampling is unbiased for a non-power-of-two range", () => {
  // 37 does not divide 256, so naive modulo would over-weight 0..33.
  const N = 37;
  const draws = 200_000;
  const counts = new Array(N).fill(0);
  const s = fairSource(generateServerSeed(), "uniformity", 0);
  for (let i = 0; i < draws; i++) counts[s.int(N)]++;
  const expected = draws / N;
  for (let k = 0; k < N; k++) {
    const dev = Math.abs(counts[k] - expected) / expected;
    assert.ok(dev < 0.06, `bucket ${k} deviated ${(dev * 100).toFixed(1)}%`);
  }
});

test("shuffle is a permutation", () => {
  const src = makeSource(() => Math.floor(Math.random() * 256));
  const arr = Array.from({ length: 52 }, (_, i) => i);
  const shuffled = shuffle([...arr], src);
  assert.equal(shuffled.length, 52);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), arr);
});
