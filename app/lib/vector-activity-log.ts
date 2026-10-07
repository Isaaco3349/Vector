/**
 * Client-side Vector activity journal for injected wallets.
 *
 * Circle (W3S) wallets use Circle's transactions list instead; this log still
 * records actions done in Vector so labels stay accurate (Swap vs Bridge vs Earn).
 */

export type VectorActivityKind =
  | "swap"
  | "bridge"
  | "earn-deposit"
  | "earn-withdraw"
  | "send";

export type VectorActivityEntry = {
  id: string;
  txHash: `0x${string}` | string;
  kind: VectorActivityKind;
  /** Chain where the transaction was submitted. */
  chainId: number;
  chainLabel?: string;
  /** e.g. "USDC → EURC", "Arc → Base", "12.5 USDC" */
  detail?: string;
  createdAt: string;
};

const STORAGE_PREFIX = "vector-activity-v1";
const MAX_ENTRIES = 80;

function storageKey(walletAddress: string): string {
  return `${STORAGE_PREFIX}:${walletAddress.toLowerCase()}`;
}

function readRaw(walletAddress: string): VectorActivityEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(walletAddress));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is VectorActivityEntry =>
        e &&
        typeof e === "object" &&
        typeof (e as VectorActivityEntry).txHash === "string" &&
        typeof (e as VectorActivityEntry).kind === "string",
    );
  } catch {
    return [];
  }
}

function writeRaw(walletAddress: string, entries: VectorActivityEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(walletAddress),
      JSON.stringify(entries.slice(0, MAX_ENTRIES)),
    );
  } catch {
    // Quota or private mode — non-fatal.
  }
}

/** Newest-first activity for this wallet from local storage. */
export function listVectorActivity(walletAddress: string): VectorActivityEntry[] {
  return readRaw(walletAddress).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export function recordVectorActivity(
  walletAddress: string,
  entry: Omit<VectorActivityEntry, "id" | "createdAt"> & {
    createdAt?: string;
  },
): void {
  if (!walletAddress || !entry.txHash) return;
  const hash = entry.txHash.toLowerCase();
  const id = hash;
  const createdAt = entry.createdAt ?? new Date().toISOString();
  const next: VectorActivityEntry = {
    id,
    txHash: entry.txHash,
    kind: entry.kind,
    chainId: entry.chainId,
    chainLabel: entry.chainLabel,
    detail: entry.detail,
    createdAt,
  };
  const existing = readRaw(walletAddress).filter(
    (e) => e.txHash.toLowerCase() !== hash,
  );
  writeRaw(walletAddress, [next, ...existing]);
}

export function activityKindLabel(kind: VectorActivityKind): string {
  switch (kind) {
    case "swap":
      return "Swap";
    case "bridge":
      return "Bridge";
    case "earn-deposit":
      return "Earn deposit";
    case "earn-withdraw":
      return "Earn withdrawal";
    case "send":
      return "Sent";
    default:
      return "Transaction";
  }
}
