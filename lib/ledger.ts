/**
 * Ledger — the ONLY way chip balances change (§7).
 *
 * Every mutation:
 *   - runs inside a transaction that locks the user row (SELECT … FOR UPDATE),
 *     so two concurrent bets on the same balance can't both succeed;
 *   - writes a LedgerEntry recording the signed delta and resulting balance;
 *   - is idempotent when given an idempotencyKey (a repeat returns the original
 *     result and does NOT re-apply).
 *
 * Invariant: replaying a user's ledger deltas equals their stored balance.
 */
import { Prisma, type LedgerReason } from "@prisma/client";
import { db } from "./db";

export class InsufficientChipsError extends Error {
  constructor(public shortBy: bigint) {
    super(`Not enough chips. Short by ${shortBy} cents.`);
    this.name = "InsufficientChipsError";
  }
}

export interface ApplyLedgerArgs {
  userId: string;
  deltaCents: bigint;
  reason: LedgerReason;
  refType?: string;
  refId?: string;
  idempotencyKey?: string;
  /** Compose inside a caller's transaction (e.g. bet + payout atomically). */
  tx?: Prisma.TransactionClient;
}

export interface ApplyLedgerResult {
  balanceAfter: bigint;
  entryId: string;
  replayed: boolean;
}

async function applyWithin(
  tx: Prisma.TransactionClient,
  args: ApplyLedgerArgs
): Promise<ApplyLedgerResult> {
  // Idempotency short-circuit.
  if (args.idempotencyKey) {
    const existing = await tx.ledgerEntry.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
    });
    if (existing) {
      return { balanceAfter: existing.balanceAfter, entryId: existing.id, replayed: true };
    }
  }

  // Serialize concurrent mutations on this user.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${args.userId} FOR UPDATE`;

  const user = await tx.user.findUniqueOrThrow({ where: { id: args.userId } });
  const balanceAfter = user.chipsCents + args.deltaCents;
  if (balanceAfter < 0n) {
    throw new InsufficientChipsError(-balanceAfter);
  }

  await tx.user.update({ where: { id: args.userId }, data: { chipsCents: balanceAfter } });

  const entry = await tx.ledgerEntry.create({
    data: {
      userId: args.userId,
      deltaCents: args.deltaCents,
      balanceAfter,
      reason: args.reason,
      refType: args.refType ?? null,
      refId: args.refId ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
    },
  });

  return { balanceAfter, entryId: entry.id, replayed: false };
}

// Transient DB errors worth retrying: write-conflict/deadlock (P2034),
// transaction timeout (P2028), connection-pool timeout (P2024), and transient
// connection drops to the pooler (P1001/P1017).
const RETRYABLE_CODES = new Set(["P2034", "P2028", "P2024", "P1001", "P1017"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = String((e as { message?: string })?.message ?? "");
  return (
    (code !== undefined && RETRYABLE_CODES.has(code)) ||
    /deadlock|could not serialize|write conflict|can't reach database|connection/i.test(msg)
  );
}

/**
 * Run a transaction with backoff retry on transient contention. Never retries
 * InsufficientChipsError (a logic error). Shared by the ledger and gameplay.
 */
export async function withTxRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      return await db.$transaction(fn, { timeout: 20_000, maxWait: 20_000 });
    } catch (e) {
      if (e instanceof InsufficientChipsError) throw e;
      if (!isRetryable(e)) throw e;
      lastErr = e;
      await sleep(40 * (attempt + 1) + Math.floor(Math.random() * 40));
    }
  }
  throw lastErr;
}

/**
 * Apply a signed ledger delta. Creates its own (retrying) transaction unless
 * one is passed to compose within a caller's transaction.
 */
export async function applyLedger(args: ApplyLedgerArgs): Promise<ApplyLedgerResult> {
  if (args.tx) return applyWithin(args.tx, args);
  return withTxRetry((tx) => applyWithin(tx, args));
}

export const creditChips = (
  args: Omit<ApplyLedgerArgs, "deltaCents"> & { amountCents: bigint }
) => applyLedger({ ...args, deltaCents: args.amountCents });

export const debitChips = (
  args: Omit<ApplyLedgerArgs, "deltaCents"> & { amountCents: bigint }
) => applyLedger({ ...args, deltaCents: -args.amountCents });

/** Sum of all ledger deltas for a user — must equal their stored balance. */
export async function replayBalance(userId: string): Promise<bigint> {
  const entries = await db.ledgerEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { deltaCents: true },
  });
  return entries.reduce((a, e) => a + e.deltaCents, 0n);
}

/** Outstanding debt across a user's OPEN positions, in cents. */
export async function totalDebtCents(userId: string): Promise<bigint> {
  const rows = await db.position.findMany({
    where: { userId, status: "OPEN" },
    select: { debtCents: true },
  });
  return rows.reduce((a, r) => a + r.debtCents, 0n);
}
