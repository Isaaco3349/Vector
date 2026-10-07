import { bridgeChainByNumericId } from "./bridge-chains";
import type { VectorActivityKind } from "./vector-activity-log";
import type { WalletActivityItem } from "./wallet-activity-fetch";

export function mergeLocalActivity(
  remote: WalletActivityItem[],
  local: Array<{
    txHash: string;
    kind: VectorActivityKind;
    chainId: number;
    chainLabel?: string;
    detail?: string;
    createdAt: string;
  }>,
  kindLabel: (k: VectorActivityKind) => string,
): WalletActivityItem[] {
  const byHash = new Map<string, WalletActivityItem>();
  for (const item of remote) {
    byHash.set(item.txHash.toLowerCase(), item);
  }
  for (const entry of local) {
    const key = entry.txHash.toLowerCase();
    const chain = bridgeChainByNumericId(entry.chainId);
    byHash.set(key, {
      txHash: entry.txHash,
      chainId: entry.chainId,
      chainLabel: entry.chainLabel ?? chain?.label ?? String(entry.chainId),
      label: kindLabel(entry.kind),
      detail: entry.detail,
      timestamp: entry.createdAt,
      status: "confirmed",
    });
  }
  return [...byHash.values()].sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
    const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
    return tb - ta;
  });
}
