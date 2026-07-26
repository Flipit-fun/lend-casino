/**
 * Lend.Casino worker process (§13). Runs the deposit/redemption watcher, the
 * single-flight payout processor, the liquidation cron, and the round reaper.
 *
 * Run separately from the web app:  npm run worker
 *
 * Note on the stack: rather than enqueue payouts to BullMQ inside a DB
 * transaction (a dual-write hazard — the job could be enqueued while the tx
 * rolls back, or vice versa), payouts are the source of truth in Postgres and
 * this worker polls them single-flight. Same guarantees (single-flight nonce,
 * retry, idempotency) without the split-brain risk.
 */
import { runWatcherOnce } from "./watcher";
import { processPayoutsOnce } from "./payouts";
import { runLiquidationOnce } from "./liquidation";
import { runReaperOnce } from "./reaper";

type Loop = { name: string; fn: () => Promise<unknown>; everyMs: number };

function schedule({ name, fn, everyMs }: Loop) {
  const run = async () => {
    try {
      await fn();
    } catch (e) {
      console.error(`[${name}] error:`, (e as Error).message);
    } finally {
      setTimeout(run, everyMs);
    }
  };
  run();
}

console.log("Lend.Casino worker starting…");
schedule({ name: "watcher", fn: runWatcherOnce, everyMs: 5_000 });
schedule({ name: "payouts", fn: async () => { while (await processPayoutsOnce()) {} }, everyMs: 2_000 });
schedule({ name: "liquidation", fn: runLiquidationOnce, everyMs: 60_000 });
schedule({ name: "reaper", fn: runReaperOnce, everyMs: 60_000 });

process.on("SIGINT", () => {
  console.log("worker stopping…");
  process.exit(0);
});
