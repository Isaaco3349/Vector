"use client";

import { useCallback } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { bridgeChainById, type BridgeChainId } from "../lib/bridge-chains";
import { useArcUsdcBalance } from "./useArcUsdcBalance";

function isArcChain(id: BridgeChainId | undefined): boolean {
  return id === "Arc" || id === "Arc_Testnet";
}

/**
 * USDC on the selected bridge chain. On Arc, one USDC balance (native view).
 */
export function useBridgeBalance(chainId: BridgeChainId): {
  formatted: string | null;
  isLoading: boolean;
  arcWalletDesync?: boolean;
  refetch: () => Promise<void>;
} {
  const { address, isConnected } = useAccount();
  const chain = bridgeChainById(chainId);
  const arcUsdc = useArcUsdcBalance();

  const isArc = isArcChain(chain?.appKitChain);
  const isErc20 =
    !isArc && chain?.usdcKind === "erc20" && !!chain.usdcAddress;
  const isNative = !isArc && chain?.usdcKind === "native";

  // All wagmi hooks must run every render — never return before these (Rules of Hooks).
  const nativeQuery = useBalance({
    address,
    chainId: chain?.chainId,
    query: {
      enabled: isConnected && !!address && isNative,
    },
  });

  const erc20Query = useReadContracts({
    query: { enabled: isConnected && !!address && isErc20 },
    contracts:
      isErc20 && chain?.usdcAddress
        ? [
            {
              chainId: chain.chainId,
              address: chain.usdcAddress,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address as `0x${string}`],
            },
            {
              chainId: chain.chainId,
              address: chain.usdcAddress,
              abi: erc20Abi,
              functionName: "decimals",
            },
          ]
        : [],
  });

  const refetch = useCallback(async () => {
    if (isArc) {
      await arcUsdc.refetch();
      return;
    }
    if (isNative) {
      await nativeQuery.refetch();
      return;
    }
    if (isErc20) {
      await erc20Query.refetch();
    }
  }, [arcUsdc, erc20Query, isArc, isErc20, isNative, nativeQuery]);

  if (isArc) {
    return {
      formatted: arcUsdc.formatted,
      isLoading: arcUsdc.isLoading,
      arcWalletDesync: arcUsdc.walletBalanceDesync,
      refetch,
    };
  }

  if (isNative) {
    if (nativeQuery.isLoading) {
      return { formatted: null, isLoading: true, refetch };
    }
    const v = nativeQuery.data;
    if (!v) return { formatted: null, isLoading: false, refetch };
    return {
      formatted: trim(formatUnits(v.value, v.decimals)),
      isLoading: false,
      refetch,
    };
  }

  if (isErc20) {
    if (erc20Query.isLoading) {
      return { formatted: null, isLoading: true, refetch };
    }
    const results = erc20Query.data;
    const rawBalance = results?.[0]?.result;
    const decimals = results?.[1]?.result;
    if (typeof rawBalance !== "bigint" || typeof decimals !== "number") {
      return { formatted: null, isLoading: false, refetch };
    }
    return {
      formatted: trim(formatUnits(rawBalance, decimals)),
      isLoading: false,
      refetch,
    };
  }

  return { formatted: null, isLoading: false, refetch: async () => {} };
}

function trim(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  return n
    .toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false })
    .toString();
}
