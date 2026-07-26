import { ok, handle } from "@/lib/api";
import { db } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { getPublicClient } from "@/lib/chain";
import { treasuryEthWei } from "@/lib/treasury/guards";
import { getEthUsd } from "@/lib/prices";
import { serverEnv } from "@/lib/env";

async function probe<T>(fn: () => Promise<T>): Promise<{ up: boolean; detail?: string }> {
  try {
    await fn();
    return { up: true };
  } catch (e) {
    return { up: false, detail: (e as Error).message };
  }
}

// GET /api/health (§11) — db, redis, rpc, treasury balance, price freshness.
export const GET = handle(async () => {
  const [dbC, redisC, rpcC] = await Promise.all([
    probe(() => db.$queryRaw`SELECT 1`),
    probe(async () => getRedis().ping()),
    probe(async () => getPublicClient().getBlockNumber()),
  ]);

  let treasury: { up: boolean; balanceWei?: string; belowMin?: boolean; detail?: string };
  try {
    const bal = await treasuryEthWei();
    treasury = {
      up: true,
      balanceWei: bal.toString(),
      belowMin: bal < serverEnv().TREASURY_MIN_ETH_WEI,
    };
  } catch (e) {
    treasury = { up: false, detail: (e as Error).message };
  }

  let price: { up: boolean; ageSec?: number; detail?: string };
  try {
    const eth = await getEthUsd();
    price = { up: true, ageSec: (Date.now() - eth.asOf.getTime()) / 1000 };
  } catch (e) {
    price = { up: false, detail: (e as Error).message };
  }

  const healthy = dbC.up && redisC.up && rpcC.up && treasury.up && price.up;
  return ok(
    { healthy, db: dbC, redis: redisC, rpc: rpcC, treasury, price },
    healthy ? 200 : 503
  );
});
