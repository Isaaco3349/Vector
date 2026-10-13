"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useArcUsdcBalance } from "./useArcUsdcBalance";

type ArcUsdcBalanceValue = ReturnType<typeof useArcUsdcBalance>;

const ArcUsdcBalanceContext = createContext<ArcUsdcBalanceValue | null>(null);

/** One shared Arc USDC query for the whole app (avoids N duplicate wagmi reads). */
export function ArcUsdcBalanceProvider({ children }: { children: ReactNode }) {
  const value = useArcUsdcBalance();
  return (
    <ArcUsdcBalanceContext.Provider value={value}>
      {children}
    </ArcUsdcBalanceContext.Provider>
  );
}

export function useSharedArcUsdcBalance(): ArcUsdcBalanceValue {
  const ctx = useContext(ArcUsdcBalanceContext);
  if (!ctx) {
    throw new Error("useSharedArcUsdcBalance requires ArcUsdcBalanceProvider");
  }
  return ctx;
}
