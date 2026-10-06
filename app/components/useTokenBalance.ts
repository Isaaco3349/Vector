"use client";

import { erc20Abi, formatUnits } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { chainId as ARC_CHAIN_ID } from "../lib/network";
import { tokenBySymbol } from "../lib/swap-tokens";
import { useArcUsdcBalance } from "./useArcUsdcBalance";

/**
 * Arc token balances for Swap / portfolio.
 * USDC uses Arc's unified native balance (one pool — see docs.arc.io).
 */
export function useTokenBalance(symbol: string): {
  formatted: string | null;
  isLoading: boolean;
  arcWalletDesync?: boolean;
  refetch: () => Promise<void>;
} {
  const { address, isConnected } = useAccount();
  const arcUsdc = useArcUsdcBalance();
  const token = tokenBySymbol(symbol);

  const isUsdc = token?.symbol === "USDC";
  const isErc20 = !isUsdc && token?.kind === "erc20" && !!token.address;

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

  if (isUsdc) {
    return {
      formatted: arcUsdc.formatted,
      isLoading: arcUsdc.isLoading,
      arcWalletDesync: arcUsdc.walletBalanceDesync,
      refetch: arcUsdc.refetch,
    };
  }

  if (isErc20) {
    if (erc20Query.isLoading) {
      return {
        formatted: null,
        isLoading: true,
        refetch: async () => {
          await erc20Query.refetch();
        },
      };
    }
    const results = erc20Query.data;
    const rawBalance = results?.[0]?.result;
    const decimals = results?.[1]?.result;
    if (typeof rawBalance !== "bigint" || typeof decimals !== "number") {
      return {
        formatted: null,
        isLoading: false,
        refetch: async () => {
          await erc20Query.refetch();
        },
      };
    }
    return {
      formatted: trim(formatUnits(rawBalance, decimals)),
      isLoading: false,
      refetch: async () => {
        await erc20Query.refetch();
      },
    };
  }

  return {
    formatted: null,
    isLoading: false,
    refetch: async () => {},
  };
}

function trim(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  return n
    .toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false })
    .toString();
}
