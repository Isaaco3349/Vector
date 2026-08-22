"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import {
  estimateBridge,
  executeBridge,
  type BridgeQuote,
  type Eip1193Provider,
} from "../lib/bridge";
import {
  BRIDGE_CHAINS,
  explorerAddressUrl,
  type BridgeChainId,
} from "../lib/bridge-chains";
import { useBridgeBalance } from "./useBridgeBalance";

/**
 * Bridge panel (CCTP v2) for external (injected) wallets.
 *
 * Moves USDC cross-chain between Arc Testnet, Base Sepolia, and Ethereum
 * Sepolia via Circle's App Kit. Uses `useForwarder: true`, so the wallet only
 * signs the burn on the source chain — Circle's relayer handles the mint, and
 * the wallet never has to switch networks mid-flow.
 *
 * Mirrors SwapPanel: same modal shell, debounced quoting, honest error/tx
 * surfacing. Only renders when an external wallet is the active connection
 * (Google-login wallets take a different, server-side adapter — a later phase).
 */
export function BridgePanel({ onClose }: { onClose: () => void }) {
  const { address, isConnected, connector } = useAccount();

  const [fromChain, setFromChain] = useState<BridgeChainId>("Arc_Testnet");
  const [toChain, setToChain] = useState<BridgeChainId>("Base_Sepolia");
  const [amount, setAmount] = useState("");

  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [bridging, setBridging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txUrl, setTxUrl] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const [activityUrl, setActivityUrl] = useState<string | null>(null);

  const balanceFrom = useBridgeBalance(fromChain);

  // Same provider-resolution approach as SwapPanel: pull the raw EIP-1193
  // provider from the active wagmi connector (its documented getProvider()),
  // falling back to window.ethereum.
  const providerRef = useRef<Eip1193Provider | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function resolveProvider() {
      providerRef.current = null;
      try {
        if (connector?.getProvider) {
          const p = (await connector.getProvider()) as Eip1193Provider;
          if (!cancelled && p && typeof p.request === "function") {
            providerRef.current = p;
            return;
          }
        }
        const injected =
          typeof window !== "undefined"
            ? (window as unknown as { ethereum?: Eip1193Provider }).ethereum
            : undefined;
        if (!cancelled && injected && typeof injected.request === "function") {
          providerRef.current = injected;
        }
      } catch (err) {
        console.error("[Vector] failed to resolve wallet provider for bridge:", err);
      }
    }
    void resolveProvider();
    return () => {
      cancelled = true;
    };
  }, [connector]);

  const parsedAmount = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const sameChain = fromChain === toChain;

  const insufficient = useMemo(() => {
    if (!parsedAmount || balanceFrom.formatted === null) return false;
    return parsedAmount > Number(balanceFrom.formatted);
  }, [parsedAmount, balanceFrom.formatted]);

  // Debounced quoting whenever inputs settle.
  useEffect(() => {
    setTxHash(null);
    setTxUrl(null);
    setPendingNote(null);
    setActivityUrl(null);
    if (sameChain) {
      setQuote(null);
      setError("Choose two different chains.");
      return;
    }
    if (!parsedAmount) {
      setQuote(null);
      setError(null);
      return;
    }
    if (insufficient) {
      setQuote(null);
      setError("Amount exceeds your USDC balance on the source chain.");
      return;
    }
    const provider = providerRef.current;
    if (!provider) {
      setError("No wallet provider available. Reconnect your wallet and try again.");
      return;
    }

    let cancelled = false;
    setQuoting(true);
    setError(null);
    const handle = setTimeout(async () => {
      try {
        const q = await estimateBridge({
          provider,
          fromChain,
          toChain,
          amount: String(parsedAmount),
        });
        if (!cancelled) setQuote(q);
      } catch (err) {
        if (!cancelled) {
          setQuote(null);
          setError(readableError(err, "Couldn't estimate this bridge route."));
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [parsedAmount, fromChain, toChain, sameChain, insufficient]);

  async function handleBridge() {
    const provider = providerRef.current;
    if (!provider || !parsedAmount || sameChain || insufficient) return;
    setBridging(true);
    setError(null);
    setTxHash(null);
    setTxUrl(null);
    setPendingNote(null);
    setActivityUrl(null);
    try {
      const result = await executeBridge({
        provider,
        fromChain,
        toChain,
        amount: String(parsedAmount),
      });
      setTxHash(result.txHash);
      setTxUrl(result.explorerUrl);
      if (result.state === "error") {
        // Circle explicitly reported failure — this is a real error.
        setError(
          "Circle reported the bridge didn't go through. No funds were moved — please try again.",
        );
      } else if (!result.txHash) {
        // bridge() resolved without error, so the burn was submitted — the SDK
        // just hasn't handed back a source hash yet. That is NOT a failure, so
        // show a calm note (not an alarming red error) and point at the wallet's
        // activity on the source chain, matching the Google wallet's UX.
        setPendingNote(
          "Bridge submitted. Circle is still finalizing the source transaction — it'll show in your wallet activity shortly, and the destination mint follows within a few minutes.",
        );
        if (address) setActivityUrl(explorerAddressUrl(fromChain, address));
      } else if (result.state !== "success") {
        // Burn is on-chain; the destination mint (via the relayer) can still be
        // in flight. Say so honestly rather than implying instant completion.
        setPendingNote(
          "Burn confirmed on the source chain. The destination mint is handled by Circle's relayer and usually lands within a few minutes.",
        );
      }
    } catch (err) {
      setError(
        readableError(err, "Bridge failed. No funds were moved if it was rejected."),
      );
    } finally {
      setBridging(false);
    }
  }

  function flip() {
    setFromChain(toChain);
    setToChain(fromChain);
    setQuote(null);
  }

  if (!isConnected || !address) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-t-3xl sm:rounded-3xl border border-[var(--vector-line)] bg-[var(--vector-surface)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <span className="text-[17px] font-semibold">Bridge USDC</span>
          <button
            onClick={onClose}
            className="text-[var(--vector-text-dim)] text-[13px] hover:text-[var(--vector-text)]"
          >
            Close
          </button>
        </div>

        {/* From chain + amount */}
        <div className="rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4 mb-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] text-[var(--vector-text-dim)]">From</span>
            <ChainSelect value={fromChain} onChange={setFromChain} />
          </div>
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="w-full bg-transparent text-[28px] font-semibold outline-none placeholder:text-[var(--vector-line)]"
          />
          <BalanceRow
            label="Balance"
            balance={balanceFrom.formatted}
            isLoading={balanceFrom.isLoading}
            symbol="USDC"
            onMax={
              balanceFrom.formatted
                ? () => setAmount(balanceFrom.formatted as string)
                : undefined
            }
          />
        </div>

        {/* Flip */}
        <div className="flex justify-center -my-2 relative z-10">
          <button
            onClick={flip}
            className="w-9 h-9 rounded-full border border-[var(--vector-line)] bg-[var(--vector-surface)] flex items-center justify-center hover:border-[var(--vector-pink)] transition-colors"
            aria-label="Flip chains"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M4 2v10M4 12l-2-2M4 12l2-2M10 12V2M10 2l-2 2M10 2l2 2"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* To chain */}
        <div className="rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4 mt-1 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] text-[var(--vector-text-dim)]">To</span>
            <ChainSelect value={toChain} onChange={setToChain} />
          </div>
          <div className="text-[28px] font-semibold text-[var(--vector-text)]">
            {quoting ? (
              <span className="text-[var(--vector-text-dim)] text-[20px]">
                Estimating…
              </span>
            ) : quote?.amount ? (
              quote.amount
            ) : (
              <span className="text-[var(--vector-line)]">0.00</span>
            )}{" "}
            <span className="text-[16px] text-[var(--vector-text-dim)] font-mono">
              USDC
            </span>
          </div>
          <p className="mt-2 text-[11px] text-[var(--vector-text-dim)] font-mono">
            Received on {chainLabel(toChain)}
          </p>
        </div>

        {/* Quote detail */}
        {quote && (quote.feeText || quote.gasText) && (
          <div className="text-[12px] text-[var(--vector-text-dim)] font-mono mb-4 space-y-1">
            {quote.feeText && <div>Fee: {quote.feeText}</div>}
            {quote.gasText && <div>Source gas: {quote.gasText}</div>}
          </div>
        )}

        {error && (
          <p className="text-[13px] text-[var(--vector-pink)] font-mono mb-4">{error}</p>
        )}

        {pendingNote && (
          <p className="text-[12px] text-[var(--vector-text-dim)] font-mono mb-4 leading-relaxed">
            {pendingNote}
          </p>
        )}

        {activityUrl && (
          <a
            href={activityUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[13px] text-[var(--vector-pink)] font-mono mb-4 underline break-all"
          >
            View your wallet on the {chainLabel(fromChain)} explorer ↗
          </a>
        )}

        {txHash && txUrl && (
          <a
            href={txUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[13px] text-[var(--vector-pink)] font-mono mb-4 underline break-all"
          >
            Burn sent — view on explorer ↗
          </a>
        )}

        <button
          onClick={handleBridge}
          disabled={
            bridging ||
            quoting ||
            !quote?.amount ||
            sameChain ||
            !parsedAmount ||
            insufficient
          }
          className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
        >
          {bridging
            ? "Bridging…"
            : quoting
              ? "Estimating…"
              : `Bridge to ${chainLabel(toChain)}`}
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-[var(--vector-text-dim)] text-center">
          Bridges USDC across chains via Circle&apos;s CCTP. You sign the burn on
          the source chain; Circle&apos;s relayer completes the mint on the
          destination — no network switch needed.
        </p>
      </div>
    </div>
  );
}

function BalanceRow({
  label,
  balance,
  isLoading,
  symbol,
  onMax,
}: {
  label: string;
  balance: string | null;
  isLoading: boolean;
  symbol: string;
  onMax?: () => void;
}) {
  return (
    <div className="flex items-center justify-between mt-2 text-[11px] text-[var(--vector-text-dim)] font-mono">
      <span>
        {isLoading
          ? `${label}: …`
          : balance !== null
            ? `${label}: ${balance} ${symbol}`
            : `${label}: —`}
      </span>
      {onMax && balance !== null && Number(balance) > 0 && (
        <button
          onClick={onMax}
          className="text-[var(--vector-pink)] hover:opacity-80 transition-opacity uppercase tracking-wide"
        >
          Max
        </button>
      )}
    </div>
  );
}

function ChainSelect({
  value,
  onChange,
}: {
  value: BridgeChainId;
  onChange: (v: BridgeChainId) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BridgeChainId)}
      className="bg-[var(--vector-surface)] border border-[var(--vector-line)] rounded-full px-3 py-1.5 text-[13px] font-semibold text-[var(--vector-text)] outline-none hover:border-[var(--vector-pink)] transition-colors cursor-pointer"
    >
      {BRIDGE_CHAINS.map((c) => (
        <option
          key={c.appKitChain}
          value={c.appKitChain}
          className="bg-[var(--vector-surface)]"
        >
          {c.label}
        </option>
      ))}
    </select>
  );
}

function chainLabel(id: BridgeChainId): string {
  return BRIDGE_CHAINS.find((c) => c.appKitChain === id)?.label ?? id;
}

function readableError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    if (/reject|denied|user cancel/i.test(err.message)) {
      return "You cancelled the request in your wallet.";
    }
    if (/insufficient/i.test(err.message)) {
      return "Insufficient balance for this bridge (amount plus fees).";
    }
    if (/forwarder|relayer/i.test(err.message)) {
      return "Circle's forwarder is unavailable for this route right now. Try again shortly.";
    }
    return err.message;
  }
  if (typeof err === "string") return err;
  return fallback;
}
