"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "@/lib/wagmi";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({ accentColor: "#0D5843", borderRadius: "large" })}
          modalSize="compact"
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
