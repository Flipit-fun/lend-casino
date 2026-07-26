/**
 * Deposit + redemption watcher (§13). Polls finalised blocks for:
 *   - ERC-20 Transfer events to the treasury (collateral deposits)
 *   - native ETH transfers to the treasury (redemption payments)
 * Cursor in DepositWatch; idempotency via ProcessedTx; only blocks older than
 * DEPOSIT_CONFIRMATIONS are processed (reorg-safe).
 */
import { getPublicClient } from "../lib/chain";
import { treasuryAddress } from "../lib/treasury/signer";
import { db } from "../lib/db";
import { depositConfirmations } from "../lib/env";
import { settleConfirmedDeposit } from "../lib/deposit";
import { settleConfirmedRedemption } from "../lib/redeem";
import { TRANSFER_EVENT } from "../lib/erc20";

const CHUNK = 1_000n;
let lastHeartbeat = 0;

export async function runWatcherOnce(): Promise<void> {
  const client = getPublicClient();
  const treasury = treasuryAddress();
  const confirmations = BigInt(depositConfirmations());

  const head = await client.getBlockNumber();
  const safeHead = head - confirmations;
  if (safeHead <= 0n) return;

  let watch = await db.depositWatch.findFirst();
  if (!watch) {
    // Start watching forward from the current safe head (no historical backfill).
    watch = await db.depositWatch.create({ data: { lastBlock: safeHead } });
    console.log(`[watcher] initialised cursor at block ${safeHead} (head ${head})`);
    return;
  }

  let from = watch.lastBlock + 1n;
  if (from > safeHead) return;

  // Heartbeat so the logs show the watcher is alive and advancing.
  if (Date.now() - lastHeartbeat > 60_000) {
    console.log(`[watcher] scanning ${from}..${safeHead} (head ${head})`);
    lastHeartbeat = Date.now();
  }

  const enabled = await db.asset.findMany({
    where: { enabled: true },
    select: { tokenAddress: true },
  });
  const tokenAddrs = enabled.map((a) => a.tokenAddress as `0x${string}`);

  while (from <= safeHead) {
    const to = from + CHUNK - 1n > safeHead ? safeHead : from + CHUNK - 1n;

    // ERC-20 deposits to the treasury.
    if (tokenAddrs.length > 0) {
      const logs = await client.getLogs({
        address: tokenAddrs,
        event: TRANSFER_EVENT,
        args: { to: treasury },
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        const outcome = await settleConfirmedDeposit({
          fromAddress: log.args.from!,
          tokenAddress: log.address,
          receivedRaw: log.args.value!,
          txHash: log.transactionHash!,
          logIndex: log.logIndex!,
        });
        console.log(
          `[watcher] deposit ${log.transactionHash} from ${log.args.from} value ${log.args.value} -> ${outcome}`
        );
      }
    }

    // Native ETH payments to the treasury (redemptions).
    for (let b = from; b <= to; b++) {
      const block = await client.getBlock({ blockNumber: b, includeTransactions: true });
      for (const tx of block.transactions) {
        if (typeof tx === "string") continue;
        if (tx.to && tx.to.toLowerCase() === treasury.toLowerCase() && tx.value > 0n) {
          const outcome = await settleConfirmedRedemption({
            fromAddress: tx.from,
            valueWei: tx.value,
            txHash: tx.hash,
            logIndex: 0,
          });
          console.log(`[watcher] eth ${tx.hash} from ${tx.from} value ${tx.value} -> ${outcome}`);
        }
      }
    }

    await db.depositWatch.update({ where: { id: watch.id }, data: { lastBlock: to } });
    from = to + 1n;
  }
}
