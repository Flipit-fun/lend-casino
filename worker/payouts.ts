/**
 * Payout worker (§13). Single-flight (called sequentially), explicit nonce,
 * solvency + cap checks before every send, exponential backoff, max 5 attempts.
 * Sends ETH for CHIP_SALE and releases tokens for COLLATERAL_RELEASE.
 */
import { getWalletClient, treasuryAddress } from "../lib/treasury/signer";
import { getPublicClient } from "../lib/chain";
import { robinhoodChain } from "../lib/chain";
import { db } from "../lib/db";
import { checkSolvency, caps } from "../lib/treasury/guards";
import { ERC20_ABI } from "../lib/erc20";

const MAX_ATTEMPTS = 5;

function alert(msg: string) {
  console.warn(`[ALERT] ${msg}`);
}

async function dailySentWei(): Promise<bigint> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const rows = await db.payout.findMany({
    where: { kind: "CHIP_SALE", status: { in: ["SENT", "CONFIRMED"] }, sentAt: { gte: since } },
    select: { amountWei: true },
  });
  return rows.reduce((a, r) => a + BigInt(r.amountWei), 0n);
}

/** Process at most one queued payout. Returns true if one was handled. */
export async function processPayoutsOnce(): Promise<boolean> {
  const payout = await db.payout.findFirst({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });
  if (!payout) return false;

  const amountWei = BigInt(payout.amountWei);

  // Guards for ETH payouts.
  if (payout.kind === "CHIP_SALE") {
    const solvency = await checkSolvency(amountWei);
    if (!solvency.ok) {
      alert(`Insolvent for payout ${payout.id}: need ${solvency.requiredWei}, have ${solvency.balanceWei - solvency.pendingWei}. Leaving QUEUED.`);
      return false;
    }
    if (amountWei > caps().perTxWei) {
      await fail(payout.id, "Exceeds per-tx cap");
      return true;
    }
    if ((await dailySentWei()) + amountWei > caps().dailyWei) {
      alert(`Daily cap would be exceeded by payout ${payout.id}. Leaving QUEUED.`);
      return false;
    }
  }

  await db.payout.update({
    where: { id: payout.id },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });

  try {
    // viem's write typings model blob-tx fields we don't use; a loose local
    // type keeps this worker readable without fighting the union.
    const wallet = getWalletClient() as unknown as {
      account: `0x${string}` | { address: `0x${string}` };
      sendTransaction: (a: Record<string, unknown>) => Promise<`0x${string}`>;
      writeContract: (a: Record<string, unknown>) => Promise<`0x${string}`>;
    };
    const pub = getPublicClient();
    const nonce = await pub.getTransactionCount({ address: treasuryAddress(), blockTag: "pending" });

    let hash: `0x${string}`;
    if (payout.kind === "CHIP_SALE") {
      hash = await wallet.sendTransaction({
        account: wallet.account!,
        chain: robinhoodChain(),
        to: payout.toAddress as `0x${string}`,
        value: amountWei,
        nonce,
      });
    } else {
      hash = await wallet.writeContract({
        account: wallet.account!,
        chain: robinhoodChain(),
        address: payout.tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [payout.toAddress as `0x${string}`, BigInt(payout.tokenAmountRaw!)],
        nonce,
      });
    }

    await db.payout.update({
      where: { id: payout.id },
      data: { status: "SENT", txHash: hash, sentAt: new Date() },
    });

    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`tx reverted: ${hash}`);

    await db.payout.update({ where: { id: payout.id }, data: { status: "CONFIRMED" } });

    // Finalise a collateral release.
    if (payout.kind === "COLLATERAL_RELEASE" && payout.positionId) {
      await db.position.update({
        where: { id: payout.positionId },
        data: { status: "CLOSED", releaseTxHash: hash, closedAt: new Date() },
      });
      await db.redemption.updateMany({
        where: { positionId: payout.positionId, status: "PAID" },
        data: { status: "RELEASED" },
      });
    }
    return true;
  } catch (e) {
    const attempts = payout.attempts + 1;
    const msg = (e as Error).message;
    if (attempts >= MAX_ATTEMPTS) {
      await fail(payout.id, msg);
      alert(`Payout ${payout.id} FAILED after ${attempts} attempts: ${msg}`);
    } else {
      await db.payout.update({
        where: { id: payout.id },
        data: { status: "QUEUED", lastError: msg },
      });
    }
    return true;
  }
}

async function fail(id: string, error: string) {
  await db.payout.update({ where: { id }, data: { status: "FAILED", lastError: error } });
}
