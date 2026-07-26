"use client";
/**
 * wagmi + RainbowKit config (§4.2). EIP-6963 multi-injected discovery is on by
 * default in wagmi v2, so Robinhood Wallet announces itself and appears in the
 * connect list automatically; WalletConnect is the mobile fallback.
 */
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain, http } from "viem";
import { publicEnv } from "./env";

const env = publicEnv();

export const robinhoodChainClient = defineChain({
  id: env.NEXT_PUBLIC_CHAIN_ID,
  name: env.NEXT_PUBLIC_CHAIN_NAME,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.NEXT_PUBLIC_RPC_URL] } },
  blockExplorers: { default: { name: "Explorer", url: env.NEXT_PUBLIC_EXPLORER_URL } },
});

export const wagmiConfig = getDefaultConfig({
  appName: "Lend.Casino",
  projectId: env.NEXT_PUBLIC_WC_PROJECT_ID,
  chains: [robinhoodChainClient],
  transports: { [robinhoodChainClient.id]: http(env.NEXT_PUBLIC_RPC_URL) },
  ssr: true,
});
