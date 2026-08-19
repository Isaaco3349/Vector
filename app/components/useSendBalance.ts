"use client";

import { erc20Abi, formatUnits } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import type { BridgeChain } from "../lib/bridge-chains";

/**
 * Read the connected wallet's USDC balance on a specific chain FOR SENDING.
 *
 * Unlike the display-only bridge/swap balance hooks, Send also needs the raw
 * on-chain integer and the token's decimals so it can (a) validate the entered
 * amount against the true balance and (b) encode the transfer with the correct
 * precision. Decimals are always read from the source of truth — the chain's
 * native currency for Arc, or the ERC-20's own `decimals()` elsewhere — never
 * hardcoded, so a wrong constant can't mis-scale a real transfer.
 *
 *  - Arc: USDC is the native gas asset → wagmi `useBalance` (value + decimals).
 *  - Base / Ethereum Sepolia: USDC is an ERC-20 → read `balanceOf` + `decimals`.
 */
export function useSendBalance(chain: BridgeChain | undefined): {
  formatted: string | null;
  raw: bigint | null;
  decimals: number | null;
  isLoading: boolean;
} {
  const { address, isConnected } = useAccount();

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
    if (nativeQuery.isLoading) {
      return { formatted: null, raw: null, decimals: null, isLoading: true };
    }
    const v = nativeQuery.data;
    if (!v) return { formatted: null, raw: null, decimals: null, isLoading: false };
    return {
      formatted: trim(formatUnits(v.value, v.decimals)),
      raw: v.value,
      decimals: v.decimals,
      isLoading: false,
    };
  }

  if (isErc20) {
    if (erc20Query.isLoading) {
      return { formatted: null, raw: null, decimals: null, isLoading: true };
    }
    const results = erc20Query.data;
    const rawBalance = results?.[0]?.result;
    const decimals = results?.[1]?.result;
    if (typeof rawBalance !== "bigint" || typeof decimals !== "number") {
      return { formatted: null, raw: null, decimals: null, isLoading: false };
    }
    return {
      formatted: trim(formatUnits(rawBalance, decimals)),
      raw: rawBalance,
      decimals,
      isLoading: false,
    };
  }

  return { formatted: null, raw: null, decimals: null, isLoading: false };
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
