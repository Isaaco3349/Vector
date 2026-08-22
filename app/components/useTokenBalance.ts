"use client";

import { erc20Abi, formatUnits } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { tokenBySymbol } from "../lib/swap-tokens";

/**
 * Read the connected wallet's balance for any Arc Testnet token Vector knows
 * about — `tokenBySymbol` spans every holdable asset, not just the swappable
 * ones, so a token withheld from the Swap selector (cirBTC) still shows a live
 * balance in the portfolio.
 *
 * - USDC is Arc's native gas asset → wagmi `useBalance` (no contract).
 * - cirBTC is an ERC-20 → read `balanceOf` + `decimals` on-chain (decimals are
 *   read, never hardcoded, so cirBTC's 8 decimals can't be misreported by a
 *   stray constant).
 * - Any token with kind "unknown" (no verified address) → returns null (nothing
 *   shown), rather than a guessed or fake number.
 *
 * Returns a display string like "12.5000" or null when unavailable/loading.
 */
export function useTokenBalance(symbol: string): {
  formatted: string | null;
  isLoading: boolean;
} {
  const { address, isConnected } = useAccount();
  const token = tokenBySymbol(symbol);

  const isNative = token?.kind === "native";
  const isErc20 = token?.kind === "erc20" && !!token.address;

  // Native balance (USDC).
  const nativeQuery = useBalance({
    address,
    query: { enabled: isConnected && !!address && isNative },
  });

  // ERC-20 balance + decimals (cirBTC).
  const erc20Query = useReadContracts({
    query: { enabled: isConnected && !!address && isErc20 },
    contracts: isErc20
      ? [
          {
            address: token!.address!,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address as `0x${string}`],
          },
          {
            address: token!.address!,
            abi: erc20Abi,
            functionName: "decimals",
          },
        ]
      : [],
  });

  if (isNative) {
    if (nativeQuery.isLoading) return { formatted: null, isLoading: true };
    const v = nativeQuery.data;
    if (!v) return { formatted: null, isLoading: false };
    return { formatted: trim(formatUnits(v.value, v.decimals)), isLoading: false };
  }

  if (isErc20) {
    if (erc20Query.isLoading) return { formatted: null, isLoading: true };
    const results = erc20Query.data;
    const rawBalance = results?.[0]?.result;
    const decimals = results?.[1]?.result;
    if (typeof rawBalance !== "bigint" || typeof decimals !== "number") {
      return { formatted: null, isLoading: false };
    }
    return { formatted: trim(formatUnits(rawBalance, decimals)), isLoading: false };
  }

  // kind === "unknown" — no verified address, show nothing.
  return { formatted: null, isLoading: false };
}

/** Trim to 4 dp for display without lying about tiny dust. */
function trim(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  // Keep up to 4 decimals, drop trailing zeros.
  return n
    .toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false })
    .toString();
}
