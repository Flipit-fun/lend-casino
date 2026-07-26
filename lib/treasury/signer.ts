/**
 * Treasury signer — THE ONLY module that touches TREASURY_PRIVATE_KEY (§6.5).
 *
 * This is the documented seam for swapping the key management strategy. To move
 * to a KMS or multisig later, replace the body of `getTreasuryAccount()` /
 * `getWalletClient()` here and nothing else in the codebase changes.
 *
 * We deliberately do NOT use the `server-only` package here because this module
 * is also imported by the standalone BullMQ worker process (which has no React
 * Server Component build to satisfy that import). Instead we guard at runtime:
 * touching the key from a browser bundle throws immediately.
 */
import { createWalletClient, http, type WalletClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { robinhoodChain } from "../chain";
import { treasuryKey, publicEnv } from "../env";

function assertServer() {
  if (typeof window !== "undefined") {
    throw new Error("Treasury signer must never be loaded on the client.");
  }
}

let _account: PrivateKeyAccount | null = null;
let _walletClient: WalletClient | null = null;

/** The treasury hot-wallet account. Server/worker only. */
export function getTreasuryAccount(): PrivateKeyAccount {
  assertServer();
  if (_account) return _account;
  const key = treasuryKey();
  if (!key) throw new Error("TREASURY_PRIVATE_KEY is not set (required by the worker to sign payouts).");
  _account = privateKeyToAccount(key as `0x${string}`);
  return _account;
}

/** Wallet client for outbound sends (payouts, collateral release). Server/worker only. */
export function getWalletClient(): WalletClient {
  assertServer();
  if (_walletClient) return _walletClient;
  _walletClient = createWalletClient({
    account: getTreasuryAccount(),
    chain: robinhoodChain(),
    transport: http(process.env.RPC_URL_PRIVATE || publicEnv().NEXT_PUBLIC_RPC_URL),
  });
  return _walletClient;
}

/** The treasury address players deposit to. Safe to expose (it's public). */
export function treasuryAddress(): `0x${string}` {
  return publicEnv().NEXT_PUBLIC_TREASURY_ADDRESS as `0x${string}`;
}
