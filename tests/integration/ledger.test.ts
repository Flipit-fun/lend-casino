/**
 * Ledger integration tests (§16) — run against the configured database.
 *   npm run test:integration
 * Each test creates an isolated user and cleans up after itself.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../lib/db";
import {
  applyLedger,
  creditChips,
  debitChips,
  replayBalance,
  InsufficientChipsError,
} from "../../lib/ledger";

const created: string[] = [];

async function makeUser(): Promise<string> {
  const u = await db.user.create({
    data: { address: `0xtest_${randomUUID()}`, clientSeed: "seed" },
  });
  created.push(u.id);
  return u.id;
}

after(async () => {
  for (const id of created) {
    await db.ledgerEntry.deleteMany({ where: { userId: id } });
    await db.user.delete({ where: { id } }).catch(() => {});
  }
  await db.$disconnect();
});

test("replay invariant: stored balance equals sum of deltas", async () => {
  const userId = await makeUser();
  await creditChips({ userId, amountCents: 10_000n, reason: "COLLATERAL_DRAW" });
  await debitChips({ userId, amountCents: 2_500n, reason: "BET_STAKE" });
  await creditChips({ userId, amountCents: 4_900n, reason: "BET_RETURN" });
  await debitChips({ userId, amountCents: 7_000n, reason: "CHIP_SALE" });

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const replay = await replayBalance(userId);
  assert.equal(user.chipsCents, 5_400n);
  assert.equal(replay, user.chipsCents);
});

test("insufficient chips throws and does not mutate", async () => {
  const userId = await makeUser();
  await creditChips({ userId, amountCents: 100n, reason: "COLLATERAL_DRAW" });
  await assert.rejects(
    () => debitChips({ userId, amountCents: 500n, reason: "BET_STAKE" }),
    InsufficientChipsError
  );
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(user.chipsCents, 100n);
  assert.equal(await replayBalance(userId), 100n);
});

test("idempotency: a repeated key applies exactly once", async () => {
  const userId = await makeUser();
  const key = `idem_${randomUUID()}`;
  const first = await creditChips({
    userId,
    amountCents: 1_000n,
    reason: "BET_RETURN",
    idempotencyKey: key,
  });
  const second = await creditChips({
    userId,
    amountCents: 1_000n,
    reason: "BET_RETURN",
    idempotencyKey: key,
  });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.balanceAfter, first.balanceAfter);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(user.chipsCents, 1_000n); // applied once, not twice
});

test("concurrency: only as many bets as the balance covers succeed", async () => {
  const userId = await makeUser();
  const stake = 100n;
  const covered = 8; // fund exactly 8 stakes
  const attempts = 16;
  await creditChips({ userId, amountCents: stake * BigInt(covered), reason: "COLLATERAL_DRAW" });

  const results = await Promise.allSettled(
    Array.from({ length: attempts }, () =>
      debitChips({ userId, amountCents: stake, reason: "BET_STAKE" })
    )
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter(
    (r) => r.status === "rejected" && r.reason instanceof InsufficientChipsError
  ).length;

  assert.equal(ok, covered, `expected ${covered} successful debits, got ${ok}`);
  assert.equal(ok + rejected, attempts, "every attempt either succeeded or hit InsufficientChips");

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(user.chipsCents, 0n);
  assert.equal(await replayBalance(userId), 0n);
});
