"use client";

import { useEffect, useMemo, useState } from "react";
import {
  explorerAddressUrl,
  explorerAddressUrlByNumericId,
  explorerTxUrl,
} from "../lib/bridge-chains";
import {
  fetchRecentTransactions,
  type W3sTx,
} from "../lib/w3s-transactions";

/**
 * Transaction history / activity panel.
 *
 * Two very different data situations, handled honestly:
 *
 *  - Google (Circle / W3S) wallet: we CAN read the wallet's transactions from
 *    Circle's list endpoint (via our read-only /api/endpoints proxy), so we
 *    show them inline, newest-first, each linking to the Arc explorer when a
 *    hash is available. A footer link to the wallet's explorer address page is
 *    always present as the authoritative "full history".
 *
 *  - External (injected) wallet: Vector has no verified API to enumerate an
 *    arbitrary wallet's history, and inventing one would risk showing wrong
 *    data. So instead of faking a list, we send the user straight to the block
 *    explorer's address page for whatever chain they're connected to — the
 *    real, complete source of truth.
 *
 * Everything here is READ-ONLY: no funds move, nothing is signed.
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
  /** Circle wallet only — required to read the transaction list. */
  userToken?: string;
  /** Circle wallet only — scopes the transaction list to this wallet. */
  walletId?: string;
  /** External wallet only — the connected chain's numeric id, for the link. */
  numericChainId?: number;
  onClose: () => void;
}) {
  const isCircle = source === "circle";

  const [txs, setTxs] = useState<W3sTx[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Load the Circle wallet's transactions once when the panel opens.
  useEffect(() => {
    if (!isCircle || !userToken || !walletId) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      const list = await fetchRecentTransactions({
        userToken,
        walletId,
        pageSize: 25,
        signal: controller.signal,
      });
      if (!cancelled) {
        setTxs(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isCircle, userToken, walletId]);

  // Full-history link: Arc for the Circle wallet; the connected chain for an
  // external wallet. Always available, needs no API.
  const fullHistoryUrl = useMemo(() => {
    return isCircle
      ? explorerAddressUrl("Arc_Testnet", walletAddress)
      : explorerAddressUrlByNumericId(numericChainId, walletAddress);
  }, [isCircle, walletAddress, numericChainId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-t-3xl sm:rounded-3xl border border-[var(--vector-line)] bg-[var(--vector-surface)] p-6 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <span className="text-[17px] font-semibold">Activity</span>
          <button
            onClick={onClose}
            className="text-[var(--vector-text-dim)] text-[13px] hover:text-[var(--vector-text)]"
          >
            Close
          </button>
        </div>

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
                  <TxRow key={tx.id ?? String(i)} tx={tx} />
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
          // ---- External wallet: link out to the real explorer ----
          <div className="py-4">
            <p className="text-[13px] text-[var(--vector-text-dim)] leading-relaxed mb-6 text-center">
              Your connected wallet&apos;s full, authoritative transaction
              history lives on the block explorer for the network you&apos;re
              on. Open it there to see every transaction.
            </p>
            {fullHistoryUrl ? (
              <a
                href={fullHistoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full h-[48px] leading-[48px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[14px] text-center hover:opacity-90 active:opacity-80 transition-opacity"
              >
                Open on block explorer ↗
              </a>
            ) : (
              <p className="text-[13px] text-[var(--vector-text-dim)] font-mono text-center leading-relaxed">
                Switch to a supported network (Arc Testnet, Base Sepolia, or
                Ethereum Sepolia) to open its explorer.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** One transaction row for the Circle-wallet list. */
function TxRow({ tx }: { tx: W3sTx }) {
  const label = txLabel(tx);
  const link = tx.txHash ? explorerTxUrl("Arc_Testnet", tx.txHash) : null;
  const when = relativeTime(tx.createDate);
  const badge = stateBadge(tx.state);
  // Only show an amount for plain transfers — a contract execution's amount
  // reflects native value (typically 0 on Arc), so showing it would mislead.
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

/** Human-friendly label from the tx's operation + direction. Honest, not guessy. */
function txLabel(tx: W3sTx): string {
  const type = tx.transactionType?.toUpperCase();
  const op = tx.operation?.toUpperCase();
  if (op === "TRANSFER") {
    if (type === "INBOUND") return "Received";
    if (type === "OUTBOUND") return "Sent";
    return "Transfer";
  }
  if (op === "CONTRACTEXECUTION") return "Contract execution";
  return "Transaction";
}

/** Small state badge: confirmed / failed / in-progress. */
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
  // INITIATED / QUEUED / SENT / PENDING_RISK_SCREENING / ACCELERATED …
  const pretty = s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
  return { text: pretty, className: "text-[var(--vector-text-dim)]" };
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" / a date for older. */
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
