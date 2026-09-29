"use client";

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
} {
  const { address, isConnected } = useAccount();
  const chain = bridgeChainById(chainId);
  const arcUsdc = useArcUsdcBalance();

  if (isArcChain(chain?.appKitChain)) {
    return {
      formatted: arcUsdc.formatted,
      isLoading: arcUsdc.isLoading,
      arcWalletDesync: arcUsdc.walletBalanceDesync,
    };
  }

  const isErc20 = chain?.usdcKind === "erc20" && !!chain.usdcAddress;

  const nativeQuery = useBalance({
    address,
    chainId: chain?.chainId,
    query: {
      enabled: isConnected && !!address && chain?.usdcKind === "native",
    },
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

  if (chain?.usdcKind === "native") {
    if (nativeQuery.isLoading) return { formatted: null, isLoading: true };
    const v = nativeQuery.data;
    if (!v) return { formatted: null, isLoading: false };
    return {
      formatted: trim(formatUnits(v.value, v.decimals)),
      isLoading: false,
    };
  }

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

function trim(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  return n
    .toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false })
    .toString();
}
