/**
 * Stateless game settlement integration tests (§6, §16).
 *   npm run test:integration
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../lib/db";
import { creditChips, replayBalance } from "../../lib/ledger";
import { generateServerSeed, hashSeed } from "../../lib/fair";
import { settleStateless } from "../../lib/gameplay";
import { resolveCoin, drawCoin } from "../../lib/games/coin";

const created: string[] = [];

async function makeFundedUser(chips: bigint): Promise<string> {
  const seed = generateServerSeed();
  const user = await db.user.create({
    data: { address: `0xg_${randomUUID()}`, clientSeed: "clientseed" },
  });
  created.push(user.id);
  const ss = await db.serverSeed.create({
    data: { userId: user.id, seed, seedHash: hashSeed(seed) },
  });
  await db.user.update({ where: { id: user.id }, data: { serverSeedId: ss.id } });
  await creditChips({ userId: user.id, amountCents: chips, reason: "COLLATERAL_DRAW" });
  return user.id;
}

after(async () => {
  for (const id of created) {
    await db.gameRound.deleteMany({ where: { userId: id } });
    await db.ledgerEntry.deleteMany({ where: { userId: id } });
    await db.serverSeed.deleteMany({ where: { userId: id } });
    await db.user.delete({ where: { id } }).catch(() => {});
  }
  await db.$disconnect();
});

test("coin settle: balance, ledger invariant, nonce all consistent", async () => {
  const userId = await makeFundedUser(10_000n);
  const stake = 1_000n;

  const r = await settleStateless({
    userId,
    game: "COIN",
    stakeCents: stake,
    resolve: (src) => {
      const outcome = drawCoin(src);
      return { returnCents: resolveCoin("H", stake, outcome), outcome };
    },
  });

  // Return is either 0 (loss) or floor(stake * 1.96).
  assert.ok(r.returnCents === 0n || r.returnCents === 1_960n);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(user.chipsCents, 10_000n - stake + r.returnCents);
  assert.equal(user.chipsCents, r.balanceAfter);
  assert.equal(await replayBalance(userId), user.chipsCents);
  assert.equal(user.nonce, 1); // nonce advanced once
  assert.equal(r.nonce, 0);
});

test("insufficient chips is rejected and nothing changes", async () => {
  const userId = await makeFundedUser(100n);
  await assert.rejects(() =>
    settleStateless({
      userId,
      game: "COIN",
      stakeCents: 500n,
      resolve: (src) => ({ returnCents: resolveCoin("H", 500n, drawCoin(src)), outcome: "x" }),
    })
  );
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(user.chipsCents, 100n);
  assert.equal(user.nonce, 0);
});

test("idempotent settle applies exactly once", async () => {
  const userId = await makeFundedUser(10_000n);
  const key = `game_${randomUUID()}`;
  const args = {
    userId,
    game: "COIN" as const,
    stakeCents: 1_000n,
    idempotencyKey: key,
    resolve: (src: import("../../lib/fair").RandomSource) => ({
      returnCents: resolveCoin("H", 1_000n, drawCoin(src)),
      outcome: "x",
    }),
  };
  const first = await settleStateless(args);
  const second = await settleStateless(args);
  assert.equal(second.replayed, true);
  assert.equal(second.roundId, first.roundId);
  assert.equal(second.balanceAfter, first.balanceAfter);
  const rounds = await db.gameRound.count({ where: { userId } });
  assert.equal(rounds, 1); // not double-settled
});
