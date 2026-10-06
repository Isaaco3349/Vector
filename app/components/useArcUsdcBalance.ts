"use client";

import { useCallback } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import {
  arcUsdcHumanFromNativeWei,
  arcUsdcNativeToErc20Minor,
  ARC_USDC_SCALE,
} from "../lib/arc-usdc-balance";
import { arcUsdcAddress, chainId as ARC_CHAIN_ID } from "../lib/network";

/**
 * Single Arc USDC balance for UI — native is authoritative (gas + same pool per Arc).
 * Cross-checks ERC-20 view; flags wallet/RPC desync (OKX/MetaMask Arc quirks).
 */
export function useArcUsdcBalance(): {
  formatted: string | null;
  nativeWei: bigint | null;
  erc20Minor: bigint | null;
  walletBalanceDesync: boolean;
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const { address, isConnected } = useAccount();

  const nativeQuery = useBalance({
    address,
    chainId: ARC_CHAIN_ID,
    query: { enabled: isConnected && !!address },
  });

  const erc20Query = useReadContracts({
    query: { enabled: isConnected && !!address },
    contracts: [
      {
        chainId: ARC_CHAIN_ID,
        address: arcUsdcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      },
    ],
  });

  const refetch = useCallback(async () => {
    await Promise.all([nativeQuery.refetch(), erc20Query.refetch()]);
  }, [nativeQuery, erc20Query]);

  if (nativeQuery.isLoading || erc20Query.isLoading) {
    return {
      formatted: null,
      nativeWei: null,
      erc20Minor: null,
      walletBalanceDesync: false,
      isLoading: true,
      refetch,
    };
  }

  const nativeWei = nativeQuery.data?.value ?? null;
  const erc20Minor =
    typeof erc20Query.data?.[0]?.result === "bigint"
      ? erc20Query.data[0].result
      : null;

  if (nativeWei === null && erc20Minor === null) {
    return {
      formatted: null,
      nativeWei: null,
      erc20Minor: null,
      walletBalanceDesync: false,
      isLoading: false,
      refetch,
    };
  }

  const native = nativeWei ?? BigInt(0);
  const erc20 = erc20Minor ?? BigInt(0);
  const expectedErc20 = arcUsdcNativeToErc20Minor(native);
  const walletBalanceDesync =
    erc20 > BigInt(0) &&
    native < ARC_USDC_SCALE &&
    expectedErc20 + BigInt(1) < erc20;

  let formatted: string;
  if (native > BigInt(0)) {
    formatted = trim(arcUsdcHumanFromNativeWei(native));
  } else if (erc20 > BigInt(0)) {
    formatted = trim(formatUnits(erc20, 6));
  } else {
    formatted = "0";
  }

  return {
    formatted,
    nativeWei: native,
    erc20Minor: erc20,
    walletBalanceDesync,
    isLoading: false,
    refetch,
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
