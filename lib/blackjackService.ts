/**
 * Blackjack service (§10.3). Bespoke transactions because Double debits an
 * extra stake mid-round. Six decks, dealer stands on all 17, blackjack pays
 * 3:2. The dealer hole card and the remaining shoe live in server state and
 * are never sent to the client until the hand is revealed.
 */
import { type Prisma } from "@prisma/client";
import { db } from "./db";
import { InsufficientChipsError, withTxRetry } from "./ledger";
import { fairSource } from "./fair";
import { ApiError } from "./errors";
import { buildShoe, score, isBlackjack, type Card } from "./games/blackjack";
import { cardView } from "./games/cards";

interface BjState {
  shoe: Card[];
  si: number;
  player: Card[];
  dealer: Card[];
  wageredCents: string; // bigint as string
  doubled: boolean;
}

type Result = "win" | "lose" | "push" | "blackjack";

function settleReturn(result: Result, wagered: bigint): bigint {
  switch (result) {
    case "win":
      return wagered * 2n;
    case "push":
      return wagered;
    case "blackjack":
      return (wagered * 5n) / 2n; // 3:2 on top of the stake
    case "lose":
      return 0n;
  }
}

function view(state: BjState, reveal: boolean) {
  const player = state.player.map((c) => cardView(c.v, c.s));
  const dealer = reveal
    ? state.dealer.map((c) => cardView(c.v, c.s))
    : [cardView(state.dealer[0].v, state.dealer[0].s), { hidden: true }];
  return {
    player,
    playerScore: score(state.player),
    dealer,
    dealerScore: reveal ? score(state.dealer) : score([state.dealer[0]]),
    shoeLeft: state.shoe.length - state.si,
  };
}

function projection(roundId: string, state: BjState, opts: {
  status: "ACTIVE" | "SETTLED";
  reveal: boolean;
  result?: Result;
  returnCents?: bigint;
  balanceAfter?: bigint | null;
  canDouble?: boolean;
}) {
  return {
    roundId,
    ...view(state, opts.reveal),
    status: opts.status,
    result: opts.result ?? null,
    returnCents: opts.returnCents,
    canDouble: opts.canDouble ?? false,
    balanceAfter: opts.balanceAfter,
  };
}

async function loadRound(tx: Prisma.TransactionClient, userId: string, roundId: string) {
  await tx.$queryRaw`SELECT id FROM "GameRound" WHERE id = ${roundId} FOR UPDATE`;
  const round = await tx.gameRound.findUnique({ where: { id: roundId } });
  if (!round || round.userId !== userId || round.game !== "BLACKJACK") {
    throw new ApiError("NO_ROUND", "No such round.", 404);
  }
  if (round.status !== "ACTIVE") {
    throw new ApiError("ROUND_OVER", "This hand is already finished.", 409);
  }
  return round;
}

async function credit(
  tx: Prisma.TransactionClient,
  userId: string,
  roundId: string,
  amount: bigint
): Promise<bigint> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (amount <= 0n) return user.chipsCents;
  const balanceAfter = user.chipsCents + amount;
  await tx.ledgerEntry.create({
    data: {
      userId,
      deltaCents: amount,
      balanceAfter,
      reason: "BET_RETURN",
      refType: "GameRound",
      refId: roundId,
    },
  });
  await tx.user.update({ where: { id: userId }, data: { chipsCents: balanceAfter } });
  return balanceAfter;
}

async function finish(
  tx: Prisma.TransactionClient,
  roundId: string,
  userId: string,
  state: BjState,
  result: Result
) {
  const wagered = BigInt(state.wageredCents);
  const returnCents = settleReturn(result, wagered);
  const balanceAfter = await credit(tx, userId, roundId, returnCents);
  await tx.gameRound.update({
    where: { id: roundId },
    data: {
      state: state as unknown as Prisma.InputJsonValue,
      outcome: { result, dealer: state.dealer, player: state.player } as unknown as Prisma.InputJsonValue,
      returnCents,
      status: "SETTLED",
      settledAt: new Date(),
    },
  });
  return { returnCents, balanceAfter, result };
}

function dealerPlay(state: BjState) {
  while (score(state.dealer) < 17) {
    state.dealer.push(state.shoe[state.si++]);
  }
}

function compare(p: number, d: number): Result {
  if (d > 21) return "win";
  if (p > d) return "win";
  if (p === d) return "push";
  return "lose";
}

export async function deal(userId: string, stakeCents: bigint, idempotencyKey?: string) {
  if (stakeCents < 1n) throw new ApiError("BAD_STAKE", "Set a stake first.", 400);

  return withTxRetry(async (tx) => {
    if (idempotencyKey) {
      const prior = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
      if (prior?.refId) {
        const r = await tx.gameRound.findUnique({ where: { id: prior.refId } });
        const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (r) {
          const st = r.state as unknown as BjState;
          return projection(r.id, st, {
            status: r.status === "SETTLED" ? "SETTLED" : "ACTIVE",
            reveal: r.status === "SETTLED",
            balanceAfter: u.chipsCents,
            canDouble: r.status === "ACTIVE" && st.player.length === 2,
          });
        }
      }
    }

    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.serverSeedId) throw new ApiError("NO_SEED", "No active server seed.", 409);
    if (user.chipsCents < stakeCents) throw new InsufficientChipsError(stakeCents - user.chipsCents);

    const seed = await tx.serverSeed.findUniqueOrThrow({ where: { id: user.serverSeedId } });
    const shoe = buildShoe(fairSource(seed.seed, user.clientSeed, user.nonce));
    const state: BjState = {
      shoe,
      si: 4,
      player: [shoe[0], shoe[2]],
      dealer: [shoe[1], shoe[3]],
      wageredCents: stakeCents.toString(),
      doubled: false,
    };

    const afterStake = user.chipsCents - stakeCents;
    const round = await tx.gameRound.create({
      data: {
        userId,
        game: "BLACKJACK",
        stakeCents,
        state: state as unknown as Prisma.InputJsonValue,
        serverSeedId: user.serverSeedId,
        clientSeed: user.clientSeed,
        nonce: user.nonce,
        status: "ACTIVE",
      },
    });
    await tx.ledgerEntry.create({
      data: {
        userId,
        deltaCents: -stakeCents,
        balanceAfter: afterStake,
        reason: "BET_STAKE",
        refType: "GameRound",
        refId: round.id,
        idempotencyKey: idempotencyKey ?? null,
      },
    });
    await tx.user.update({
      where: { id: userId },
      data: { chipsCents: afterStake, nonce: user.nonce + 1 },
    });

    // Naturals settle immediately.
    const pBJ = isBlackjack(state.player);
    const dBJ = isBlackjack(state.dealer);
    if (pBJ || dBJ) {
      const result: Result = pBJ && dBJ ? "push" : pBJ ? "blackjack" : "lose";
      const settled = await finish(tx, round.id, userId, state, result);
      return projection(round.id, state, {
        status: "SETTLED",
        reveal: true,
        result: settled.result,
        returnCents: settled.returnCents,
        balanceAfter: settled.balanceAfter,
      });
    }

    return projection(round.id, state, {
      status: "ACTIVE",
      reveal: false,
      balanceAfter: afterStake,
      canDouble: true,
    });
  });
}

export async function hit(userId: string, roundId: string) {
  return withTxRetry(async (tx) => {
    const round = await loadRound(tx, userId, roundId);
    const state = round.state as unknown as BjState;
    state.player.push(state.shoe[state.si++]);

    if (score(state.player) > 21) {
      const settled = await finish(tx, roundId, userId, state, "lose");
      return projection(roundId, state, {
        status: "SETTLED",
        reveal: true,
        result: "lose",
        returnCents: settled.returnCents,
        balanceAfter: settled.balanceAfter,
      });
    }
    await tx.gameRound.update({
      where: { id: roundId },
      data: { state: state as unknown as Prisma.InputJsonValue },
    });
    return projection(roundId, state, { status: "ACTIVE", reveal: false, canDouble: false });
  });
}

export async function stand(userId: string, roundId: string) {
  return withTxRetry(async (tx) => {
    const round = await loadRound(tx, userId, roundId);
    const state = round.state as unknown as BjState;
    dealerPlay(state);
    const result = compare(score(state.player), score(state.dealer));
    const settled = await finish(tx, roundId, userId, state, result);
    return projection(roundId, state, {
      status: "SETTLED",
      reveal: true,
      result,
      returnCents: settled.returnCents,
      balanceAfter: settled.balanceAfter,
    });
  });
}

export async function double(userId: string, roundId: string) {
  return withTxRetry(async (tx) => {
    const round = await loadRound(tx, userId, roundId);
    const state = round.state as unknown as BjState;
    if (state.player.length !== 2 || state.doubled) {
      throw new ApiError("NO_DOUBLE", "You can only double on your first two cards.", 409);
    }

    // Debit the extra stake.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const extra = round.stakeCents;
    if (user.chipsCents < extra) throw new InsufficientChipsError(extra - user.chipsCents);
    const afterStake = user.chipsCents - extra;
    await tx.ledgerEntry.create({
      data: {
        userId,
        deltaCents: -extra,
        balanceAfter: afterStake,
        reason: "BET_STAKE",
        refType: "GameRound",
        refId: roundId,
      },
    });
    await tx.user.update({ where: { id: userId }, data: { chipsCents: afterStake } });

    state.doubled = true;
    state.wageredCents = (BigInt(state.wageredCents) + extra).toString();
    state.player.push(state.shoe[state.si++]);

    let result: Result;
    if (score(state.player) > 21) {
      result = "lose";
    } else {
      dealerPlay(state);
      result = compare(score(state.player), score(state.dealer));
    }
    const settled = await finish(tx, roundId, userId, state, result);
    return projection(roundId, state, {
      status: "SETTLED",
      reveal: true,
      result,
      returnCents: settled.returnCents,
      balanceAfter: settled.balanceAfter,
    });
  });
}
