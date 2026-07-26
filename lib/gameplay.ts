/**
 * Server-authoritative settlement for stateless games (§10.2).
 *
 * The client sends a stake and its bet selection; the SERVER derives the
 * outcome from the player's active server seed + client seed + nonce, settles
 * the ledger, increments the nonce, and records a GameRound. The client never
 * decides anything.
 */
import { type GameKind, type Prisma } from "@prisma/client";
import { db } from "./db";
import { InsufficientChipsError, withTxRetry } from "./ledger";
import { fairSource, type RandomSource } from "./fair";
import { ApiError } from "./errors";

export interface StatelessResult {
  roundId: string;
  outcome: unknown;
  returnCents: bigint;
  stakeCents: bigint;
  balanceAfter: bigint;
  nonce: number;
  replayed: boolean;
}

export interface StatelessArgs {
  userId: string;
  game: GameKind;
  stakeCents: bigint;
  idempotencyKey?: string;
  /** Given a seeded RandomSource, produce the outcome and stake-inclusive return. */
  resolve: (src: RandomSource) => { returnCents: bigint; outcome: unknown };
}

export async function settleStateless(args: StatelessArgs): Promise<StatelessResult> {
  if (args.stakeCents < 1n) {
    throw new ApiError("BAD_STAKE", "Set a stake first.", 400);
  }

  return withTxRetry(async (tx: Prisma.TransactionClient) => {
    // Idempotent replay: a prior settlement under this key returns as-is.
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
            outcome: round.outcome,
            returnCents: round.returnCents ?? 0n,
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
    if (!user.serverSeedId) {
      throw new ApiError("NO_SEED", "No active server seed. Rotate to create one.", 409);
    }
    if (user.chipsCents < args.stakeCents) {
      throw new InsufficientChipsError(args.stakeCents - user.chipsCents);
    }

    const seed = await tx.serverSeed.findUniqueOrThrow({ where: { id: user.serverSeedId } });
    const src = fairSource(seed.seed, user.clientSeed, user.nonce);
    const { returnCents, outcome } = args.resolve(src);
    if (returnCents < 0n) throw new Error("resolve() returned a negative return");

    const nonce = user.nonce;
    const afterStake = user.chipsCents - args.stakeCents;
    const afterReturn = afterStake + returnCents;

    const round = await tx.gameRound.create({
      data: {
        userId: user.id,
        game: args.game,
        stakeCents: args.stakeCents,
        state: {},
        serverSeedId: user.serverSeedId,
        clientSeed: user.clientSeed,
        nonce,
        outcome: outcome as Prisma.InputJsonValue,
        returnCents,
        status: "SETTLED",
        settledAt: new Date(),
      },
    });

    // Ledger: stake out, then (if any) return in. Balances chain correctly.
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
    if (returnCents > 0n) {
      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          deltaCents: returnCents,
          balanceAfter: afterReturn,
          reason: "BET_RETURN",
          refType: "GameRound",
          refId: round.id,
        },
      });
    }

    await tx.user.update({
      where: { id: user.id },
      data: { chipsCents: afterReturn, nonce: nonce + 1 },
    });

    return {
      roundId: round.id,
      outcome,
      returnCents,
      stakeCents: args.stakeCents,
      balanceAfter: afterReturn,
      nonce,
      replayed: false,
    };
  });
}
