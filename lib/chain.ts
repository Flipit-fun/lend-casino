/**
 * Robinhood Chain definition + shared read client (§4.1).
 *
 * Robinhood Chain is an Arbitrum L2 with ETH as the native gas token.
 *   mainnet chainId 4663   · testnet chainId 46630
 * The concrete values come from env so the same code targets either network.
 *
 * Write access (the treasury signer) lives in `lib/treasury/signer.ts` — the
 * only module permitted to touch the private key.
 */
import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import { publicEnv } from "./env";

export function robinhoodChain() {
  const env = publicEnv();
  return defineChain({
    id: env.NEXT_PUBLIC_CHAIN_ID,
    name: env.NEXT_PUBLIC_CHAIN_NAME,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [env.NEXT_PUBLIC_RPC_URL] },
    },
    blockExplorers: {
      default: { name: "Explorer", url: env.NEXT_PUBLIC_EXPLORER_URL },
    },
  });
}

let _publicClient: PublicClient | null = null;

/** Shared read-only client. Uses the private RPC on the server, public on client. */
export function getPublicClient(): PublicClient {
  if (_publicClient) return _publicClient;
  const isServer = typeof window === "undefined";
  const rpc = isServer
    ? process.env.RPC_URL_PRIVATE || publicEnv().NEXT_PUBLIC_RPC_URL
    : publicEnv().NEXT_PUBLIC_RPC_URL;
  _publicClient = createPublicClient({
    chain: robinhoodChain(),
    transport: http(rpc),
  }) as PublicClient;
  return _publicClient;
}
