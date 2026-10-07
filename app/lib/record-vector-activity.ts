"use client";

import {
  activityKindLabel,
  recordVectorActivity,
  type VectorActivityKind,
} from "./vector-activity-log";

/** Fire-and-forget activity journal write after a successful Vector action. */
export function logVectorActivity(args: {
  walletAddress: string | undefined;
  txHash: string | null | undefined;
  kind: VectorActivityKind;
  chainId: number;
  chainLabel?: string;
  detail?: string;
}): void {
  const { walletAddress, txHash, kind, chainId, chainLabel, detail } = args;
  if (!walletAddress || !txHash) return;
  recordVectorActivity(walletAddress, {
    txHash,
    kind,
    chainId,
    chainLabel,
    detail,
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("vector-activity-updated", {
        detail: { address: walletAddress.toLowerCase() },
      }),
    );
  }
}

export { activityKindLabel };
