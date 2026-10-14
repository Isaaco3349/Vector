"use client";

import { useCallback, useEffect, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import {
  clearArcPublicReadCache,
  readErc20BalanceViaProvider,
  readSwapInputBalancePublic,
  verifiedArcTokenDecimals,
} from "../lib/arc-erc20-read";
import { okxInAppBrowser } from "../lib/wallet-brand";
import { chainId as ARC_CHAIN_ID } from "../lib/network";
import { tokenBySymbol } from "../lib/swap-tokens";
import { resolveSigningProviderCached } from "../lib/wallet-provider";
import { useSharedArcUsdcBalance } from "./ArcUsdcBalanceContext";
import { useArcBalancesSnapshot } from "./useArcBalancesPoll";

/**
 * Arc token balances for Swap / portfolio.
 * USDC uses Arc's unified native balance (one pool — see docs.arc.io).
 */
export function useTokenBalance(symbol: string): {
  formatted: string | null;
  /** Full on-chain balance for Max — no display rounding. */
  maxSpendable: string | null;
  isLoading: boolean;
  arcWalletDesync?: boolean;
  refetch: () => Promise<void>;
} {
  const { address, isConnected, connector } = useAccount();
  const token = tokenBySymbol(symbol);

  const isUsdc = token?.symbol === "USDC";
  const arcUsdc = useSharedArcUsdcBalance();
  const arcSnapshot = useArcBalancesSnapshot();
  const verifiedDecimals = verifiedArcTokenDecimals(symbol);
  const isVerifiedErc20 =
    !isUsdc && token?.kind === "erc20" && !!token.address && verifiedDecimals !== null;
  const isLegacyErc20 =
    !isUsdc &&
    token?.kind === "erc20" &&
    !!token.address &&
    verifiedDecimals === null;

  const balanceQuery = useReadContract({
    chainId: ARC_CHAIN_ID,
    address: token?.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address as `0x${string}`] : undefined,
    query: {
      enabled:
        isConnected &&
        !!address &&
        isVerifiedErc20 &&
        !!token?.address &&
        !okxInAppBrowser(),
      staleTime: 0,
      refetchInterval: false,
      refetchOnWindowFocus: true,
    },
  });

  const erc20Query = useReadContracts({
    query: {
      enabled: isConnected && !!address && isLegacyErc20,
      staleTime: 0,
      refetchInterval: false,
    },
    contracts: isLegacyErc20
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

  const [walletRaw, setWalletRaw] = useState<bigint | null>(null);
  const [walletFetchDone, setWalletFetchDone] = useState(false);
  const [publicRaw, setPublicRaw] = useState<bigint | null>(null);
  const [publicFetchDone, setPublicFetchDone] = useState(false);
  const [walletFetchGen, setWalletFetchGen] = useState(0);
  const [manualPublicRaw, setManualPublicRaw] = useState<bigint | null>(null);

  const preferPublicRead =
    isVerifiedErc20 && !!address && !!token?.address;
  const okxPublicRead = okxInAppBrowser() && preferPublicRead;

  const wagmiRawVerified =
    typeof balanceQuery.data === "bigint" ? balanceQuery.data : null;
  const wagmiRawLegacy = (() => {
    const raw = erc20Query.data?.[0]?.result;
    return typeof raw === "bigint" ? raw : null;
  })();

  const needsWalletFallback =
    isVerifiedErc20 &&
    !!address &&
    !!token?.address &&
    balanceQuery.isFetched &&
    !balanceQuery.isFetching &&
    wagmiRawVerified === null &&
    (balanceQuery.isError || balanceQuery.data === undefined);

  useEffect(() => {
    if (!preferPublicRead) {
      setPublicRaw(null);
      setPublicFetchDone(false);
      return;
    }
    let cancelled = false;
    setPublicFetchDone(false);
    void (async () => {
      try {
        const raw = await readSwapInputBalancePublic(
          token!.address!,
          address as `0x${string}`,
        );
        if (!cancelled) setPublicRaw(raw);
      } catch {
        if (!cancelled) setPublicRaw(null);
      } finally {
        if (!cancelled) setPublicFetchDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preferPublicRead, connector, address, token?.address, symbol, walletFetchGen]);

  useEffect(() => {
    if (!needsWalletFallback) {
      setWalletRaw(null);
      setWalletFetchDone(false);
      return;
    }
    let cancelled = false;
    setWalletFetchDone(false);
    void (async () => {
      try {
        if (cancelled || !token?.address) return;
        const raw = okxInAppBrowser()
          ? await readSwapInputBalancePublic(token.address, address as `0x${string}`)
          : await (async () => {
              const provider = await resolveSigningProviderCached(
                connector,
                address,
              );
              if (!provider) return null;
              return readErc20BalanceViaProvider(
                provider,
                token.address!,
                address as `0x${string}`,
              );
            })();
        if (raw !== null && !cancelled) setWalletRaw(raw);
      } catch {
        if (!cancelled) setWalletRaw(null);
      } finally {
        if (!cancelled) setWalletFetchDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    needsWalletFallback,
    connector,
    address,
    token?.address,
    walletFetchGen,
  ]);

  const refetch = useCallback(async () => {
    clearArcPublicReadCache();
    if (isUsdc) await arcUsdc.refetch();
    await balanceQuery.refetch();
    await erc20Query.refetch();
    if (isVerifiedErc20 && address && token?.address) {
      try {
        const raw = await readSwapInputBalancePublic(
          token.address,
          address as `0x${string}`,
        );
        setManualPublicRaw(raw);
      } catch {
        setManualPublicRaw(null);
      }
    }
    await arcSnapshot?.refresh();
    setWalletFetchGen((g) => g + 1);
  }, [
    arcUsdc,
    arcSnapshot,
    balanceQuery,
    erc20Query,
    isUsdc,
    isVerifiedErc20,
    address,
    token?.address,
  ]);

  if (isUsdc) {
    return {
      formatted: arcUsdc.formatted,
      maxSpendable: arcUsdc.maxSpendable ?? arcUsdc.formatted,
      isLoading: arcUsdc.isLoading,
      arcWalletDesync: arcUsdc.walletBalanceDesync,
      refetch,
    };
  }

  if (isVerifiedErc20 && verifiedDecimals !== null) {
    const serverMinor = (() => {
      const snap = arcSnapshot?.snapshot;
      if (!snap) return null;
      if (symbol === "cirBTC") return BigInt(snap.cirBtcMinor);
      if (symbol === "EURC") return BigInt(snap.eurcMinor);
      return null;
    })();
    const isLoading =
      (arcSnapshot?.isLoading && serverMinor === null && publicRaw === null) ||
      (preferPublicRead && !publicFetchDone && publicRaw === null && serverMinor === null) ||
      (!preferPublicRead &&
        (balanceQuery.isLoading ||
          (needsWalletFallback && !walletFetchDone && walletRaw === null)));
    const publicMerged =
      manualPublicRaw !== null ? manualPublicRaw : publicRaw;
    const raw =
      serverMinor ??
      (publicMerged !== null ? publicMerged : null) ??
      wagmiRawVerified ??
      walletRaw;
    if (isLoading && raw === null) {
      return {
        formatted: null,
        maxSpendable: null,
        isLoading: true,
        refetch,
      };
    }
    if (raw === null) {
      return {
        formatted: null,
        maxSpendable: null,
        isLoading: false,
        refetch,
      };
    }
    const maxSpendable = trimTrailingZeros(formatUnits(raw, verifiedDecimals));
    return {
      formatted: trim(formatUnits(raw, verifiedDecimals), symbol),
      maxSpendable,
      isLoading: false,
      refetch,
    };
  }

  if (isLegacyErc20) {
    if (erc20Query.isLoading) {
      return {
        formatted: null,
        maxSpendable: null,
        isLoading: true,
        refetch,
      };
    }
    const results = erc20Query.data;
    const rawBalance = results?.[0]?.result;
    const decimals = normalizeDecimals(results?.[1]?.result);
    if (typeof rawBalance !== "bigint" || decimals === null) {
      return {
        formatted: null,
        maxSpendable: null,
        isLoading: false,
        refetch,
      };
    }
    const maxSpendable = trimTrailingZeros(formatUnits(rawBalance, decimals));
    return {
      formatted: trim(formatUnits(rawBalance, decimals)),
      maxSpendable,
      isLoading: false,
      refetch,
    };
  }

  return {
    formatted: null,
    maxSpendable: null,
    isLoading: false,
    refetch: async () => {},
  };
}

function normalizeDecimals(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

function trimTrailingZeros(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "") || "0";
}

function trim(value: string, symbol?: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  const maxFrac = symbol === "cirBTC" ? 8 : 4;
  return n
    .toLocaleString("en-US", { maximumFractionDigits: maxFrac, useGrouping: false })
    .toString();
}
