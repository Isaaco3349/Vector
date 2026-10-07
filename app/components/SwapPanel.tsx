"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useSwitchChain } from "wagmi";
import {
  refreshBalancesAfterTx,
  scheduleBalancePoll,
} from "../lib/balance-refresh";
import {
  arcExplorerTxUrl,
  chainId as ARC_CHAIN_ID,
  displayName as ARC_DISPLAY_NAME,
} from "../lib/network";
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
import { ensureArcNetwork } from "../lib/arc-wallet";
import { formatVectorFeeLabel } from "../lib/fees";
import { errorTextBlob, isEmptyErrorDetail } from "../lib/wallet-errors";
import { TxSuccessCard } from "./TxSuccessCard";
import { executeSwapPlan } from "../lib/external-swap";
import { buildSwapPlan, type SwapPlan, type SwapSymbol } from "../lib/google-swap";
import { executeSwapViaSequentialTransactions } from "../lib/okx-safe-swap";
import { logVectorActivity } from "../lib/record-vector-activity";
import { ARC_SWAP_TOKENS } from "../lib/swap-tokens";
import { isOkxWallet } from "../lib/wallet-brand";
import { useTokenBalance } from "./useTokenBalance";
import { OkxKitContractsNote } from "./OkxKitContractsNote";
import { useWalletSigningProviderRef } from "./useWalletSigningProvider";
import { VectorModalShell } from "./VectorModalShell";

/**
 * Looser slippage tolerances offered — only ever after Circle has said the
 * slippage constraint is what blocked the swap, and only on an explicit tap.
 * A wider tolerance means accepting a worse price, so it is the user's call.
 */
const SLIPPAGE_STEPS_BPS = [500, 1000] as const;

/**
 * Pairs Circle has declined to price during this page session.
 *
 * Module-level rather than component state so it survives closing and reopening
 * the panel. A pair only lands here once BOTH of the endpoints Vector can price
 * with have returned "not found" for it (see `quoteViaSwapEndpoint`) — never on
 * a timeout, a slippage constraint or a liquidity dip, all of which clear on
 * their own. A page reload forgets it, which is the right default: if Circle
 * enables a route tomorrow, nothing here keeps it hidden. Nor does membership
 * block a retry — changing the amount re-prices the pair from scratch.
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
 * ── WHY THERE IS A SECOND WAY TO PRICE A SWAP ─────────────────────────────────
 *
 * Circle's swap service is reachable through two endpoints, and they are not
 * interchangeable:
 *
 *   GET  /v1/stablecoinKits/quote  ← App Kit's `estimateSwap`, all this panel
 *                                    used to call
 *   POST /v1/stablecoinKits/swap   ← `buildSwapPlan`, already live in
 *                                    app/api/endpoints for the Google wallet
 *
 * `swap-kit` maps **every** HTTP 404 to `INPUT_UNSUPPORTED_ROUTE` (1003) and
 * hardcodes `recoverability: 'FATAL'` at the mapping site; its own comment reads
 * "404 - Not found - unsupported route OR …" and the message template says
 * "Route **or resource** not found." So a 404 from `/quote` is indistinguishable
 * from a pair that has no pool — the FATAL flag is a client-side constant, not
 * Circle's verdict. Reading it as one is how cirBTC came to be pulled from Swap.
 *
 * So before believing a "not found", ask the other endpoint. `POST /swap`
 * returns unsigned adapter calldata plus Circle's proxy EIP-712 signature: it
 * moves no money, needs no wallet and holds no key, so attempting it costs one
 * round trip and nothing else. If it answers, the route exists and we get both a
 * price and an executable plan. If it declines too, two independent endpoints
 * agree and the pair is worth remembering.
 */
type PlanAttempt =
  | { outcome: "plan"; plan: SwapPlan }
  | { outcome: "no-estimate" }
  | { outcome: "unavailable"; error: unknown };

/**
 * The panel's token state is free-form strings; `buildSwapPlan` wants the union.
 *
 * Written as a `Record<SwapSymbol, true>` rather than a chain of `===` checks so
 * that adding a symbol to `SwapSymbol` FAILS THE BUILD here until it is listed.
 * The alternative drifts silently: a new token would still appear in the
 * selector, still quote through App Kit, and just quietly never get the
 * fallback — the sort of half-working state that is hard to notice and easy to
 * misread as "that pair has no route".
 */
const SWAP_SYMBOLS: Record<SwapSymbol, true> = {
  USDC: true,
  cirBTC: true,
  EURC: true,
};

function asSwapSymbol(symbol: string): SwapSymbol | null {
  // The cast is sound: the keys of SWAP_SYMBOLS are exactly SwapSymbol, and the
  // type above guarantees the table stays complete.
  return Object.prototype.hasOwnProperty.call(SWAP_SYMBOLS, symbol)
    ? (symbol as SwapSymbol)
    : null;
}

async function quoteViaSwapEndpoint(args: {
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  slippageBps: number | null;
}): Promise<PlanAttempt> {
  const fromSymbol = asSwapSymbol(args.tokenIn);
  const toSymbol = asSwapSymbol(args.tokenOut);
  if (!fromSymbol || !toSymbol) {
    // Not a failure worth reporting to the user — it means the selector offers a
    // token this path doesn't know how to scale, which is a bug for us to fix,
    // not something they can act on.
    return {
      outcome: "unavailable",
      error: new Error(
        `No decimals known for ${args.tokenIn} → ${args.tokenOut}; refusing to size a swap.`,
      ),
    };
  }
  try {
    const plan = await buildSwapPlan({
      walletAddress: args.walletAddress,
      fromSymbol,
      toSymbol,
      amount: args.amount,
      ...(args.slippageBps !== null ? { slippageBps: args.slippageBps } : {}),
    });
    // A plan with no estimate cannot be presented as a quote. We will not put a
    // number on screen that Circle didn't give us, and we will not ask anyone to
    // confirm a trade whose output reads 0.00 — but the route plainly exists, so
    // this must not be recorded as unroutable either.
    if (!plan.estimatedAmount) return { outcome: "no-estimate" };
    return { outcome: "plan", plan };
  } catch (err) {
    return { outcome: "unavailable", error: err };
  }
}

/**
 * Swap panel for external (injected) wallets on Arc (network from app/lib/network.ts).
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
 * pattern-matching its prose. That distinction is not cosmetic: a slippage
 * constraint is fixable with a looser tolerance and thin liquidity with a
 * smaller size or more time, yet both can arrive carrying the words "no route".
 * Guessing between them meant telling people to "try again later" for a pair
 * that wouldn't route, and hiding the one setting that would have worked.
 *
 * What the codes DON'T settle is whether a route exists — see the note above
 * `quoteViaSwapEndpoint`. `INPUT_UNSUPPORTED_ROUTE` is the SDK's blanket mapping
 * for any 404, so this panel treats it as a reason to ask the other endpoint,
 * not as an answer.
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
  // USDC → EURC. cirBTC was the original default, was pulled from the selector
  // on a misread 1003, and is back in it as of 2026-08-27 (see swap-tokens.ts).
  // The default stays EURC anyway: it is the pair Circle has actually been
  // observed to quote for this app, and a panel should open on the route with
  // the most evidence behind it. cirBTC is one selection away.
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
  /**
   * A swap priced and encoded through POST /swap after GET /quote returned
   * "not found" for this pair.
   *
   * Kept separate from `quote` because the two carry different obligations. An
   * App Kit quote is only ever a display value — `executeSwap` re-prices at send
   * time. This plan is the transaction: Circle has already baked `minTokenOut`
   * and a `deadline` into it for one specific pair and amount. That makes it
   * PERISHABLE. It is cleared at the top of the quoting effect so any input
   * change drops it, and re-checked against the live inputs in `handleSwap`
   * before anything is signed — sending a plan built for a different amount
   * would swap the wrong size.
   */
  const [fallbackPlan, setFallbackPlan] = useState<SwapPlan | null>(null);
  /**
   * Which of the fallback path's two confirmations is in flight. Purely for the
   * button label, but it matters: two wallet prompts with one generic
   * "Swapping…" is how people confirm the wrong thing or give up halfway.
   */
  const [planStage, setPlanStage] = useState<
    "approving" | "awaiting-approval" | "executing" | "awaiting-execution" | null
  >(null);

  const error = errorState?.text ?? null;
  const errorInfo = errorState?.info ?? null;
  const effectiveSlippageBps = slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  /** The next looser tolerance on offer, or null once the ladder runs out. */
  const nextSlippageBps =
    SLIPPAGE_STEPS_BPS.find((bps) => bps > effectiveSlippageBps) ?? null;
  const pairIsUnroutable = unroutable.has(pairKey(tokenIn, tokenOut));

  /**
   * The output figure on screen, from whichever endpoint priced this trade.
   * Never synthesised — if neither returned a number, this stays null and the
   * Swap button stays disabled.
   */
  const displayAmountOut = quote?.amountOut ?? fallbackPlan?.estimatedAmount ?? null;

  const planStageLabel =
    planStage === "approving"
      ? "Confirm the approval…"
      : planStage === "awaiting-approval"
        ? "Waiting for the approval…"
        : planStage === "executing"
          ? "Confirm the swap…"
          : planStage === "awaiting-execution"
            ? "Waiting for the swap…"
            : null;

  const queryClient = useQueryClient();
  const balanceIn = useTokenBalance(tokenIn);
  const balanceOut = useTokenBalance(tokenOut);

  const syncBalancesAfterSwap = useCallback(
    async (txHash: string | null) => {
      await refreshBalancesAfterTx(queryClient, txHash);
      scheduleBalancePoll(queryClient);
      await Promise.all([balanceIn.refetch(), balanceOut.refetch()]);
    },
    [queryClient, balanceIn.refetch, balanceOut.refetch],
  );
  const arcWalletDesync =
    tokenIn === "USDC" && balanceIn.arcWalletDesync === true;

  // Pull the raw EIP-1193 provider out of the active wagmi connector. This is
  // what App Kit's browser adapter wraps. `connector.getProvider()` is wagmi's
  // documented, stable way to get it (defined on the Connector type), so we
  // don't have to reach through undocumented client internals.
  const { providerRef, okxSafePath, ready: providerReady } =
    useWalletSigningProviderRef(connector, address);
  const okxWallet = isOkxWallet(connector) || okxSafePath;

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
    if (!providerReady) return;
    const provider = providerRef.current;
    if (!provider) return;
    let cancelled = false;
    void (async () => {
      const id = await getProviderChainId(provider);
      if (!cancelled) setWalletChainId(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [connector, wagmiChainId, providerReady, providerRef]);

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
    setFallbackPlan(null);
  }

  function changeTokenOut(next: string) {
    setTokenOut(next);
    setSlippageBps(null);
    setFallbackPlan(null);
  }

  /**
   * Remember a pair both endpoints declined, so nobody types into it twice.
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
    // Perishable: built for one exact pair and amount. Any input change has to
    // drop it before a new price lands, or the panel could show one trade while
    // holding the plan for another.
    setFallbackPlan(null);
    if (!parsedAmount || sameToken) {
      setQuote(null);
      setErrorState(
        sameToken ? { text: "Choose two different tokens.", info: null } : null,
      );
      return;
    }
    if (!providerReady) return;
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
          ...(okxSafePath
            ? {
                allowanceStrategy: "approve" as const,
                batchTransactions: false as const,
              }
            : {}),
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
          // "Not found" from /quote is not a liquidity verdict — it is the
          // blanket mapping for any 404 (see `quoteViaSwapEndpoint`). So ask the
          // other endpoint before believing it, and only remember the pair if
          // that one declines as well. Everything else — slippage, thin
          // liquidity, a timeout — can clear on its own and is never recorded.
          if (described.info?.kind === "unsupported-route") {
            const attempt: PlanAttempt = address
              ? await quoteViaSwapEndpoint({
                  walletAddress: address,
                  tokenIn,
                  tokenOut,
                  amount: String(parsedAmount),
                  slippageBps,
                })
              : {
                  outcome: "unavailable",
                  error: new Error("No connected address to price against."),
                };
            if (cancelled) return;

            if (attempt.outcome === "plan") {
              setFallbackPlan(attempt.plan);
              // The route works, so the /quote error is now noise — clear it
              // rather than show a price and a failure side by side.
              setErrorState(null);
              sessionQuotedPairs.add(pairKey(tokenIn, tokenOut));
            } else if (attempt.outcome === "no-estimate") {
              setErrorState({
                text: `Circle can build a ${tokenIn} → ${tokenOut} swap on ${ARC_DISPLAY_NAME} but returned no estimated output, so Vector won't ask you to confirm a trade it can't price. Try a different amount.`,
                info: null,
              });
            } else {
              console.warn(
                "[Vector] POST /swap also declined this pair:",
                attempt.error,
              );
              recordUnroutablePair(tokenIn, tokenOut);
            }
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
  }, [
    parsedAmount,
    tokenIn,
    tokenOut,
    sameToken,
    slippageBps,
    address,
    recordUnroutablePair,
    providerReady,
    okxSafePath,
  ]);

  async function handleSwitch() {
    setErrorState(null);
    let switchError: unknown = null;
    try {
      // wagmi's injected connector asks the wallet to switch and, if the wallet
      // doesn't know Arc yet, offers to add it from viem's own chain definition
      // — so no RPC URL or chain id is hand-written into this prompt.
      await switchChainAsync({ chainId: ARC_CHAIN_ID });
      const p = providerRef.current;
      if (p) await ensureArcNetwork(p);
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
          `Couldn't switch networks. Switch to ${ARC_DISPLAY_NAME} in your wallet, then try again.`,
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
    if (!provider || !address || !parsedAmount || sameToken) return;
    setSwapping(true);
    setErrorState(null);
    setNotice(null);
    setTxHash(null);
    setPlanStage(null);
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
              : `Your wallet is on chain ${liveChainId}, but swaps run on ${ARC_DISPLAY_NAME} (${ARC_CHAIN_ID}). Switch networks and try again — nothing was sent.`,
          info: null,
        });
        return;
      }

      try {
        await ensureArcNetwork(provider);
      } catch {
        setErrorState({
          text:
            "Couldn't switch to Arc in your wallet. If you use OKX or another extension, approve adding the Arc network (USDC gas) and try again — nothing was sent.",
          info: null,
        });
        return;
      }

      // OKX: always POST /swap plan + sequential eth_sendTransaction (never App Kit permit/batch).
      if (okxSafePath && address) {
        const fromSymbol = asSwapSymbol(tokenIn);
        const toSymbol = asSwapSymbol(tokenOut);
        if (!fromSymbol || !toSymbol) {
          setErrorState({
            text: "Unsupported token pair for this swap.",
            info: null,
          });
          return;
        }
        const planResult = await executeSwapViaSequentialTransactions({
          provider,
          walletAddress: address,
          tokenIn: fromSymbol,
          tokenOut: toSymbol,
          amountIn: String(parsedAmount),
          onStage: (stage) => setPlanStage(stage),
        });
        setTxHash(planResult.txHash);
        logVectorActivity({
          walletAddress: address,
          txHash: planResult.txHash,
          kind: "swap",
          chainId: ARC_CHAIN_ID,
          detail: `${tokenIn} → ${tokenOut}`,
        });
        void syncBalancesAfterSwap(planResult.txHash);
        return;
      }

      // ── The POST /swap path, taken when GET /quote returned "not found" ──
      // Circle already priced and signed this plan for one exact pair and
      // amount. The quoting effect clears it whenever an input changes, but this
      // is the last point before real value moves, so confirm the match here
      // rather than trusting that ordering to hold.
      if (fallbackPlan) {
        if (
          fallbackPlan.fromSymbol !== tokenIn ||
          fallbackPlan.toSymbol !== tokenOut ||
          fallbackPlan.amount !== String(parsedAmount)
        ) {
          setFallbackPlan(null);
          setErrorState({
            text: "That price no longer matches what you've entered, so nothing was sent. Re-enter the amount to get a fresh one.",
            info: null,
          });
          return;
        }

        // Two sequential confirmations: the approval has to be mined before the
        // swap, because `execute` pulls the input token via allowance. See
        // app/lib/external-swap.ts.
        const planResult = await executeSwapPlan({
          provider,
          from: address,
          plan: fallbackPlan,
          onStage: (stage) => setPlanStage(stage),
        });
        setTxHash(planResult.executeTxHash);
        logVectorActivity({
          walletAddress: address,
          txHash: planResult.executeTxHash,
          kind: "swap",
          chainId: ARC_CHAIN_ID,
          detail: `${tokenIn} → ${tokenOut}`,
        });
        void syncBalancesAfterSwap(planResult.executeTxHash);
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
      if (result.txHash) {
        logVectorActivity({
          walletAddress: address,
          txHash: result.txHash,
          kind: "swap",
          chainId: ARC_CHAIN_ID,
          detail: `${tokenIn} → ${tokenOut}`,
        });
        void syncBalancesAfterSwap(result.txHash);
      } else {
        // Swap returned but no recognisable hash — surface honestly rather
        // than claim success.
        setErrorState({
          text: "Swap submitted, but no transaction hash was returned. Check your wallet activity to confirm.",
          info: null,
        });
        scheduleBalancePoll(queryClient);
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
      setPlanStage(null);
    }
  }

  function flip() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setQuote(null);
    setSlippageBps(null);
    // The plan is bound to the old direction. Clear it here as well as in the
    // quoting effect so the output box can't show the previous pair's estimate
    // for the split second before the effect re-runs.
    setFallbackPlan(null);
  }

  if (!isConnected || !address) {
    return null;
  }

  return (
    <VectorModalShell title="Swap" onClose={onClose}>
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
          {arcWalletDesync && (
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--vector-pink)]">
              Your wallet shows token USDC but not Arc gas USDC. On Arc they are
              the same balance — try &quot;Switch to Arc&quot; below, re-add the Arc
              network in OKX/MetaMask, or update the wallet app.
            </p>
          )}
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
            ) : displayAmountOut ? (
              displayAmountOut
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
            <div>{formatVectorFeeLabel()}</div>
            {quote.feeText && <div>Fee: {quote.feeText}</div>}
            {slippageBps !== null && (
              <div>Slippage tolerance: {formatBps(slippageBps)} (you raised this)</div>
            )}
          </div>
        )}

        {/* Priced through POST /swap because GET /quote returned "not found"
            for this pair. Said out loud, because it changes what the user is
            about to do: two wallet confirmations instead of one, and no rate or
            fee breakdown — that endpoint doesn't return one, and Vector won't
            compute a rate itself and present it as Circle's. */}
        {fallbackPlan && !swapping && !txHash && (
          <div className="text-[12px] text-[var(--vector-text-dim)] font-mono mb-4 leading-relaxed space-y-1">
            <div>
              Priced through Circle&apos;s swap endpoint: {fallbackPlan.amount}{" "}
              {fallbackPlan.fromSymbol} → ~{fallbackPlan.estimatedAmount}{" "}
              {fallbackPlan.toSymbol}
            </div>
            <div>{formatVectorFeeLabel()}</div>
            <div>
              This route takes two confirmations in your wallet — an approval,
              then the swap. Nothing moves until you confirm the second one.
            </div>
          </div>
        )}

        {error && !txHash && (
          <div className="mb-4">
            <p className="text-[13px] text-[var(--vector-pink)] font-mono">{error}</p>
            {/* Circle's own words and error code, kept visible. Paraphrasing
                alone is how a wrong diagnosis goes unnoticed for weeks; with the
                code on screen, the next report is one line instead of a guess. */}
            {errorInfo?.detail &&
              !isEmptyErrorDetail(errorInfo.detail) &&
              errorInfo.kind !== "user-cancelled" && (
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
          <TxSuccessCard
            title="Swap successful"
            txHash={txHash}
            explorerUrl={arcExplorerTxUrl(txHash)}
            onDismiss={() => {
              setTxHash(null);
              setErrorState(null);
            }}
          />
        )}

        {/* Said up front, before an amount is typed, once BOTH of Circle's
            pricing endpoints have declined this pair. Cheaper than letting
            someone discover it a third time — but deliberately not phrased as a
            permanent verdict, because Circle never gave one: a 404 from that
            service means "not found", and reading more into it than that is the
            mistake that pulled cirBTC from this selector. No "pick another pair"
            instruction either: with a short token list there may not be one, and
            telling someone to do something impossible is worse than silence. */}
        {pairIsUnroutable && !error && (
          <p className="text-[12px] text-[var(--vector-text-dim)] font-mono mb-4 leading-relaxed">
            Circle returned &quot;not found&quot; for {tokenIn} → {tokenOut} on{" "}
            {ARC_DISPLAY_NAME} the last time Vector priced it, on both of the endpoints
            it can ask. Changing the amount tries again.
          </p>
        )}

        {needsChainSwitch ? (
          <div>
            <p className="text-[12px] text-[var(--vector-text-dim)] leading-relaxed mb-3 text-center">
              Swaps run on {ARC_DISPLAY_NAME}, and your wallet is on{" "}
              <span className="font-mono">chain {walletChainId}</span>. Switch
              networks to continue — nothing has been sent.
            </p>
            <button
              onClick={handleSwitch}
              disabled={switching}
              className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
            >
              {switching ? "Switching…" : `Switch to ${ARC_DISPLAY_NAME}`}
            </button>
          </div>
        ) : (
          <button
            onClick={handleSwap}
            disabled={
              swapping || quoting || !displayAmountOut || sameToken || !parsedAmount
            }
            className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
          >
            {swapping
              ? // On the two-confirmation path, name the step. "Swapping…" over
                // two separate wallet prompts is how people confirm the wrong
                // one or abandon it halfway through.
                (planStageLabel ?? "Swapping…")
              : quoting
                ? "Getting quote…"
                : `Swap ${tokenIn} → ${tokenOut}`}
          </button>
        )}

        {okxWallet && <OkxKitContractsNote />}
        <p className="mt-4 text-[11px] leading-relaxed text-[var(--vector-text-dim)] text-center">
          {okxWallet
            ? `Swaps on ${ARC_DISPLAY_NAME} use Circle's Adapter contract with standard OKX transaction confirms (no typed-data batching).`
            : `Swaps run on ${ARC_DISPLAY_NAME} through Circle's App Kit. Estimated output can move slightly before the transaction confirms.`}
        </p>
    </VectorModalShell>
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
  const message = errorTextBlob(err);
  const pair = `${ctx.tokenIn} → ${ctx.tokenOut}`;

  const text = ((): string => {
    switch (info.kind) {
      case "user-cancelled":
        return "You cancelled in your wallet. Nothing was sent.";

      case "chain-mismatch":
        return `Your wallet is on a different network than ${ARC_DISPLAY_NAME}, so it wouldn't sign. Switch to ${ARC_DISPLAY_NAME} and try again — nothing was sent.`;

      case "permit-generation":
        return "Your wallet couldn't approve this swap, so nothing was sent. Reconnect the wallet and try again.";

      case "unsupported-route": {
        // Circle's SDK maps EVERY HTTP 404 to this code and hardcodes
        // `recoverability: 'FATAL'` at the mapping site, so it does not
        // establish that a route is absent — only that the service answered
        // "not found". The previous wording here ("permanent, retrying won't
        // help") stated a verdict Circle never gave, and that inference is what
        // removed a working token from Swap. Report what happened, no more. What
        // we must also not do is replace one guess with another: only a pair
        // Circle has actually priced this session gets named as an alternative.
        const base = `Circle wouldn't price ${pair} on ${ARC_DISPLAY_NAME} — its swap service returned "not found" for this pair.`;
        const proven = provenPairOtherThan(pairKey(ctx.tokenIn, ctx.tokenOut));
        return proven
          ? `${base} ${proven} priced successfully earlier in this session — try that instead.`
          : `${base} No pair has priced successfully here yet either, so there isn't one Vector can honestly point you to.`;
      }

      case "unsupported-token":
        return `Circle's swap service doesn't support one of these tokens on ${ARC_DISPLAY_NAME} yet, so ${pair} can't be quoted. Nothing was sent.`;

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
        if (info.detail && !isEmptyErrorDetail(info.detail)) {
          return info.detail;
        }
        if (/risky|signature type|blocked to protect/i.test(message)) {
          return (
            "Your wallet blocked this as a security precaution (common with OKX on mobile). " +
            "Use the OKX Chrome extension, MetaMask, or Continue with Google — nothing was sent."
          );
        }
        return fallback;
    }
  })();

  return { text, info };
}
