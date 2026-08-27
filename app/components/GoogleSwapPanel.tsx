"use client";

import { useState } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { runChallenge, type W3sAuth } from "../lib/w3s-tx";
import {
  buildSwapPlan,
  type SwapPlan,
  type SwapSymbol,
} from "../lib/google-swap";
import { explorerAddressUrl, explorerTxUrl } from "../lib/bridge-chains";
import { useLatestTxHash } from "../lib/use-latest-tx-hash";

/**
 * Swap panel for the Google-login (Circle user-controlled / W3S) wallet.
 *
 * This is the W3S counterpart to SwapPanel (which drives an external wagmi wallet
 * through App Kit's .swap()). A W3S wallet has no signer/provider, so it moves
 * funds only through Circle's challenge flow.
 *
 * A stablecoin swap is TWO on-chain calls: approve (let the Adapter Contract pull
 * the input token) then execute (the Adapter runs the swap using Circle's
 * proxy-signed params). Because the output amount varies, this uses a
 * REVIEW → CONFIRM shape so the user sees the estimated output before any funds
 * move:
 *   1. Review  — buildSwapPlan(...) calls Circle's swap service (via our proxy)
 *      and encodes approve + execute with Circle's OWN adapter. Nothing is
 *      hand-encoded. Shows the estimated output.
 *   2. Confirm — approve (PIN #1) then execute (PIN #2), each through
 *      createContractExecutionChallenge → runChallenge.
 *
 * Editing the amount or tokens after a quote invalidates it, so a stale quote is
 * never the thing that gets confirmed.
 */

/**
 * Tokens offered here — the three first-party Arc assets Circle's faucet funds.
 *
 * cirBTC was pulled from this list on 2026-08-22 because Circle returned
 * INPUT_UNSUPPORTED_ROUTE (1003, FATAL) for USDC → cirBTC. That was a
 * misreading: 1003/FATAL is the SDK's blanket mapping for ANY unexplained 404
 * and the FATAL label is hardcoded client-side, so it never was a statement
 * about liquidity. RESTORED 2026-08-27 on third-party evidence — cirBTC swaps
 * work in another app (ezwallet.cash) against the same Circle swap service on
 * the same chain, so the pair does route.
 *
 * Kept in sync with `ARC_SWAP_TOKENS` in lib/swap-tokens.ts (the external
 * wallet's selector). These are two lists because the Google path takes the
 * `SwapSymbol` union rather than the token registry; if you change one, change
 * the other.
 */
const SWAP_SYMBOLS: SwapSymbol[] = ["USDC", "cirBTC", "EURC"];

export function GoogleSwapPanel({
  sdk,
  auth,
  walletId,
  walletAddress,
  usdcBalance,
  onClose,
  onSuccess,
}: {
  sdk: W3SSdk;
  auth: W3sAuth;
  walletId: string;
  walletAddress: string;
  /** USDC balance for display + the insufficient check (only when paying USDC). */
  usdcBalance: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [fromSymbol, setFromSymbol] = useState<SwapSymbol>("USDC");
  const [toSymbol, setToSymbol] = useState<SwapSymbol>("EURC");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  // phase drives the button label through the review → approve → execute flow.
  const [phase, setPhase] = useState<
    "encoding" | "approving" | "executing" | null
  >(null);
  const [plan, setPlan] = useState<SwapPlan | null>(null);
  const [done, setDone] = useState(false);

  const submitting = phase !== null;
  const sameToken = fromSymbol === toSymbol;

  const amountNum = Number(amount);
  const amountValid =
    amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;

  // We only know the USDC balance here, so the insufficient check applies only
  // when the user is paying USDC. (The non-USDC token's balance isn't fetched
  // in this panel.)
  const payingUsdc = fromSymbol === "USDC";
  const balanceNum =
    payingUsdc && usdcBalance !== null && usdcBalance !== ""
      ? Number(usdcBalance)
      : null;
  const insufficient =
    amountValid && balanceNum !== null && amountNum > balanceNum;

  const canReview =
    amountValid && !sameToken && !insufficient && !submitting && !done;
  const canConfirm = plan !== null && !submitting && !done;

  // A W3S contractExecution challenge returns no txHash, so resolve the real
  // hash from Circle's transactions list in the background once the swap is
  // done. Until it lands, the success screen links the wallet's explorer
  // address page (always correct, needs no hash).
  const execTxHash = useLatestTxHash({
    userToken: auth.userToken,
    walletId,
    trigger: done,
  });
  const explorerUrl = execTxHash
    ? explorerTxUrl("Arc_Testnet", execTxHash)
    : explorerAddressUrl("Arc_Testnet", walletAddress);
  const explorerIsTx = execTxHash != null;

  /** Any input change invalidates a previously fetched quote/plan. */
  function invalidatePlan() {
    if (plan) setPlan(null);
    if (error) setError(null);
  }

  /**
   * Run one contractExecution challenge (approve or execute) to completion.
   * Returns the challenge outcome; throws a readable Error on any failure.
   */
  async function runContractCall(call: {
    to: string;
    data: string;
    value: string;
  }) {
    const response = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "createContractExecutionChallenge",
        userToken: auth.userToken,
        walletId,
        contractAddress: call.to,
        callData: call.data,
        amount: call.value,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.code === "TIMEOUT"
          ? "That's taking longer than expected reaching Circle. Please try again."
          : typeof data?.message === "string" && data.message
            ? data.message
            : typeof data?.error === "string" && data.error
              ? data.error
              : "Couldn't prepare the transaction. No funds moved — please try again.",
      );
    }

    const challengeId =
      typeof data?.challengeId === "string" ? data.challengeId : null;
    if (!challengeId) {
      throw new Error(
        "Couldn't prepare the transaction. No funds moved — please try again.",
      );
    }

    return runChallenge(sdk, auth, challengeId);
  }

  /** Phase 1 — quote + encode with Circle's own swap service and adapter. */
  async function handleReview() {
    if (!canReview) return;
    setError(null);
    try {
      setPhase("encoding");
      const built = await buildSwapPlan({
        walletAddress,
        fromSymbol,
        toSymbol,
        amount: amount.trim(),
      });
      setPlan(built);
      setPhase(null);
    } catch (err) {
      setPhase(null);
      setPlan(null);
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Couldn't get a swap quote. No funds moved.";
      // "No route" means Circle has no swap route/liquidity for this pair on
      // Arc Testnet yet — explain it honestly rather than as a generic failure.
      setError(
        /no route|route.*(available|found)|no.*liquidity/i.test(msg)
          ? "No swap route for this pair on Arc Testnet yet. Swap routes depend on Circle-provided liquidity, which isn't available for this pair right now — try again later."
          : msg,
      );
    }
  }

  /** Phase 2 — approve (PIN #1) then execute (PIN #2). */
  async function handleConfirm() {
    if (!canConfirm || !plan) return;
    setError(null);
    try {
      setPhase("approving");
      await runContractCall(plan.approve);

      setPhase("executing");
      await runContractCall(plan.execute);

      setPhase(null);
      setDone(true);
      onSuccess();
      setTimeout(onSuccess, 4000);
    } catch (err) {
      setPhase(null);
      // The quote may have expired mid-confirm — drop it so the user re-quotes
      // rather than retrying a stale plan.
      setPlan(null);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "The swap didn't complete.",
      );
    }
  }

  function flip() {
    setFromSymbol(toSymbol);
    setToSymbol(fromSymbol);
    invalidatePlan();
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

        {done ? (
          <div className="text-center py-6">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--vector-surface-raised)] border border-[var(--vector-pink)]">
              <span className="text-[var(--vector-pink)] text-[22px] leading-none">
                ✓
              </span>
            </div>
            <p className="text-[15px] font-semibold mb-1.5">Swap complete</p>
            <p className="text-[13px] text-[var(--vector-text-dim)] leading-relaxed mb-6">
              Swapped {amount} {fromSymbol} to {toSymbol} on Arc Testnet.
            </p>
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mb-6 text-[12px] text-[var(--vector-pink)] font-mono hover:opacity-80 transition-opacity"
              >
                {explorerIsTx
                  ? "View swap on Arc explorer ↗"
                  : "View wallet on Arc explorer ↗"}
              </a>
            )}
            <button
              onClick={onClose}
              className="w-full h-[48px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[14px] hover:opacity-90 active:opacity-80 transition-opacity"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* You pay */}
            <div className="rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4 mb-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] text-[var(--vector-text-dim)]">
                  You pay
                </span>
                <TokenSelect
                  value={fromSymbol}
                  onChange={(v) => {
                    setFromSymbol(v);
                    invalidatePlan();
                  }}
                  disabled={submitting}
                />
              </div>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                  invalidatePlan();
                }}
                disabled={submitting}
                className="w-full bg-transparent text-[28px] font-semibold outline-none placeholder:text-[var(--vector-line)] disabled:opacity-60"
              />
              <div className="flex items-center justify-between mt-2 text-[11px] text-[var(--vector-text-dim)] font-mono">
                <span>
                  {payingUsdc
                    ? usdcBalance !== null
                      ? `Balance: ${usdcBalance} USDC`
                      : "Balance: —"
                    : "Balance: —"}
                </span>
                {payingUsdc && balanceNum !== null && balanceNum > 0 && (
                  <button
                    onClick={() => {
                      setAmount(usdcBalance as string);
                      invalidatePlan();
                    }}
                    disabled={submitting}
                    className="text-[var(--vector-pink)] hover:opacity-80 transition-opacity uppercase tracking-wide disabled:opacity-40"
                  >
                    Max
                  </button>
                )}
              </div>
            </div>

            {/* Flip */}
            <div className="flex justify-center -my-2 relative z-10">
              <button
                onClick={flip}
                disabled={submitting}
                className="w-9 h-9 rounded-full border border-[var(--vector-line)] bg-[var(--vector-surface)] flex items-center justify-center hover:border-[var(--vector-pink)] transition-colors disabled:opacity-40"
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

            {/* You receive */}
            <div className="rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4 mt-1 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] text-[var(--vector-text-dim)]">
                  You receive (estimated)
                </span>
                <TokenSelect
                  value={toSymbol}
                  onChange={(v) => {
                    setToSymbol(v);
                    invalidatePlan();
                  }}
                  disabled={submitting}
                />
              </div>
              <div className="text-[28px] font-semibold text-[var(--vector-text)]">
                {phase === "encoding" ? (
                  <span className="text-[var(--vector-text-dim)] text-[20px]">
                    Quoting…
                  </span>
                ) : plan?.estimatedAmount ? (
                  plan.estimatedAmount
                ) : (
                  <span className="text-[var(--vector-line)]">0.00</span>
                )}
              </div>
            </div>

            {error && (
              <p className="text-[13px] text-[var(--vector-pink)] font-mono mb-4">
                {error}
              </p>
            )}

            {insufficient && !error && (
              <p className="text-[13px] text-[var(--vector-pink)] font-mono mb-4">
                Amount exceeds your USDC balance.
              </p>
            )}

            {sameToken && !error && (
              <p className="text-[13px] text-[var(--vector-pink)] font-mono mb-4">
                Choose two different tokens.
              </p>
            )}

            {plan ? (
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
              >
                {phase === "approving"
                  ? "Approve in the popup (1 of 2)…"
                  : phase === "executing"
                    ? "Confirm swap in the popup (2 of 2)…"
                    : `Confirm swap ${fromSymbol} → ${toSymbol}`}
              </button>
            ) : (
              <button
                onClick={handleReview}
                disabled={!canReview}
                className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
              >
                {phase === "encoding"
                  ? "Getting quote…"
                  : `Review swap ${fromSymbol} → ${toSymbol}`}
              </button>
            )}

            <p className="mt-4 text-[11px] leading-relaxed text-[var(--vector-text-dim)] text-center">
              {plan
                ? "Confirming is two steps: first approve, then the swap. You'll enter your Circle PIN for each. Gas is paid in USDC on Arc."
                : "Swaps run on Arc Testnet through Circle. The estimated output can move slightly before you confirm."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function TokenSelect({
  value,
  onChange,
  disabled,
}: {
  value: SwapSymbol;
  onChange: (v: SwapSymbol) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SwapSymbol)}
      disabled={disabled}
      className="bg-[var(--vector-surface)] border border-[var(--vector-line)] rounded-full px-3 py-1.5 text-[13px] font-semibold text-[var(--vector-text)] outline-none hover:border-[var(--vector-pink)] transition-colors cursor-pointer disabled:opacity-40"
    >
      {SWAP_SYMBOLS.map((s) => (
        <option key={s} value={s} className="bg-[var(--vector-surface)]">
          {s}
        </option>
      ))}
    </select>
  );
}
