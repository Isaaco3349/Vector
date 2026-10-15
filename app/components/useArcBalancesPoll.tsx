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

const POLL_MS = 15_000;
/** OKX fires focus + visibilitychange together — don't double-hit /api/arc-balances. */
const MIN_BACKGROUND_REFRESH_MS = 5_000;

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
  const lastFetchAtRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!address || !isConnected) {
      setSnapshot(null);
      return;
    }
    const gen = ++genRef.current;
    setIsLoading(true);
    clearArcPublicReadCache();
    try {
      const data = await fetchArcBalances(address as `0x${string}`);
      if (gen !== genRef.current) return;
      setSnapshot(data);
      lastFetchAtRef.current = Date.now();
    } finally {
      if (gen === genRef.current) setIsLoading(false);
    }
  }, [address, isConnected]);

  const refreshIfDue = useCallback(async () => {
    if (Date.now() - lastFetchAtRef.current < MIN_BACKGROUND_REFRESH_MS) {
      return;
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    if (!address || !isConnected) {
      setSnapshot(null);
      return;
    }
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshIfDue();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshIfDue();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [address, isConnected, refresh, refreshIfDue]);

  return { snapshot, isLoading, refresh };
}
