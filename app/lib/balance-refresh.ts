"use client";

import type { QueryClient } from "@tanstack/react-query";
import { createPublicClient, http, type Hash } from "viem";
import { arcViemChain } from "./viem-arc-chain";

/** Invalidate wagmi balance reads so every open panel picks up new on-chain state. */
export async function invalidateOnchainBalances(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      return (
        head === "balance" ||
        head === "readContracts" ||
        head === "readContract"
      );
    },
  });
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
  await invalidateOnchainBalances(queryClient);
}

/** Re-read balances a few times — covers bridge mint lag and non-Arc source txs. */
export function scheduleBalancePoll(queryClient: QueryClient): void {
  void (async () => {
    for (const delayMs of [0, 1500, 4000]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      await invalidateOnchainBalances(queryClient);
    }
  })();
}
