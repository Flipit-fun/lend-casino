/**
 * Server-authoritative settlement for stateful games (§10.3): a round is
 * started (stake debited, hidden state derived from the seed and stored), then
 * advanced by action calls until it settles. Hidden state (bomb positions,
 * dealer hole card, upcoming cards) lives in GameRound.state and is NEVER sent
 * to the client while the round is ACTIVE — callers return only a projection.
 */
import { type GameKind, type Prisma } from "@prisma/client";
import { db } from "./db";
import { InsufficientChipsError, withTxRetry } from "./ledger";
import { fairSource, type RandomSource } from "./fair";
import { ApiError } from "./errors";

export interface StartedRound {
  roundId: string;
  state: Record<string, unknown>;
  stakeCents: bigint;
  balanceAfter: bigint;
  nonce: number;
  replayed: boolean;
}

export async function startRound(args: {
  userId: string;
  game: GameKind;
  stakeCents: bigint;
  idempotencyKey?: string;
  build: (src: RandomSource) => Record<string, unknown>;
}): Promise<StartedRound> {
  if (args.stakeCents < 1n) throw new ApiError("BAD_STAKE", "Set a stake first.", 400);

  return withTxRetry(async (tx) => {
    if (args.idempotencyKey) {
      const prior = await tx.ledgerEntry.findUnique({
        where: { idempotencyKey: args.idempotencyKey },
      });
      if (prior?.refType === "GameRound" && prior.refId) {
        const round = await tx.gameRound.findUnique({ where: { id: prior.refId } });
        const user = await tx.user.findUniqueOrThrow({ where: { id: args.userId } });
        if (round) {
          return {
            roundId: round.id,
            state: (round.state as Record<string, unknown>) ?? {},
            stakeCents: round.stakeCents,
            balanceAfter: user.chipsCents,
            nonce: round.nonce,
            replayed: true,
          };
        }
      }
    }

    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${args.userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: args.userId } });
    if (!user.serverSeedId) throw new ApiError("NO_SEED", "No active server seed.", 409);
    if (user.chipsCents < args.stakeCents) {
      throw new InsufficientChipsError(args.stakeCents - user.chipsCents);
    }

    const seed = await tx.serverSeed.findUniqueOrThrow({ where: { id: user.serverSeedId } });
    const state = args.build(fairSource(seed.seed, user.clientSeed, user.nonce));
    const nonce = user.nonce;
    const afterStake = user.chipsCents - args.stakeCents;

    const round = await tx.gameRound.create({
      data: {
        userId: user.id,
        game: args.game,
        stakeCents: args.stakeCents,
        state: state as Prisma.InputJsonValue,
        serverSeedId: user.serverSeedId,
        clientSeed: user.clientSeed,
        nonce,
        status: "ACTIVE",
      },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: user.id,
        deltaCents: -args.stakeCents,
        balanceAfter: afterStake,
        reason: "BET_STAKE",
        refType: "GameRound",
        refId: round.id,
        idempotencyKey: args.idempotencyKey ?? null,
      },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { chipsCents: afterStake, nonce: nonce + 1 },
    });

    return { roundId: round.id, state, stakeCents: args.stakeCents, balanceAfter: afterStake, nonce, replayed: false };
  });
}

export interface ActionResult {
  state: Record<string, unknown>;
  done: boolean;
  returnCents?: bigint;
  outcome?: unknown;
}

export interface ActedRound {
  state: Record<string, unknown>;
  done: boolean;
  returnCents: bigint;
  outcome: unknown;
  balanceAfter: bigint | null;
}

/**
 * Advance an ACTIVE round for this user. `apply` is a pure transition over the
 * current state; if it returns done=true the round settles (return credited).
 */
export async function actOnRound(args: {
  userId: string;
  roundId: string;
  game: GameKind;
  apply: (state: Record<string, unknown>, stakeCents: bigint) => ActionResult;
}): Promise<ActedRound> {
  return withTxRetry(async (tx) => {
    // Lock the round row to serialise concurrent actions on the same round.
    await tx.$queryRaw`SELECT id FROM "GameRound" WHERE id = ${args.roundId} FOR UPDATE`;
    const round = await tx.gameRound.findUnique({ where: { id: args.roundId } });
    if (!round || round.userId !== args.userId || round.game !== args.game) {
      throw new ApiError("NO_ROUND", "No such round.", 404);
    }
    if (round.status !== "ACTIVE") {
      throw new ApiError("ROUND_OVER", "This round is already finished.", 409);
    }

    const res = args.apply((round.state as Record<string, unknown>) ?? {}, round.stakeCents);
    let balanceAfter: bigint | null = null;

    if (res.done) {
      const returnCents = res.returnCents ?? 0n;
      if (returnCents > 0n) {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${args.userId} FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({ where: { id: args.userId } });
        balanceAfter = user.chipsCents + returnCents;
        await tx.ledgerEntry.create({
          data: {
            userId: args.userId,
            deltaCents: returnCents,
            balanceAfter,
            reason: "BET_RETURN",
            refType: "GameRound",
            refId: round.id,
          },
        });
        await tx.user.update({ where: { id: args.userId }, data: { chipsCents: balanceAfter } });
      } else {
        const user = await tx.user.findUniqueOrThrow({ where: { id: args.userId } });
        balanceAfter = user.chipsCents;
      }
      await tx.gameRound.update({
        where: { id: round.id },
        data: {
          state: res.state as Prisma.InputJsonValue,
          outcome: (res.outcome ?? null) as Prisma.InputJsonValue,
          returnCents,
          status: "SETTLED",
          settledAt: new Date(),
        },
      });
    } else {
      await tx.gameRound.update({
        where: { id: round.id },
        data: { state: res.state as Prisma.InputJsonValue },
      });
    }

    return {
      state: res.state,
      done: res.done,
      returnCents: res.returnCents ?? 0n,
      outcome: res.outcome ?? null,
      balanceAfter,
    };
  });
}
