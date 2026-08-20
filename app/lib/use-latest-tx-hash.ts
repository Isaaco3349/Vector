"use client";

import { useEffect, useRef, useState } from "react";
import { waitForTxHash } from "./w3s-transactions";

/**
 * Resolve the on-chain hash of the transaction a W3S challenge just created.
 *
 * A W3S CREATE_TRANSACTION challenge (transfer / contractExecution) returns no
 * txHash in its completion callback, so after the challenge completes the hash
 * has to be polled from Circle's transactions list (see waitForTxHash). This
 * hook does that in the BACKGROUND once `trigger` flips true (e.g. the panel's
 * `done` state), so the success screen can render immediately with an explorer
 * address-page fallback and then upgrade to the exact tx link when the hash
 * lands.
 *
 * It starts at most once and is safe against unmount (it won't set state after
 * the panel closes), so it can't leak or warn.
 */
export function useLatestTxHash(args: {
  userToken: string;
  walletId: string;
  trigger: boolean;
}): string | null {
  const { userToken, walletId, trigger } = args;
  const [hash, setHash] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!trigger || startedRef.current) return;
    if (!userToken || !walletId) return;
    startedRef.current = true;

    let alive = true;
    void (async () => {
      const h = await waitForTxHash({ userToken, walletId });
      if (alive && h) setHash(h);
    })();

    return () => {
      alive = false;
    };
  }, [trigger, userToken, walletId]);

  return hash;
}
