"use client";

import type { QueryClient } from "@tanstack/react-query";
import { createPublicClient, http, type Hash } from "viem";
import { arcViemChain } from "./viem-arc-chain";
import { chainId as ARC_CHAIN_ID } from "./network";

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
      const client = createPublicClient({
        chain: arcViemChain,
        transport: http(),
      });
      await client.waitForTransactionReceipt({
        hash: txHash as Hash,
        confirmations: 1,
        timeout: 90_000,
      });
    } catch (err) {
      console.warn("[Vector] refreshBalancesAfterTx: receipt wait skipped", err);
    }
  }
  debouncedInvalidate(queryClient);
}

const BALANCE_POLL_DELAYS_MS = [4000] as const;

/** One follow-up balance read after bridge mint lag — not a global storm. */
export function scheduleBalancePoll(queryClient: QueryClient): void {
  void (async () => {
    for (const delayMs of BALANCE_POLL_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      debouncedInvalidate(queryClient);
    }
  })();
}
