"use client";

import { erc20Abi, formatUnits } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { chainId as ARC_CHAIN_ID } from "../lib/network";
import { tokenBySymbol } from "../lib/swap-tokens";

/**
 * Read the connected wallet's balance for Arc tokens Vector knows about.
 *
 * All reads are scoped to Vector's Arc network (`chainId` from network.ts), not
 * whatever chain the wallet UI happens to be on — so a "USDC" balance is never
 * another network's native currency mislabeled.
 *
 * - USDC: 6-decimal ERC-20 at Arc `usdcAddress` (matches App Kit swap/CCTP).
 * - cirBTC / EURC: ERC-20 `balanceOf` + on-chain `decimals`.
 * - kind "unknown": returns null.
 */
export function useTokenBalance(symbol: string): {
  formatted: string | null;
  isLoading: boolean;
} {
  const { address, isConnected } = useAccount();
  const token = tokenBySymbol(symbol);

  const isErc20 = token?.kind === "erc20" && !!token.address;

  const erc20Query = useReadContracts({
    query: { enabled: isConnected && !!address && isErc20 },
    contracts: isErc20
      ? [
          {
            chainId: ARC_CHAIN_ID,
            address: token!.address!,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address as `0x${string}`],
          },
          {
            chainId: ARC_CHAIN_ID,
            address: token!.address!,
            abi: erc20Abi,
            functionName: "decimals",
          },
        ]
      : [],
  });

  if (isErc20) {
    if (erc20Query.isLoading) return { formatted: null, isLoading: true };
    const results = erc20Query.data;
    const rawBalance = results?.[0]?.result;
    const decimals = results?.[1]?.result;
    if (typeof rawBalance !== "bigint" || typeof decimals !== "number") {
      return { formatted: null, isLoading: false };
    }
    return {
      formatted: trim(formatUnits(rawBalance, decimals)),
      isLoading: false,
    };
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
