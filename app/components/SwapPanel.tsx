"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { arcTestnet } from "viem/chains";
import { useAccount, useSwitchChain } from "wagmi";
import {
  estimateSwap,
  executeSwap,
  getProviderChainId,
  isPermitGenerationFailure,
  type Eip1193Provider,
  type SwapQuote,
  type SwapResult,
} from "../lib/appkit";
import { ARC_SWAP_TOKENS } from "../lib/swap-tokens";
import { useTokenBalance } from "./useTokenBalance";

/**
 * Arc Testnet's chain id (5042002), read from viem's own chain definition —
 * the same source `app/wagmi-config.ts` builds the config from, so there is no
 * second hand-typed copy of a money-critical number to drift out of sync.
 */
const ARC_CHAIN_ID = arcTestnet.id;

/**
 * Swap panel for external (injected) wallets on Arc Testnet.
 *
 * Uses the connected wallet's EIP-1193 provider (via wagmi's connector) with
 * Circle's App Kit browser-wallet adapter. Google-login (Circle) wallets take
 * a different, server-side adapter and are handled in a later phase — this
 * panel only renders when an external wallet is the active connection.
 *
 * The wallet has to be on Arc *before* a swap starts. Circle's adapter only
 * switches chains when it sends a transaction, but a swap asks for a permit
 * signature first, and a wallet won't sign for a chain it isn't on — which
 * surfaced as an opaque "Permit generation failed … Provided chainId 5042002
 * must match the active chainId 8453". So the chain is read from the provider
 * itself rather than from wagmi's view of it (the two can disagree when several
 * wallet extensions are installed), re-checked immediately before executing,
 * and the swap button is replaced by a switch prompt until it matches. Quoting
 * is read-only and keeps working throughout, so the rate stays visible while
 * the user switches.
 */
export function SwapPanel({ onClose }: { onClose: () => void }) {
  const {
    address,
    isConnected,
    connector,
    chainId: wagmiChainId,
  } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();

  const [tokenIn, setTokenIn] = useState("USDC");
  // EURC rather than cirBTC. Circle has no swap route for cirBTC on Arc today,
  // so defaulting to it meant the panel answered the very first amount anyone
  // typed with a red "no route" error — the app looked broken when it wasn't.
  // USDC↔EURC is the pair that actually quotes. cirBTC stays selectable, since
  // it is a real Arc asset and routes may appear later; it just isn't the first
  // thing a new user runs into.
  const [tokenOut, setTokenOut] = useState("EURC");
  const [amountIn, setAmountIn] = useState("");

  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  /** Whatever chain the wallet itself reports; null until it has answered. */
  const [walletChainId, setWalletChainId] = useState<number | null>(null);

  const balanceIn = useTokenBalance(tokenIn);
  const balanceOut = useTokenBalance(tokenOut);

  // Pull the raw EIP-1193 provider out of the active wagmi connector. This is
  // what App Kit's browser adapter wraps. `connector.getProvider()` is wagmi's
  // documented, stable way to get it (defined on the Connector type), so we
  // don't have to reach through undocumented client internals.
  const providerRef = useRef<Eip1193Provider | null>(null);

  /**
   * Re-ask the wallet which chain it is on. Returns the id as well as storing
   * it, so a caller can act on the answer without waiting for a re-render.
   */
  const refreshWalletChain = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider) return null;
    const id = await getProviderChainId(provider);
    setWalletChainId(id);
    return id;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function resolveProvider(): Promise<Eip1193Provider | null> {
      providerRef.current = null;
      try {
        if (connector?.getProvider) {
          const p = (await connector.getProvider()) as Eip1193Provider;
          if (!cancelled && p && typeof p.request === "function") {
            providerRef.current = p;
            return p;
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
          return injected;
        }
      } catch (err) {
        console.error("[Vector] failed to resolve wallet provider for swap:", err);
      }
      return null;
    }
    void (async () => {
      const provider = await resolveProvider();
      if (cancelled || !provider) return;
      // Ask the provider that will actually be signing. wagmiChainId is in the
      // dependency list only as a signal that something moved — the answer
      // itself always comes from the wallet.
      const id = await getProviderChainId(provider);
      if (!cancelled) setWalletChainId(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [connector, wagmiChainId]);

  const parsedAmount = useMemo(() => {
    const n = Number(amountIn);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountIn]);

  const sameToken = tokenIn === tokenOut;

  // Only claim the wallet is on the wrong chain once it has actually told us.
  // A null answer means "unknown", which is not the same as "wrong" — the
  // pre-flight check in handleSwap refuses to sign on an unknown chain anyway,
  // so an unreadable provider can't turn into a misleading prompt here.
  const needsChainSwitch =
    walletChainId !== null && walletChainId !== ARC_CHAIN_ID;

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

  async function handleSwitch() {
    setError(null);
    let switchError: unknown = null;
    try {
      // wagmi's injected connector asks the wallet to switch and, if the wallet
      // doesn't know Arc yet, offers to add it from viem's own chain definition
      // — so no RPC URL or chain id is hand-written into this prompt.
      await switchChainAsync({ chainId: ARC_CHAIN_ID });
    } catch (err) {
      switchError = err;
    }
    // Judge success by what the wallet now reports, not by whether the call
    // resolved. Some wallets resolve the request and stay put.
    const id = await refreshWalletChain();
    if (id === ARC_CHAIN_ID) return;
    if (switchError) {
      setError(
        readableError(
          switchError,
          "Couldn't switch networks. Switch to Arc Testnet in your wallet, then try again.",
        ),
      );
      return;
    }
    setError(
      "Your wallet still reports a different network. If you have more than one wallet extension enabled, switch networks in the one Vector is connected to.",
    );
  }

  async function handleSwap() {
    const provider = providerRef.current;
    if (!provider || !parsedAmount || sameToken) return;
    setSwapping(true);
    setError(null);
    setNotice(null);
    setTxHash(null);
    try {
      // A swap's first move is a signature bound to Arc, and a wallet on
      // another chain rejects it. Ask the wallet where it is right now — not
      // when the panel opened — and refuse rather than raise a request that
      // could only fail.
      const liveChainId = await getProviderChainId(provider);
      setWalletChainId(liveChainId);
      if (liveChainId !== ARC_CHAIN_ID) {
        setError(
          liveChainId === null
            ? "Couldn't confirm which network your wallet is on, so nothing was sent. Reconnect the wallet and try again."
            : `Your wallet is on chain ${liveChainId}, but swaps run on Arc Testnet (${ARC_CHAIN_ID}). Switch networks and try again — nothing was sent.`,
        );
        return;
      }

      const swapArgs = {
        provider,
        tokenIn,
        tokenOut,
        amountIn: String(parsedAmount),
      };

      let result: SwapResult;
      try {
        result = await executeSwap(swapArgs);
      } catch (err) {
        if (!isPermitGenerationFailure(err)) throw err;
        // The gasless permit couldn't be produced. The SDK skipped the on-chain
        // approval in expectation of that permit and says so explicitly, so
        // nothing was approved and nothing moved — this retry is still a first
        // attempt at the swap, not a second. Cost of the fallback: one extra
        // confirmation and a little gas.
        console.warn(
          "[Vector] permit path failed, retrying with an on-chain approval:",
          err,
        );
        setNotice(
          "Your wallet couldn't produce the gasless approval, so Vector is retrying with a standard on-chain approval. Expect one extra confirmation.",
        );
        result = await executeSwap({
          ...swapArgs,
          allowanceStrategy: "approve",
        });
      }

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

        {/* Tied to the attempt it describes: once a new quote clears the tx
            link, this note goes with it rather than lingering over a fresh
            swap it no longer applies to. */}
        {notice && (swapping || txHash) && (
          <p className="text-[12px] text-[var(--vector-text-dim)] font-mono mb-4 leading-relaxed">
            {notice}
          </p>
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

        {needsChainSwitch ? (
          <div>
            <p className="text-[12px] text-[var(--vector-text-dim)] leading-relaxed mb-3 text-center">
              Swaps run on Arc Testnet, and your wallet is on{" "}
              <span className="font-mono">chain {walletChainId}</span>. Switch
              networks to continue — nothing has been sent.
            </p>
            <button
              onClick={handleSwitch}
              disabled={switching}
              className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
            >
              {switching ? "Switching…" : "Switch to Arc Testnet"}
            </button>
          </div>
        ) : (
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
        )}

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
    // The wallet refused to sign because it is sitting on a different chain
    // than the swap. This arrives wrapped inside a permit-generation error, so
    // it has to be matched before the permit branch below — otherwise the one
    // actionable detail gets buried under a vaguer message.
    if (
      /must match the active chain|does not match the target chain|chain mismatch/i.test(
        err.message,
      )
    ) {
      return "Your wallet is on a different network than Arc Testnet, so it wouldn't sign. Switch to Arc Testnet and try again — nothing was sent.";
    }
    // A permit failure that survived the automatic on-chain-approval retry.
    if (/permit generation/i.test(err.message)) {
      return "Your wallet couldn't approve this swap, so nothing was sent. Reconnect the wallet and try again.";
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
