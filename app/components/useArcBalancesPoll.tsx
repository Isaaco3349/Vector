"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAccount } from "wagmi";
import {
  fetchArcBalances,
  type ArcBalancesSnapshot,
} from "../lib/arc-balances-client";
import { clearArcPublicReadCache } from "../lib/arc-erc20-read";

const POLL_MS = 10_000;

type ArcBalancesValue = {
  snapshot: ArcBalancesSnapshot | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

const ArcBalancesContext = createContext<ArcBalancesValue | null>(null);

export function ArcBalancesProvider({ children }: { children: ReactNode }) {
  const value = useArcBalancesPoll();
  return (
    <ArcBalancesContext.Provider value={value}>
      {children}
    </ArcBalancesContext.Provider>
  );
}

export function useArcBalancesSnapshot(): ArcBalancesValue | null {
  return useContext(ArcBalancesContext);
}

/** Authoritative Arc balances via Vector server RPC (not wallet extension cache). */
function useArcBalancesPoll(): ArcBalancesValue {
  const { address, isConnected } = useAccount();
  const [snapshot, setSnapshot] = useState<ArcBalancesSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const genRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!address || !isConnected) {
      setSnapshot(null);
      return;
    }
    const gen = ++genRef.current;
    setIsLoading(true);
    clearArcPublicReadCache();
    const data = await fetchArcBalances(address as `0x${string}`);
    if (gen !== genRef.current) return;
    setSnapshot(data);
    setIsLoading(false);
  }, [address, isConnected]);

  useEffect(() => {
    if (!address || !isConnected) {
      setSnapshot(null);
      return;
    }
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [address, isConnected, refresh]);

  return { snapshot, isLoading, refresh };
}
