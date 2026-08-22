"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { arcTestnet } from "viem/chains";
import { useAccount, useSwitchChain } from "wagmi";
import {
  classifySwapError,
  estimateSwap,
  executeSwap,
  getProviderChainId,
  isPermitGenerationFailure,
  DEFAULT_SLIPPAGE_BPS,
  type Eip1193Provider,
  type SwapErrorInfo,
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
 * Looser slippage tolerances offered — only ever after Circle has said the
 * slippage constraint is what blocked the swap, and only on an explicit tap.
 * A wider tolerance means accepting a worse price, so it is the user's call.
 */
const SLIPPAGE_STEPS_BPS = [500, 1000] as const;

/**
 * Pairs Circle has reported as *fatally* unroutable during this page session.
 *
 * Module-level rather than component state so it survives closing and reopening
 * the panel. It only ever records what the SDK itself marked FATAL — never a
 * guess, never a timeout or a liquidity dip, both of which can clear on their
 * own. A page reload forgets it, which is the right default: if Circle enables
 * a route tomorrow, nothing here keeps it hidden.
 */
const sessionUnroutablePairs = new Set<string>();

/**
 * Pairs Circle has actually returned a quote for during this page session.
 *
 * This exists so the panel can only ever recommend a route it has personally
 * watched work. The earlier copy named "USDC ↔ EURC" as a pair Circle supports,
 * which was an assumption — nobody had seen it quote. If EURC turned out to be
 * unroutable too, that message would have walked people from one dead pair
 * straight into another while sounding authoritative about it.
 */
const sessionQuotedPairs = new Set<string>();

const pairKey = (tokenIn: string, tokenOut: string) => `${tokenIn}->${tokenOut}`;

/**
 * A pair that has quoted this session, other than the one that just failed,
 * formatted for display. Returns null when there isn't one — in which case the
 * honest thing is to say so rather than to invent a suggestion.
 */
function provenPairOtherThan(failedKey: string): string | null {
  for (const key of sessionQuotedPairs) {
    if (key === failedKey) continue;
    const [from, to] = key.split("->");
    if (from && to) return `${from} → ${to}`;
  }
  return null;
}

const formatBps = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

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
 *
 * Failures are reported from Circle's own structured error codes rather than by
 * pattern-matching its prose. That distinction is not cosmetic: an unsupported
 * route is permanent, a slippage constraint is fixable with a looser tolerance,
 * and thin liquidity is fixable with a smaller size or more time — yet all
 * three can arrive carrying the words "no route". Guessing between them meant
 * telling people to "try again later" for a pair that will never route, and
 * hiding the one setting that would have worked.
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
  // USDC → EURC. cirBTC used to be the default and used to be selectable, but
  // Circle has since answered for it: USDC → cirBTC is INPUT_UNSUPPORTED_ROUTE
  // (1003), FATAL, so it is no longer offered at all (see swap-tokens.ts). EURC
  // is the remaining first-party Arc asset — note that its route has not been
  // observed to quote either, so this default is the best available option
  // rather than a proven one.
  const [tokenOut, setTokenOut] = useState("EURC");
  const [amountIn, setAmountIn] = useState("");

  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  /**
   * Message and Circle's own classification, held together in one piece of
   * state so the UI can show the reason, the SDK's verbatim detail, and the
   * right remedy without them ever disagreeing with each other.
   */
  const [errorState, setErrorState] = useState<{
    text: string;
    info: SwapErrorInfo | null;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  /** Whatever chain the wallet itself reports; null until it has answered. */
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  /**
   * Slippage tolerance in basis points. null means "don't send one" — Circle's
   * documented 3% default applies. Only ever raised by an explicit tap, and
   * reset whenever the pair changes so a looser tolerance can't quietly carry
   * over to a different trade.
   */
  const [slippageBps, setSlippageBps] = useState<number | null>(null);
  /** Snapshot of the session's fatally-unroutable pairs, for rendering. */
  const [unroutable, setUnroutable] = useState<ReadonlySet<string>>(
    () => new Set(sessionUnroutablePairs),
  );

  const error = errorState?.text ?? null;
  const errorInfo = errorState?.info ?? null;
  const effectiveSlippageBps = slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  /** The next looser tolerance on offer, or null once the ladder runs out. */
  const nextSlippageBps =
    SLIPPAGE_STEPS_BPS.find((bps) => bps > effectiveSlippageBps) ?? null;
  const pairIsUnroutable = unroutable.has(pairKey(tokenIn, tokenOut));

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

  /**
   * Changing either side of the pair resets the slippage tolerance. A tolerance
   * the user accepted for one trade is not consent for the next one, and
   * carrying it over silently would widen the price they accept without asking.
   */
  function changeTokenIn(next: string) {
    setTokenIn(next);
    setSlippageBps(null);
  }

  function changeTokenOut(next: string) {
    setTokenOut(next);
    setSlippageBps(null);
  }

  /**
   * Remember a pair Circle marked FATAL, so nobody types into it twice.
   * Stable identity (no deps) so the quoting effect can depend on it without
   * re-running on every render.
   */
  const recordUnroutablePair = useCallback((from: string, to: string) => {
    sessionUnroutablePairs.add(pairKey(from, to));
    setUnroutable(new Set(sessionUnroutablePairs));
  }, []);

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
      setErrorState(
        sameToken ? { text: "Choose two different tokens.", info: null } : null,
      );
      return;
    }
    const provider = providerRef.current;
    if (!provider) {
      setErrorState({
        text: "No wallet provider available. Reconnect your wallet and try again.",
        info: null,
      });
      return;
    }

    let cancelled = false;
    setQuoting(true);
    setErrorState(null);
    const handle = setTimeout(async () => {
      try {
        const q = await estimateSwap({
          provider,
          tokenIn,
          tokenOut,
          amountIn: String(parsedAmount),
          ...(slippageBps !== null ? { slippageBps } : {}),
        });
        if (!cancelled) {
          setQuote(q);
          // Circle priced this pair, which is the only evidence that counts as
          // "this route works". Recorded so a later failure can point at it by
          // name instead of guessing which pair to recommend.
          sessionQuotedPairs.add(pairKey(tokenIn, tokenOut));
        }
      } catch (err) {
        if (!cancelled) {
          setQuote(null);
          const described = describeSwapError(err, "Couldn't get a quote for this pair.", {
            tokenIn,
            tokenOut,
            slippageBps: slippageBps ?? DEFAULT_SLIPPAGE_BPS,
          });
          setErrorState(described);
          // Only a FATAL unsupported route is remembered. Everything else —
          // slippage, thin liquidity, a timeout — can clear on its own, and
          // marking the pair for those would be us inventing a verdict Circle
          // didn't give.
          if (described.info?.kind === "unsupported-route") {
            recordUnroutablePair(tokenIn, tokenOut);
          }
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [parsedAmount, tokenIn, tokenOut, sameToken, slippageBps, recordUnroutablePair]);

  async function handleSwitch() {
    setErrorState(null);
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
      setErrorState(
        describeSwapError(
          switchError,
          "Couldn't switch networks. Switch to Arc Testnet in your wallet, then try again.",
          { tokenIn, tokenOut, slippageBps: effectiveSlippageBps },
        ),
      );
      return;
    }
    setErrorState({
      text: "Your wallet still reports a different network. If you have more than one wallet extension enabled, switch networks in the one Vector is connected to.",
      info: null,
    });
  }

  async function handleSwap() {
    const provider = providerRef.current;
    if (!provider || !parsedAmount || sameToken) return;
    setSwapping(true);
    setErrorState(null);
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
        setErrorState({
          text:
            liveChainId === null
              ? "Couldn't confirm which network your wallet is on, so nothing was sent. Reconnect the wallet and try again."
              : `Your wallet is on chain ${liveChainId}, but swaps run on Arc Testnet (${ARC_CHAIN_ID}). Switch networks and try again — nothing was sent.`,
          info: null,
        });
        return;
      }

      const swapArgs = {
        provider,
        tokenIn,
        tokenOut,
        amountIn: String(parsedAmount),
        // Only sent when the user has explicitly accepted a looser tolerance;
        // otherwise Circle's own 3% default applies. The quote above was fetched
        // with the same value, so what was shown is what gets executed.
        ...(slippageBps !== null ? { slippageBps } : {}),
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
        setErrorState({
          text: "Swap submitted, but no transaction hash was returned. Check your wallet activity to confirm.",
          info: null,
        });
      }
    } catch (err) {
      const described = describeSwapError(
        err,
        "Swap failed. No funds were moved if it was rejected.",
        { tokenIn, tokenOut, slippageBps: effectiveSlippageBps },
      );
      setErrorState(described);
      if (described.info?.kind === "unsupported-route") {
        recordUnroutablePair(tokenIn, tokenOut);
      }
    } finally {
      setSwapping(false);
    }
  }

  function flip() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setQuote(null);
    setSlippageBps(null);
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
            <TokenSelect
              value={tokenIn}
              onChange={changeTokenIn}
              noteFor={(symbol) =>
                unroutable.has(pairKey(symbol, tokenOut)) ? "no route" : null
              }
            />
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
            <TokenSelect
              value={tokenOut}
              onChange={changeTokenOut}
              noteFor={(symbol) =>
                unroutable.has(pairKey(tokenIn, symbol)) ? "no route" : null
              }
            />
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
            {slippageBps !== null && (
              <div>Slippage tolerance: {formatBps(slippageBps)} (you raised this)</div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4">
            <p className="text-[13px] text-[var(--vector-pink)] font-mono">{error}</p>
            {/* Circle's own words and error code, kept visible. Paraphrasing
                alone is how a wrong diagnosis goes unnoticed for weeks; with the
                code on screen, the next report is one line instead of a guess. */}
            {errorInfo?.detail && errorInfo.kind !== "user-cancelled" && (
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--vector-text-dim)] font-mono break-words">
                Circle reported: {errorInfo.detail}
                {errorInfo.name && (
                  <>
                    {" ["}
                    {errorInfo.name}
                    {errorInfo.code !== null ? ` ${errorInfo.code}` : ""}
                    {errorInfo.recoverability ? `, ${errorInfo.recoverability}` : ""}
                    {"]"}
                  </>
                )}
              </p>
            )}
            {/* The one case with a real remedy: Circle could price the trade but
                not inside the tolerance. Offered, never applied automatically —
                a looser tolerance is a worse price, so it needs a deliberate tap. */}
            {errorInfo?.kind === "slippage" && nextSlippageBps !== null && (
              <button
                onClick={() => setSlippageBps(nextSlippageBps)}
                disabled={quoting || swapping}
                className="mt-3 w-full h-[44px] rounded-full border border-[var(--vector-line)] text-[13px] font-semibold text-[var(--vector-text)] transition-colors hover:border-[var(--vector-pink)] disabled:opacity-40"
              >
                Retry with {formatBps(nextSlippageBps)} slippage tolerance
              </button>
            )}
            {errorInfo?.kind === "slippage" && nextSlippageBps === null && (
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--vector-text-dim)]">
                Already at {formatBps(effectiveSlippageBps)} — Vector won&apos;t
                widen it further. Try a smaller amount instead.
              </p>
            )}
          </div>
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

        {/* Said up front, before an amount is typed, once Circle has told us
            this pair is fatally unroutable. Cheaper than letting someone
            discover it a third time. No "pick another pair" instruction: with a
            short token list there may not be another one, and telling someone to
            do something impossible is worse than telling them nothing. */}
        {pairIsUnroutable && !error && (
          <p className="text-[12px] text-[var(--vector-text-dim)] font-mono mb-4 leading-relaxed">
            Circle has no route for {tokenIn} → {tokenOut} on Arc Testnet — it
            reported this as permanent, not a temporary shortage.
          </p>
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
  noteFor,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Optional short suffix per symbol, e.g. "no route". */
  noteFor?: (symbol: string) => string | null;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-[var(--vector-surface)] border border-[var(--vector-line)] rounded-full px-3 py-1.5 text-[13px] font-semibold text-[var(--vector-text)] outline-none hover:border-[var(--vector-pink)] transition-colors cursor-pointer"
    >
      {ARC_SWAP_TOKENS.map((t) => {
        const note = noteFor?.(t.symbol) ?? null;
        return (
          <option
            key={t.symbol}
            value={t.symbol}
            className="bg-[var(--vector-surface)]"
          >
            {note ? `${t.symbol} — ${note}` : t.symbol}
          </option>
        );
      })}
    </select>
  );
}

/**
 * Turn a failure into something a person can act on, using Circle's own
 * classification rather than a guess at what its prose meant.
 *
 * Returns the classification alongside the text so the caller can react to it —
 * offer the slippage remedy, or remember a fatally unroutable pair — without
 * re-deriving the same conclusion from the string it just produced.
 */
function describeSwapError(
  err: unknown,
  fallback: string,
  ctx: { tokenIn: string; tokenOut: string; slippageBps: number },
): { text: string; info: SwapErrorInfo } {
  const info = classifySwapError(err);
  const pair = `${ctx.tokenIn} → ${ctx.tokenOut}`;

  const text = ((): string => {
    switch (info.kind) {
      case "user-cancelled":
        return "You cancelled the request in your wallet.";

      case "chain-mismatch":
        return "Your wallet is on a different network than Arc Testnet, so it wouldn't sign. Switch to Arc Testnet and try again — nothing was sent.";

      case "permit-generation":
        return "Your wallet couldn't approve this swap, so nothing was sent. Reconnect the wallet and try again.";

      case "unsupported-route": {
        // The SDK marks this FATAL, so "try again later" would be false
        // comfort — this pair does not route, full stop. What we must not do is
        // replace one guess with another: only a pair Circle has actually quoted
        // in this session gets named as an alternative.
        const base = `Circle doesn't route ${pair} on Arc Testnet. It reported this as permanent rather than a temporary shortage, so retrying won't help.`;
        const proven = provenPairOtherThan(pairKey(ctx.tokenIn, ctx.tokenOut));
        return proven
          ? `${base} ${proven} quoted successfully earlier in this session — try that instead.`
          : `${base} No pair has quoted successfully here yet either, so there isn't one Vector can honestly point you to.`;
      }

      case "unsupported-token":
        return `Circle's swap service doesn't support one of these tokens on Arc Testnet yet, so ${pair} can't be quoted. Nothing was sent.`;

      case "slippage":
        // Circle *could* price this trade — it just couldn't hit the minimum
        // output implied by the tolerance. That is the one failure here with a
        // real remedy, so name it precisely instead of blaming liquidity.
        return `Circle could price ${pair} but not within the ${formatBps(ctx.slippageBps)} slippage tolerance. Nothing was sent. A looser tolerance or a smaller amount would likely go through.`;

      case "insufficient-liquidity":
        return `Circle's liquidity for ${pair} is too thin for this amount right now. Nothing was sent — a smaller amount may work, and this one can clear on its own later.`;

      case "amount-out-of-range": {
        const bounds: string[] = [];
        if (info.minAmount) {
          bounds.push(`minimum ${info.minAmount}${info.amountToken ? ` ${info.amountToken}` : ""}`);
        }
        if (info.maxAmount) {
          bounds.push(`maximum ${info.maxAmount}${info.amountToken ? ` ${info.amountToken}` : ""}`);
        }
        return bounds.length > 0
          ? `That amount is outside Circle's accepted range for ${pair} (${bounds.join(", ")}). Nothing was sent.`
          : `That amount is outside Circle's accepted range for ${pair}. Nothing was sent — try a different size.`;
      }

      case "rate-limited":
        return "Too many requests to Circle's swap service. Wait a moment and try again — nothing was sent.";

      case "network":
        return "Couldn't reach Circle's swap service. Check your connection and try again — nothing was sent.";

      case "service":
        return "Circle's swap service hit an internal error. Nothing was sent — try again shortly.";

      case "unknown":
      default:
        return info.detail ?? fallback;
    }
  })();

  return { text, info };
}
