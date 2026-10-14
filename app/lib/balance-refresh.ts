"use client";

import type { QueryClient } from "@tanstack/react-query";
import { arcViemChain } from "./viem-arc-chain";
import { chainId as ARC_CHAIN_ID } from "./network";
import { waitArcTransactionReceipt } from "./arc-tx-wait";
import { clearArcPublicReadCache } from "./arc-erc20-read";
import type { Eip1193Provider } from "./appkit";

/** Invalidate Arc balance reads only — not every wagmi query in the tab. */
export async function invalidateOnchainBalances(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      if (head !== "balance" && head !== "readContracts" && head !== "readContract") {
        return false;
      }
      const params = query.queryKey[1] as { chainId?: number } | undefined;
      if (params && typeof params === "object" && "chainId" in params) {
        return params.chainId === ARC_CHAIN_ID;
      }
      return head === "balance" || head === "readContracts" || head === "readContract";
    },
  });
}

let invalidateDebounce: ReturnType<typeof setTimeout> | null = null;

function debouncedInvalidate(queryClient: QueryClient): void {
  if (invalidateDebounce) clearTimeout(invalidateDebounce);
  invalidateDebounce = setTimeout(() => {
    invalidateDebounce = null;
    void invalidateOnchainBalances(queryClient);
  }, 400);
}

/**
 * After a tx, wait for Arc confirmation then invalidate cached balances.
 * Safe to call with a null hash (invalidates immediately).
 */
export async function refreshBalancesAfterTx(
  queryClient: QueryClient,
  txHash?: string | null,
  /** When set and not Arc, skip receipt wait (burn on L2) and invalidate only. */
  sourceChainId?: number,
): Promise<void> {
  const waitOnArc =
    txHash &&
    (sourceChainId === undefined || sourceChainId === arcViemChain.id);
  if (waitOnArc) {
    try {
      await waitArcTransactionReceipt({} as Eip1193Provider, txHash);
    } catch (err) {
      console.warn("[Vector] refreshBalancesAfterTx: receipt wait skipped", err);
    }
  }
  await invalidateOnchainBalances(queryClient);
  debouncedInvalidate(queryClient);
}

const BALANCE_POLL_DELAYS_MS = [800, 2500, 6000, 12_000] as const;

/** Aggressive refresh after swap — Binance/wagmi caches lag without this. */
export async function flushBalancesAfterSwap(
  queryClient: QueryClient,
  txHash: string | null,
  refetchTokens: Array<() => Promise<void>>,
  /** When bridging from a non-Arc chain, skip Arc receipt polling for the burn hash. */
  sourceChainId?: number,
): Promise<void> {
  clearArcPublicReadCache();
  await refreshBalancesAfterTx(queryClient, txHash, sourceChainId);
  await Promise.all(refetchTokens.map((fn) => fn()));
  scheduleBalancePoll(queryClient);
  for (const delayMs of BALANCE_POLL_DELAYS_MS) {
    await new Promise((r) => setTimeout(r, delayMs));
    await invalidateOnchainBalances(queryClient);
    await Promise.all(refetchTokens.map((fn) => fn()));
  }
}

/**
 * Manual Refresh in Swap/Bridge: server Arc RPC first, then invalidate wagmi cache.
 */
export async function flushArcBalancesImmediate(
  queryClient: QueryClient,
  serverRefresh: (() => Promise<void>) | undefined,
  tokenRefetches: Array<() => Promise<void>>,
): Promise<void> {
  clearArcPublicReadCache();
  if (serverRefresh) {
    await serverRefresh();
  }
  await invalidateOnchainBalances(queryClient);
  await Promise.all(tokenRefetches.map((fn) => fn()));
}

/** One follow-up balance read after bridge mint lag — not a global storm. */
export function scheduleBalancePoll(queryClient: QueryClient): void {
  void (async () => {
    for (const delayMs of BALANCE_POLL_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      debouncedInvalidate(queryClient);
    }
  })();
}
