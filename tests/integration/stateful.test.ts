/**
 * Stateful game integration tests (§7, §16): the generic round engine
 * (start/act) and the blackjack service, against the real database.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../lib/db";
import { creditChips, replayBalance } from "../../lib/ledger";
import { generateServerSeed, hashSeed } from "../../lib/fair";
import { startRound, actOnRound } from "../../lib/stateful";
import { placeMines, minesPayout, MINES_TILES } from "../../lib/games/mines";
import { deal, stand, double } from "../../lib/blackjackService";

const created: string[] = [];

async function makeFundedUser(chips: bigint): Promise<string> {
  const seed = generateServerSeed();
  const user = await db.user.create({
    data: { address: `0xs_${randomUUID()}`, clientSeed: "cs" },
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

test("round engine: start debits, hidden state stored, cashout credits, invariant holds", async () => {
  const userId = await makeFundedUser(1_000_000n);
  const stake = 1_000n;
  const mines = 3;

  const started = await startRound({
    userId,
    game: "MINES",
    stakeCents: stake,
    build: (src) => ({ mines, bombs: [...placeMines(mines, src)], picks: [] }),
  });
  assert.equal(started.balanceAfter, 1_000_000n - stake);

  // Hidden bomb state is stored server-side (not part of any client projection).
  const round = await db.gameRound.findUniqueOrThrow({ where: { id: started.roundId } });
  const bombs = (round.state as { bombs: number[] }).bombs;
  assert.equal(bombs.length, mines);

  const safeTile = Array.from({ length: MINES_TILES }, (_, i) => i).find((t) => !bombs.includes(t))!;

  // Pick one safe tile.
  await actOnRound({
    userId,
    roundId: started.roundId,
    game: "MINES",
    apply: (state) => {
      const picks = state.picks as number[];
      return { state: { ...state, picks: [...picks, safeTile] }, done: false };
    },
  });

  // Cash out after 1 safe pick.
  const cashed = await actOnRound({
    userId,
    roundId: started.roundId,
    game: "MINES",
    apply: (state, s) => ({
      state,
      done: true,
      returnCents: minesPayout(s, (state.picks as number[]).length, mines),
      outcome: { cashout: true },
    }),
  });

  const expectedReturn = minesPayout(stake, 1, mines);
  assert.equal(cashed.returnCents, expectedReturn);

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(user.chipsCents, 1_000_000n - stake + expectedReturn);
  assert.equal(await replayBalance(userId), user.chipsCents);

  const settled = await db.gameRound.findUniqueOrThrow({ where: { id: started.roundId } });
  assert.equal(settled.status, "SETTLED");
});

test("round engine: cannot act on a finished round", async () => {
  const userId = await makeFundedUser(100_000n);
  const started = await startRound({
    userId,
    game: "MINES",
    stakeCents: 1_000n,
    build: () => ({ mines: 3, bombs: [0, 1, 2], picks: [] }),
  });
  await actOnRound({
    userId,
    roundId: started.roundId,
    game: "MINES",
    apply: (state) => ({ state, done: true, returnCents: 0n }),
  });
  await assert.rejects(() =>
    actOnRound({
      userId,
      roundId: started.roundId,
      game: "MINES",
      apply: (state) => ({ state, done: true, returnCents: 0n }),
    })
  );
});

test("blackjack: deal + resolve keeps balance and ledger consistent", async () => {
  const userId = await makeFundedUser(1_000_000n);
  const stake = 5_000n;

  const d = await deal(userId, stake);
  const final = d.status === "ACTIVE" ? await stand(userId, d.roundId) : d;

  assert.equal(final.status, "SETTLED");
  const ret = final.returnCents ?? 0n;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  // Non-doubled hand: net = -stake + return.
  assert.equal(user.chipsCents, 1_000_000n - stake + ret);
  assert.equal(await replayBalance(userId), user.chipsCents);
});

test("blackjack: double debits a second stake and settles", async () => {
  const userId = await makeFundedUser(1_000_000n);
  const stake = 5_000n;

  // Retry deals until we get a hand where double is allowed (2 cards, no natural).
  let roundId: string | null = null;
  for (let i = 0; i < 20 && !roundId; i++) {
    const d = await deal(userId, stake);
    if (d.status === "ACTIVE" && d.canDouble) roundId = d.roundId;
  }
  assert.ok(roundId, "expected at least one doublable hand in 20 deals");

  const before = (await db.user.findUniqueOrThrow({ where: { id: userId } })).chipsCents;
  const res = await double(userId, roundId!);
  assert.equal(res.status, "SETTLED");

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const ret = res.returnCents ?? 0n;
  // Double debits an extra `stake`, then credits the return.
  assert.equal(user.chipsCents, before - stake + ret);
  assert.equal(await replayBalance(userId), user.chipsCents);
});
