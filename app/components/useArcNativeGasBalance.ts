"use client";

import { formatUnits, parseUnits } from "viem";
import { useAccount, useBalance } from "wagmi";
import { chainId as ARC_CHAIN_ID } from "../lib/network";

/** Minimum native USDC (18 dp) to sign one or more txs on Arc. */
export const MIN_NATIVE_GAS_USDC = parseUnits("0.05", 18);

/**
 * Native USDC on Arc (18 decimals) — used only to pay transaction gas.
 * Separate from the 6-decimal ERC-20 at 0x3600… that swap/bridge spend.
 */
export function useArcNativeGasBalance(): {
  formatted: string | null;
  raw: bigint | null;
  isLoading: boolean;
} {
  const { address, isConnected } = useAccount();
  const query = useBalance({
    address,
    chainId: ARC_CHAIN_ID,
    query: { enabled: isConnected && !!address },
  });

  if (query.isLoading) {
    return { formatted: null, raw: null, isLoading: true };
  }
  const v = query.data;
  if (!v) return { formatted: null, raw: null, isLoading: false };

  return {
    formatted: trim(formatUnits(v.value, v.decimals)),
    raw: v.value,
    isLoading: false,
  };
}

function trim(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    useGrouping: false,
  });
}
