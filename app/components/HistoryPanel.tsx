"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { VectorModalShell } from "./VectorModalShell";
import {
  BRIDGE_CHAINS,
  arcBridgeChainId,
  bridgeChainByNumericId,
  explorerAddressUrl,
  explorerAddressUrlByNumericId,
  explorerTxUrl,
} from "../lib/bridge-chains";
import {
  activityKindLabel,
  listVectorActivity,
} from "../lib/vector-activity-log";
import { mergeLocalActivity } from "../lib/vector-activity-merge";
import type { WalletActivityItem } from "../lib/wallet-activity-fetch";
import { w3sContractActivityLabel } from "../lib/vector-contract-labels";
import {
  fetchRecentTransactions,
  type W3sTx,
} from "../lib/w3s-transactions";

/**
 * Transaction history / activity panel (read-only).
 *
 * - Google (Circle / W3S): Circle's transactions list, with Vector-oriented labels.
 * - External wallet: local Vector journal + explorer aggregation via /api/wallet-activity.
 */
export function HistoryPanel({
  source,
  walletAddress,
  userToken,
  walletId,
  numericChainId,
  onClose,
}: {
  source: "circle" | "wallet";
  walletAddress: string;
  userToken?: string;
  walletId?: string;
  numericChainId?: number;
  onClose: () => void;
}) {
  const isCircle = source === "circle";

  const [txs, setTxs] = useState<W3sTx[] | null>(null);
  const [walletItems, setWalletItems] = useState<WalletActivityItem[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const loadCircle = useCallback(async (signal: AbortSignal) => {
    if (!userToken || !walletId) return;
    setLoading(true);
    const list = await fetchRecentTransactions({
      userToken,
      walletId,
      pageSize: 25,
      signal,
    });
    setTxs(list);
    setLoading(false);
  }, [userToken, walletId]);

  const loadExternal = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    const local = listVectorActivity(walletAddress);
    try {
      const res = await fetch(
        `/api/wallet-activity?address=${encodeURIComponent(walletAddress)}`,
        { signal },
      );
      const remote: WalletActivityItem[] = res.ok
        ? ((await res.json())?.items ?? [])
        : [];
      setWalletItems(
        mergeLocalActivity(remote, local, activityKindLabel).slice(0, 40),
      );
    } catch {
      setWalletItems(
        mergeLocalActivity([], local, activityKindLabel).slice(0, 40),
      );
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    const controller = new AbortController();
    if (isCircle) {
      void loadCircle(controller.signal);
    } else {
      void loadExternal(controller.signal);
    }
    return () => controller.abort();
  }, [isCircle, loadCircle, loadExternal]);

  useEffect(() => {
    if (isCircle) return;
    const onUpdate = (ev: Event) => {
      const detail = (ev as CustomEvent<{ address?: string }>).detail;
      if (detail?.address === walletAddress.toLowerCase()) {
        void loadExternal(new AbortController().signal);
      }
    };
    window.addEventListener("vector-activity-updated", onUpdate);
    return () => window.removeEventListener("vector-activity-updated", onUpdate);
  }, [isCircle, walletAddress, loadExternal]);

  const fullHistoryUrl = useMemo(() => {
    return isCircle
      ? explorerAddressUrl(arcBridgeChainId(), walletAddress)
      : explorerAddressUrlByNumericId(numericChainId, walletAddress);
  }, [isCircle, walletAddress, numericChainId]);

  return (
    <VectorModalShell title="Activity" onClose={onClose}>
      {isCircle ? (
        <>
          {loading && (
            <p className="text-[13px] text-[var(--vector-text-dim)] py-8 text-center">
              Loading activity…
            </p>
          )}

          {!loading && txs && txs.length === 0 && (
            <p className="text-[13px] text-[var(--vector-text-dim)] py-8 text-center leading-relaxed">
              No transactions yet. Once you send, swap, bridge, or earn,
              they&apos;ll show up here.
            </p>
          )}

          {!loading && txs && txs.length > 0 && (
            <div className="space-y-2">
              {txs.map((tx, i) => (
                <CircleTxRow key={tx.id ?? String(i)} tx={tx} />
              ))}
            </div>
          )}

          {fullHistoryUrl && (
            <a
              href={fullHistoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 block text-center text-[12px] text-[var(--vector-pink)] font-mono hover:opacity-80 transition-opacity"
            >
              View full history on Arc explorer ↗
            </a>
          )}
        </>
      ) : (
        <>
          {loading && (
            <p className="text-[13px] text-[var(--vector-text-dim)] py-8 text-center">
              Loading activity…
            </p>
          )}

          {!loading && walletItems && walletItems.length === 0 && (
            <p className="text-[13px] text-[var(--vector-text-dim)] py-8 text-center leading-relaxed">
              No recent activity yet. Swaps, bridges, earn deposits, and sends
              you complete in Vector will appear here.
            </p>
          )}

          {!loading && walletItems && walletItems.length > 0 && (
            <div className="space-y-2">
              {walletItems.map((item) => (
                <WalletActivityRow key={item.txHash} item={item} />
              ))}
            </div>
          )}

          {fullHistoryUrl && (
            <a
              href={fullHistoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 block text-center text-[12px] text-[var(--vector-pink)] font-mono hover:opacity-80 transition-opacity"
            >
              View full history on block explorer ↗
            </a>
          )}
        </>
      )}
    </VectorModalShell>
  );
}

function WalletActivityRow({ item }: { item: WalletActivityItem }) {
  const chain = bridgeChainByNumericId(item.chainId);
  const appKitId = chain?.appKitChain ?? arcBridgeChainId();
  const link = explorerTxUrl(appKitId, item.txHash);
  const when = relativeTime(item.timestamp);
  const badge = activityStatusBadge(item.status);

  const inner = (
    <div className="w-full rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold text-[var(--vector-text)]">
          {item.label}
        </span>
        {item.detail && (
          <span className="text-[12px] font-mono text-[var(--vector-text-dim)] text-right shrink-0">
            {item.detail}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px] font-mono text-[var(--vector-text-dim)]">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className={badge.className}>{badge.text}</span>
          <span>· {item.chainLabel}</span>
          {when && <span>· {when}</span>}
        </span>
        {link && <span className="text-[var(--vector-pink)]">View ↗</span>}
      </div>
    </div>
  );

  if (!link) return inner;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="block hover:opacity-90 transition-opacity"
    >
      {inner}
    </a>
  );
}

function CircleTxRow({ tx }: { tx: W3sTx }) {
  const label = txLabel(tx);
  const link = tx.txHash ? explorerTxUrl(arcBridgeChainId(), tx.txHash) : null;
  const when = relativeTime(tx.createDate);
  const badge = stateBadge(tx.state);
  const showAmount =
    tx.operation?.toUpperCase() === "TRANSFER" &&
    tx.amount !== null &&
    tx.amount !== "" &&
    Number(tx.amount) > 0;

  const inner = (
    <div className="w-full rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold text-[var(--vector-text)]">
          {label}
        </span>
        {showAmount && (
          <span className="text-[14px] font-semibold text-[var(--vector-text)] font-mono">
            {tx.amount} USDC
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px] font-mono text-[var(--vector-text-dim)]">
        <span className="flex items-center gap-1.5">
          <span className={badge.className}>{badge.text}</span>
          {when && <span>· {when}</span>}
        </span>
        {link && <span className="text-[var(--vector-pink)]">View ↗</span>}
      </div>
    </div>
  );

  if (!link) return inner;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="block hover:opacity-90 transition-opacity"
    >
      {inner}
    </a>
  );
}

function txLabel(tx: W3sTx): string {
  const type = tx.transactionType?.toUpperCase();
  const op = tx.operation?.toUpperCase();
  if (op === "TRANSFER") {
    if (type === "INBOUND") return "Received";
    if (type === "OUTBOUND") return "Sent";
    return "Transfer";
  }
  if (op === "CONTRACTEXECUTION") {
    return w3sContractActivityLabel(tx.contractAddress) ?? "Contract execution";
  }
  return "Transaction";
}

function activityStatusBadge(
  status: WalletActivityItem["status"],
): { text: string; className: string } {
  if (status === "failed") {
    return { text: "Failed", className: "text-[var(--vector-pink)]" };
  }
  if (status === "pending") {
    return { text: "Pending", className: "text-[var(--vector-text-dim)]" };
  }
  return { text: "Confirmed", className: "text-[var(--vector-text-dim)]" };
}

function stateBadge(state: string | null): { text: string; className: string } {
  const s = (state ?? "").toUpperCase();
  if (s === "COMPLETE" || s === "CONFIRMED") {
    return { text: "Confirmed", className: "text-[var(--vector-text-dim)]" };
  }
  if (s === "FAILED" || s === "CANCELLED" || s === "DENIED") {
    return { text: "Failed", className: "text-[var(--vector-pink)]" };
  }
  if (s === "") {
    return { text: "Pending", className: "text-[var(--vector-text-dim)]" };
  }
  const pretty = s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
  return { text: pretty, className: "text-[var(--vector-text-dim)]" };
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString();
}
