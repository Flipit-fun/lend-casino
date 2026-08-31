/**
 * Cage flow integration tests (§8–9, off-chain parts):
 * deposit intent -> confirmed credit -> redeem with chips. The on-chain send
 * paths (payout worker, watcher, sell exposure) need a funded treasury + RPC
 * and are verified live, not here.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../lib/db";
import { replayBalance } from "../../lib/ledger";
import { createDepositIntent, settleConfirmedDeposit } from "../../lib/deposit";
import { redeemWithChips } from "../../lib/redeem";

const created: string[] = [];
const txHashes: string[] = [];

async function makeUser(): Promise<{ id: string; address: string }> {
  const address = `0xdep_${randomUUID()}`.toLowerCase();
  const user = await db.user.create({ data: { address, clientSeed: "cs" } });
  created.push(user.id);
  return { id: user.id, address };
}

after(async () => {
  for (const id of created) {
    await db.payout.deleteMany({ where: { userId: id } });
    const positions = await db.position.findMany({ where: { userId: id }, select: { id: true } });
    await db.redemption.deleteMany({ where: { positionId: { in: positions.map((p) => p.id) } } });
    await db.position.deleteMany({ where: { userId: id } });
    await db.ledgerEntry.deleteMany({ where: { userId: id } });
    await db.user.delete({ where: { id } }).catch(() => {});
  }
  for (const h of txHashes) await db.processedTx.deleteMany({ where: { txHash: h } });
  await db.$disconnect();
});

test("deposit intent quotes from a USD amount and supports fractions", async () => {
  const user = await makeUser();

  // Deposit a USD amount; the server derives the (fractional) token quantity.
  // TSLA static mark $318.05; $3180.50 ≈ 10 TSLA.
  const quote = await createDepositIntent(user.id, "TSLA", 318_050n);
  assert.equal(quote.valueCents, 318_050n);
  assert.equal(quote.drawnCents, 190_830n); // 60% LTV
  assert.equal(quote.qtyRaw, 10n * 10n ** 18n);

  const pos = await db.position.findUniqueOrThrow({ where: { id: quote.positionId } });
  assert.equal(pos.status, "PENDING");

  // A small dollar amount buys less than one share.
  const frac = await createDepositIntent(user.id, "TSLA", 5_000n); // $50
  assert.ok(frac.qtyRaw < 10n ** 18n, "less than one share");
});

test("confirmed deposit credits chips once and opens the ticket", async () => {
  const user = await makeUser();
  const quote = await createDepositIntent(user.id, "TSLA", 318_050n);
  const qtyRaw = quote.qtyRaw;
  const asset = await db.asset.findUniqueOrThrow({ where: { symbol: "TSLA" } });

  const txHash = `0xhash_${randomUUID()}`;
  txHashes.push(txHash);

  const first = await settleConfirmedDeposit({
    fromAddress: user.address,
    tokenAddress: asset.tokenAddress,
    receivedRaw: qtyRaw,
    txHash,
    logIndex: 0,
  });
  assert.equal(first, "credited");

  // Replaying the same log must not double-credit.
  const again = await settleConfirmedDeposit({
    fromAddress: user.address,
    tokenAddress: asset.tokenAddress,
    receivedRaw: qtyRaw,
    txHash,
    logIndex: 0,
  });
  assert.equal(again, "duplicate");

  const pos = await db.position.findUniqueOrThrow({ where: { id: quote.positionId } });
  assert.equal(pos.status, "OPEN");
  const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(fresh.chipsCents, 190_830n);
  assert.equal(await replayBalance(user.id), fresh.chipsCents);
});

test("redeem with chips burns the debt and queues the asset release", async () => {
  const user = await makeUser();
  const quote = await createDepositIntent(user.id, "TSLA", 318_050n);
  const qtyRaw = quote.qtyRaw;
  const asset = await db.asset.findUniqueOrThrow({ where: { symbol: "TSLA" } });
  const txHash = `0xhash_${randomUUID()}`;
  txHashes.push(txHash);
  await settleConfirmedDeposit({
    fromAddress: user.address,
    tokenAddress: asset.tokenAddress,
    receivedRaw: qtyRaw,
    txHash,
    logIndex: 0,
  });

  const res = await redeemWithChips(user.id, quote.positionId);
  assert.equal(res.status, "SETTLING");

  const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(fresh.chipsCents, 0n); // burned the full debt
  assert.equal(await replayBalance(user.id), 0n);

  const payout = await db.payout.findFirst({
    where: { userId: user.id, kind: "COLLATERAL_RELEASE" },
  });
  assert.ok(payout, "a collateral-release payout was queued");
  assert.equal(payout!.tokenAmountRaw, qtyRaw.toString());
});
