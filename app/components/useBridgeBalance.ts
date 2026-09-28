"use client";

import { erc20Abi, formatUnits } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { bridgeChainById, type BridgeChainId } from "../lib/bridge-chains";

/**
 * Read USDC balance on a bridge source/dest chain for display + amount checks.
 *
 * - Arc: spendable USDC for CCTP is the 6-decimal ERC-20 at `usdcAddress`
 *   (0x3600…), not native 18-decimal gas balance.
 * - Other chains: standard ERC-20 USDC via `balanceOf`.
 */
export function useBridgeBalance(chainId: BridgeChainId): {
  formatted: string | null;
  isLoading: boolean;
} {
  const { address, isConnected } = useAccount();
  const chain = bridgeChainById(chainId);

  const arcErc20Usdc =
    !!chain?.usdcAddress &&
    (chain.appKitChain === "Arc" || chain.appKitChain === "Arc_Testnet");

  const isErc20 =
    (chain?.usdcKind === "erc20" && !!chain.usdcAddress) || arcErc20Usdc;
  const isNative = chain?.usdcKind === "native" && !arcErc20Usdc;

  const nativeQuery = useBalance({
    address,
    chainId: chain?.chainId,
    query: { enabled: isConnected && !!address && isNative },
  });

  const erc20Address = chain?.usdcAddress;

  const erc20Query = useReadContracts({
    query: { enabled: isConnected && !!address && isErc20 && !!erc20Address },
    contracts:
      isErc20 && erc20Address
        ? [
            {
              chainId: chain!.chainId,
              address: erc20Address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address as `0x${string}`],
            },
            {
              chainId: chain!.chainId,
              address: erc20Address,
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

/** Trim to 4 dp for display without lying about tiny dust. */
function trim(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  return n
    .toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false })
    .toString();
}
