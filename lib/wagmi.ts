"use client";
/**
 * wagmi + RainbowKit config (§4.2).
 *
 * We deliberately avoid RainbowKit's `getDefaultConfig`, which bundles the
 * Coinbase Wallet connector (and its @coinbase/cdp-sdk → optional @x402/*
 * deps that break the Turbopack build). Instead we use only the injected +
 * WalletConnect wallets. EIP-6963 multi-injected discovery is enabled, so
 * Robinhood Wallet (and any other announced wallet) still appears automatically;
 * WalletConnect is the mobile fallback.
 */
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { defineChain } from "viem";
import { publicEnv } from "./env";

const env = publicEnv();

export const robinhoodChainClient = defineChain({
  id: env.NEXT_PUBLIC_CHAIN_ID,
  name: env.NEXT_PUBLIC_CHAIN_NAME,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.NEXT_PUBLIC_RPC_URL] } },
  blockExplorers: { default: { name: "Explorer", url: env.NEXT_PUBLIC_EXPLORER_URL } },
});

const connectors = connectorsForWallets(
  [{ groupName: "Recommended", wallets: [injectedWallet, walletConnectWallet] }],
  { appName: "Lend.Casino", projectId: env.NEXT_PUBLIC_WC_PROJECT_ID }
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [robinhoodChainClient],
  transports: { [robinhoodChainClient.id]: http(env.NEXT_PUBLIC_RPC_URL) },
  ssr: true,
  multiInjectedProviderDiscovery: true,
});
