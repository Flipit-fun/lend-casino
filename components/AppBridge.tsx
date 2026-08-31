"use client";
/**
 * Bridges the React wallet/auth/session world into the imperative casino UI.
 * - Renders the connect / switch-chain / sign-in / account button into the nav
 *   slot (#wallet-slot), preserving the existing pill styling.
 * - Owns /api/me and writes chips / free / ETH-owed into the purse DOM.
 * - Exposes window.LC { authed, chainOk, me, refetchMe, deposit, payEth } so the
 *   imperative game + cage code can gate on auth and trigger on-chain transfers.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useChainId, useSignMessage, useSwitchChain, useSendTransaction, useWriteContract } from "wagmi";
import { useConnectModal, useAccountModal } from "@rainbow-me/rainbowkit";
import { SiweMessage } from "siwe";
import { publicEnv } from "@/lib/env";
import { ERC20_ABI } from "@/lib/erc20";

const env = publicEnv();

interface Me {
  address: string;
  chipsCents: string;
  freeCents: string;
  debtCents: string;
  debtWei: string;
}

function fmtChips(cents: string): string {
  return Math.floor(Number(cents) / 100).toLocaleString("en-US");
}
function fmtEth(wei: string): string {
  const w = BigInt(wei || "0");
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${frac}`;
}

function setText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export default function AppBridge() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { switchChain } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const [me, setMe] = useState<Me | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const chainOk = chainId === env.NEXT_PUBLIC_CHAIN_ID;

  const refetchMe = useCallback(async () => {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) {
        setMe(null);
        return null;
      }
      const { data } = await res.json();
      setMe(data);
      return data as Me;
    } catch {
      setMe(null);
      return null;
    }
  }, []);

  // Poll the slot mount point (markup is injected imperatively).
  useEffect(() => {
    const t = setInterval(() => {
      const el = document.getElementById("wallet-slot");
      if (el) {
        setSlot(el);
        clearInterval(t);
      }
    }, 60);
    return () => clearInterval(t);
  }, []);

  // On connect, check for an existing session.
  useEffect(() => {
    if (isConnected) refetchMe();
    else setMe(null);
  }, [isConnected, address, refetchMe]);

  // Reflect me -> purse DOM, but only when the session matches the connected wallet.
  useEffect(() => {
    const ok = !!me && !!address && me.address.toLowerCase() === address.toLowerCase();
    setText("purseChips", ok ? fmtChips(me!.chipsCents) : "0");
    setText("purseFree", ok ? fmtChips(me!.freeCents) : "0");
    setText("purseDebt", ok ? fmtEth(me!.debtWei) : "0.0000");
  }, [me, address]);

  const signIn = useCallback(async () => {
    if (!address || signingIn) return;
    setSigningIn(true);
    try {
      const nonceRes = await fetch("/api/auth/nonce");
      const { data } = await nonceRes.json();
      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to RWA.Casino",
        uri: window.location.origin,
        version: "1",
        chainId: env.NEXT_PUBLIC_CHAIN_ID,
        nonce: data.nonce,
      }).prepareMessage();
      const signature = await signMessageAsync({ account: address, message });
      const verify = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (verify.ok) await refetchMe();
    } catch {
      /* user rejected or failed */
    } finally {
      setSigningIn(false);
    }
  }, [address, signingIn, signMessageAsync, refetchMe]);

  // Expose the bridge for the imperative code.
  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  const addrRef = useRef<string | undefined>(address);
  addrRef.current = address;
  // The session is only valid if it matches the currently-connected wallet.
  const sessionValid = () => {
    const m = meRef.current;
    const a = addrRef.current;
    return !!m && !!a && m.address.toLowerCase() === a.toLowerCase();
  };
  useEffect(() => {
    (window as unknown as { LC: unknown }).LC = {
      get authed() {
        return sessionValid();
      },
      chainOk,
      get me() {
        return sessionValid() ? meRef.current : null;
      },
      refetchMe,
      async deposit(tokenAddress: string, to: string, qtyRaw: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return writeContractAsync({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [to as `0x${string}`, BigInt(qtyRaw)],
        } as any);
      },
      async payEth(to: string, wei: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return sendTransactionAsync({ to: to as `0x${string}`, value: BigInt(wei) } as any);
      },
    };
  }, [chainOk, refetchMe, writeContractAsync, sendTransactionAsync]);

  if (!slot) return null;

  let button: React.ReactNode;
  if (!isConnected) {
    button = (
      <button className="btn sm" onClick={openConnectModal}>
        Connect your Robinhood wallet
      </button>
    );
  } else if (!chainOk) {
    button = (
      <button className="btn sm red" onClick={() => switchChain({ chainId: env.NEXT_PUBLIC_CHAIN_ID })}>
        Switch to Robinhood Chain
      </button>
    );
  } else if (!me) {
    button = (
      <button className="btn sm brass" onClick={signIn} disabled={signingIn}>
        {signingIn ? "Check your wallet…" : "Sign in"}
      </button>
    );
  } else {
    button = (
      <button className="btn sm brass" onClick={openAccountModal}>
        {me.address.slice(0, 6)}…{me.address.slice(-4)}
      </button>
    );
  }

  return createPortal(button, slot);
}
