"use client";

import { erc20Abi, formatUnits } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { bridgeChainById, type BridgeChainId } from "../lib/bridge-chains";

/**
 * Read the connected wallet's USDC balance ON A SPECIFIC bridge chain.
 *
 * Unlike the swap balance hook (which is Arc-only), a bridge spans chains, so
 * the SOURCE balance must be read on the source chain — not whatever network
 * the wallet is currently pointed at. wagmi's `chainId` option scopes each read
 * to the right chain (all three are registered in wagmi-config), so we never
 * misreport a balance by reading the wrong network.
 *
 *  - Arc: USDC is the native gas asset (18 decimals) → useBalance, no address.
 *  - Base/Ethereum Sepolia: USDC is an ERC-20 → read balanceOf + decimals
 *    on-chain (decimals read, never hardcoded).
 *
 * Returns a display string like "12.5" or null when unavailable/loading.
 */
export function useBridgeBalance(chainId: BridgeChainId): {
  formatted: string | null;
  isLoading: boolean;
} {
  const { address, isConnected } = useAccount();
  const chain = bridgeChainById(chainId);

  const isNative = chain?.usdcKind === "native";
  const isErc20 = chain?.usdcKind === "erc20" && !!chain.usdcAddress;

  const nativeQuery = useBalance({
    address,
    chainId: chain?.chainId,
    query: { enabled: isConnected && !!address && isNative },
  });

  const erc20Query = useReadContracts({
    query: { enabled: isConnected && !!address && isErc20 },
    contracts: isErc20
      ? [
          {
            chainId: chain!.chainId,
            address: chain!.usdcAddress!,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address as `0x${string}`],
          },
          {
            chainId: chain!.chainId,
            address: chain!.usdcAddress!,
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

  return { formatted: null, isLoading: false };
}

/** Trim to 4 dp for display without lying about tiny dust. */
function trim(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  return n
    .toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false })
    .toString();
}
