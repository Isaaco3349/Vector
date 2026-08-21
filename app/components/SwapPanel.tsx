"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import {
  estimateSwap,
  executeSwap,
  type Eip1193Provider,
  type SwapQuote,
} from "../lib/appkit";
import { ARC_SWAP_TOKENS } from "../lib/swap-tokens";
import { useTokenBalance } from "./useTokenBalance";

/**
 * Swap panel for external (injected) wallets on Arc Testnet.
 *
 * Uses the connected wallet's EIP-1193 provider (via wagmi's connector) with
 * Circle's App Kit browser-wallet adapter. Google-login (Circle) wallets take
 * a different, server-side adapter and are handled in a later phase — this
 * panel only renders when an external wallet is the active connection.
 */
export function SwapPanel({ onClose }: { onClose: () => void }) {
  const { address, isConnected, connector } = useAccount();

  const [tokenIn, setTokenIn] = useState("USDC");
  const [tokenOut, setTokenOut] = useState("cirBTC");
  const [amountIn, setAmountIn] = useState("");

  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const balanceIn = useTokenBalance(tokenIn);
  const balanceOut = useTokenBalance(tokenOut);

  // Pull the raw EIP-1193 provider out of the active wagmi connector. This is
  // what App Kit's browser adapter wraps. `connector.getProvider()` is wagmi's
  // documented, stable way to get it (defined on the Connector type), so we
  // don't have to reach through undocumented client internals.
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
        // Fallback: window.ethereum (single-wallet browsers where the
        // connector somehow can't hand back a provider).
        const injected =
          typeof window !== "undefined"
            ? (window as unknown as { ethereum?: Eip1193Provider }).ethereum
            : undefined;
        if (!cancelled && injected && typeof injected.request === "function") {
          providerRef.current = injected;
        }
      } catch (err) {
        console.error("[Vector] failed to resolve wallet provider for swap:", err);
      }
    }
    void resolveProvider();
    return () => {
      cancelled = true;
    };
  }, [connector]);

  const parsedAmount = useMemo(() => {
    const n = Number(amountIn);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountIn]);

  const sameToken = tokenIn === tokenOut;

  // Debounced quoting whenever the inputs settle.
  useEffect(() => {
    setTxHash(null);
    if (!parsedAmount || sameToken) {
      setQuote(null);
      setError(sameToken ? "Choose two different tokens." : null);
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
        const q = await estimateSwap({
          provider,
          tokenIn,
          tokenOut,
          amountIn: String(parsedAmount),
        });
        if (!cancelled) setQuote(q);
      } catch (err) {
        if (!cancelled) {
          setQuote(null);
          setError(readableError(err, "Couldn't get a quote for this pair."));
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [parsedAmount, tokenIn, tokenOut, sameToken]);

  async function handleSwap() {
    const provider = providerRef.current;
    if (!provider || !parsedAmount || sameToken) return;
    setSwapping(true);
    setError(null);
    setTxHash(null);
    try {
      const result = await executeSwap({
        provider,
        tokenIn,
        tokenOut,
        amountIn: String(parsedAmount),
      });
      setTxHash(result.txHash);
      if (!result.txHash) {
        // Swap returned but no recognisable hash — surface honestly rather
        // than claim success.
        setError(
          "Swap submitted, but no transaction hash was returned. Check your wallet activity to confirm.",
        );
      }
    } catch (err) {
      setError(readableError(err, "Swap failed. No funds were moved if it was rejected."));
    } finally {
      setSwapping(false);
    }
  }

  function flip() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
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
          <span className="text-[17px] font-semibold">Swap</span>
          <button
            onClick={onClose}
            className="text-[var(--vector-text-dim)] text-[13px] hover:text-[var(--vector-text)]"
          >
            Close
          </button>
        </div>

        {/* From */}
        <div className="rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4 mb-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] text-[var(--vector-text-dim)]">You pay</span>
            <TokenSelect value={tokenIn} onChange={setTokenIn} />
          </div>
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value.replace(/[^0-9.]/g, ""))}
            className="w-full bg-transparent text-[28px] font-semibold outline-none placeholder:text-[var(--vector-line)]"
          />
          <BalanceRow
            label="Balance"
            balance={balanceIn.formatted}
            isLoading={balanceIn.isLoading}
            symbol={tokenIn}
            onMax={
              balanceIn.formatted
                ? () => setAmountIn(balanceIn.formatted as string)
                : undefined
            }
          />
        </div>

        {/* Flip */}
        <div className="flex justify-center -my-2 relative z-10">
          <button
            onClick={flip}
            className="w-9 h-9 rounded-full border border-[var(--vector-line)] bg-[var(--vector-surface)] flex items-center justify-center hover:border-[var(--vector-pink)] transition-colors"
            aria-label="Flip tokens"
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

        {/* To */}
        <div className="rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4 mt-1 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] text-[var(--vector-text-dim)]">
              You receive (estimated)
            </span>
            <TokenSelect value={tokenOut} onChange={setTokenOut} />
          </div>
          <div className="text-[28px] font-semibold text-[var(--vector-text)]">
            {quoting ? (
              <span className="text-[var(--vector-text-dim)] text-[20px]">Quoting…</span>
            ) : quote?.amountOut ? (
              quote.amountOut
            ) : (
              <span className="text-[var(--vector-line)]">0.00</span>
            )}
          </div>
          <BalanceRow
            label="Balance"
            balance={balanceOut.formatted}
            isLoading={balanceOut.isLoading}
            symbol={tokenOut}
          />
        </div>

        {/* Quote detail */}
        {quote && (quote.rate || quote.feeText) && (
          <div className="text-[12px] text-[var(--vector-text-dim)] font-mono mb-4 space-y-1">
            {quote.rate && <div>Rate: {quote.rate}</div>}
            {quote.feeText && <div>Fee: {quote.feeText}</div>}
          </div>
        )}

        {error && (
          <p className="text-[13px] text-[var(--vector-pink)] font-mono mb-4">{error}</p>
        )}

        {txHash && (
          <a
            href={`https://testnet.arcscan.app/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[13px] text-[var(--vector-pink)] font-mono mb-4 underline break-all"
          >
            Swap sent — view on ArcScan ↗
          </a>
        )}

        <button
          onClick={handleSwap}
          disabled={swapping || quoting || !quote?.amountOut || sameToken || !parsedAmount}
          className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
        >
          {swapping
            ? "Swapping…"
            : quoting
              ? "Getting quote…"
              : `Swap ${tokenIn} → ${tokenOut}`}
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-[var(--vector-text-dim)] text-center">
          Swaps run on Arc Testnet through Circle&apos;s App Kit. Estimated
          output can move slightly before the transaction confirms.
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

function TokenSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-[var(--vector-surface)] border border-[var(--vector-line)] rounded-full px-3 py-1.5 text-[13px] font-semibold text-[var(--vector-text)] outline-none hover:border-[var(--vector-pink)] transition-colors cursor-pointer"
    >
      {ARC_SWAP_TOKENS.map((t) => (
        <option key={t.symbol} value={t.symbol} className="bg-[var(--vector-surface)]">
          {t.symbol}
        </option>
      ))}
    </select>
  );
}

function readableError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    // User-rejected wallet actions come back as noisy provider errors — soften.
    if (/reject|denied|user cancel/i.test(err.message)) {
      return "You cancelled the request in your wallet.";
    }
    // "No route available" is App Kit's own string when Circle has no swap
    // route/liquidity for the pair on this chain. Explain it honestly rather
    // than leaking the raw SDK string — it's not a bug in the wallet or app.
    if (/no route|route.*(available|found)|no.*liquidity/i.test(err.message)) {
      return "No swap route for this pair on Arc Testnet yet. Swap routes depend on Circle-provided liquidity, which isn't available for this pair right now — try again later.";
    }
    return err.message;
  }
  if (typeof err === "string") return err;
  return fallback;
}
