"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { runChallenge, type W3sAuth } from "../lib/w3s-tx";
import {
  buildDepositPlan,
  buildWithdrawPlan,
  readGoogleEarnPosition,
  type EarnPlan,
} from "../lib/google-earn";
import { listArcVaults, type EarnPosition, type EarnVault } from "../lib/earn";
import {
  arcBridgeChainId,
  explorerAddressUrl,
  explorerTxUrl,
} from "../lib/bridge-chains";
import { displayName as ARC_DISPLAY_NAME } from "../lib/network";
import { useLatestTxHash } from "../lib/use-latest-tx-hash";
import { VectorModalShell } from "./VectorModalShell";

/**
 * Earn panel for the Google-login (Circle user-controlled / W3S) wallet.
 *
 * This is the W3S counterpart to EarnPanel (which drives an external wagmi wallet
 * through the Earn kit's provider). A W3S wallet has no signer/provider, so it
 * moves funds only through Circle's challenge flow — the same pattern proven by
 * GoogleSwapPanel / GoogleBridgePanel.
 *
 * A deposit is up to TWO on-chain calls (approve the Adapter Contract, then
 * deposit); a withdraw is one or two (approve vault shares only if the service
 * asks, then withdraw). Because a plan is built from Circle's Earn service and
 * only then can the exact calls be shown, this uses a REVIEW → CONFIRM shape so
 * nothing is signed until the user has seen what they're committing to:
 *   1. Review  — buildDepositPlan / buildWithdrawPlan calls Circle's Earn service
 *      (via our proxy) and encodes approve + execute with Circle's OWN adapter.
 *      Nothing is hand-encoded.
 *   2. Confirm — approve (PIN #1, when present) then execute (PIN #2), each
 *      through createContractExecutionChallenge → runChallenge.
 *
 * Vaults are DISCOVERED live from Circle's Earn service (never hardcoded), and
 * the vault balance shown on withdraw is a pure on-chain READ (no PIN). Editing
 * the amount / mode / vault after a plan is built invalidates it, so a stale plan
 * is never the thing that gets confirmed.
 */
export function GoogleEarnPanel({
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
  /** USDC balance for display + the deposit insufficient check. */
  usdcBalance: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [vaults, setVaults] = useState<EarnVault[] | null>(null);
  const [vaultsLoading, setVaultsLoading] = useState(false);
  const [vaultsError, setVaultsError] = useState<string | null>(null);

  const [selected, setSelected] = useState<EarnVault | null>(null);
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [position, setPosition] = useState<EarnPosition | null>(null);

  const [error, setError] = useState<string | null>(null);
  // phase drives the button label through review → approve → execute.
  const [phase, setPhase] = useState<
    "encoding" | "approving" | "executing" | null
  >(null);
  const [plan, setPlan] = useState<EarnPlan | null>(null);
  const [done, setDone] = useState(false);

  const submitting = phase !== null;

  // Discover vaults once when the panel opens.
  useEffect(() => {
    let cancelled = false;
    setVaultsLoading(true);
    setVaultsError(null);
    (async () => {
      try {
        const list = await listArcVaults();
        if (!cancelled) setVaults(list);
      } catch (err) {
        if (!cancelled) {
          setVaults(null);
          setVaultsError(
            readableError(err, "Couldn't load vaults. Try again shortly."),
          );
        }
      } finally {
        if (!cancelled) setVaultsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Read the vault position whenever a vault is selected. Pure on-chain read —
  // failures are non-fatal (the user can still type an amount), matching
  // EarnPanel's behaviour.
  const refreshPosition = useCallback(async () => {
    if (!selected) return;
    try {
      const pos = await readGoogleEarnPosition({
        walletAddress,
        vaultAddress: selected.vaultAddress,
      });
      setPosition(pos);
    } catch (err) {
      console.error("[Vector] readGoogleEarnPosition failed:", err);
      setPosition(null);
    }
  }, [selected, walletAddress]);

  useEffect(() => {
    setPosition(null);
    if (selected) void refreshPosition();
  }, [selected, refreshPosition]);

  const amountNum = Number(amount);
  const amountValid =
    amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;

  // Balance/limit for the active mode: wallet USDC for deposit, vault position
  // for withdraw.
  const maxForMode =
    mode === "deposit" ? usdcBalance : position?.currentBalance ?? null;

  const overMax = useMemo(() => {
    if (!amountValid || maxForMode === null || maxForMode === "") return false;
    const m = Number(maxForMode);
    return Number.isFinite(m) && amountNum > m;
  }, [amountValid, amountNum, maxForMode]);

  const canReview = amountValid && !overMax && !submitting && !done;
  const canConfirm = plan !== null && !submitting && !done;
  // Steps to confirm: approve (if the service asked for one) + execute.
  const totalSteps = plan?.approve ? 2 : 1;

  // The execute call is a W3S contractExecution challenge, which returns no
  // txHash, so resolve the real hash from Circle's transactions list in the
  // background once the deposit/withdraw is done. Until it lands, the success
  // screen links the wallet's explorer address page on Arc (always correct).
  const execTxHash = useLatestTxHash({
    userToken: auth.userToken,
    walletId,
    trigger: done,
  });
  const explorerUrl = execTxHash
    ? explorerTxUrl(arcBridgeChainId(), execTxHash)
    : explorerAddressUrl(arcBridgeChainId(), walletAddress);
  const explorerIsTx = execTxHash != null;

  /** Any input change invalidates a previously built plan. */
  function invalidatePlan() {
    if (plan) setPlan(null);
    if (error) setError(null);
  }

  /**
   * Run one contractExecution challenge (approve or execute) to completion.
   * Returns the challenge outcome; throws a readable Error on any failure.
   * Identical to GoogleSwapPanel.runContractCall.
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
        earnVaultAddress: selected?.vaultAddress,
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

  /** Phase 1 — build + encode the plan with Circle's own Earn service and adapter. */
  async function handleReview() {
    if (!canReview || !selected) return;
    setError(null);
    try {
      setPhase("encoding");
      const build = mode === "deposit" ? buildDepositPlan : buildWithdrawPlan;
      const built = await build({
        walletAddress,
        vaultAddress: selected.vaultAddress,
        amount: amount.trim(),
      });
      setPlan(built);
      setPhase(null);
    } catch (err) {
      setPhase(null);
      setPlan(null);
      setError(
        err instanceof Error && err.message
          ? err.message
          : `Couldn't prepare the ${mode}. No funds moved.`,
      );
    }
  }

  /** Phase 2 — approve (PIN #1, when present) then execute (PIN #2 / #1). */
  async function handleConfirm() {
    if (!canConfirm || !plan) return;
    setError(null);
    try {
      if (plan.approve) {
        setPhase("approving");
        await runContractCall(plan.approve);
      }

      setPhase("executing");
      await runContractCall(plan.execute);

      setPhase(null);
      setDone(true);
      onSuccess();
      setTimeout(onSuccess, 4000);
    } catch (err) {
      setPhase(null);
      // The plan may have gone stale mid-confirm — drop it so the user re-reviews
      // rather than retrying a stale plan.
      setPlan(null);
      setError(
        err instanceof Error && err.message
          ? err.message
          : `The ${mode} didn't complete.`,
      );
    }
  }

  const confirmLabel = (() => {
    if (phase === "approving") return "Approve in the popup (1 of 2)…";
    if (phase === "executing") {
      return totalSteps === 2
        ? `Confirm ${mode} in the popup (2 of 2)…`
        : `Confirm ${mode} in the popup…`;
    }
    return mode === "deposit" ? "Confirm deposit" : "Confirm withdrawal";
  })();

  return (
    <VectorModalShell
      onClose={onClose}
      header={
        <>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {selected && (
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setAmount("");
                  setPlan(null);
                  setError(null);
                }}
                disabled={submitting}
                className="shrink-0 min-h-[44px] px-2 text-[var(--vector-text-dim)] text-[13px] font-semibold hover:text-[var(--vector-text)] disabled:opacity-40"
                aria-label="Back to vaults"
              >
                ‹ Vaults
              </button>
            )}
            <span className="text-[17px] font-semibold truncate">
              {selected ? "Earn" : "Earn — Arc vaults"}
            </span>
          </div>
          <button type="button" onClick={onClose} className="vector-modal-close">
            Close
          </button>
        </>
      }
    >
        {done ? (
          // ---- Success ----
          <div className="text-center py-6">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--vector-surface-raised)] border border-[var(--vector-pink)]">
              <span className="text-[var(--vector-pink)] text-[22px] leading-none">
                ✓
              </span>
            </div>
            <p className="text-[15px] font-semibold mb-1.5">
              {mode === "deposit" ? "Deposit complete" : "Withdrawal complete"}
            </p>
            <p className="text-[13px] text-[var(--vector-text-dim)] leading-relaxed mb-6">
              {mode === "deposit"
                ? `Deposited ${amount} USDC into ${selected?.name ?? "the vault"} on ${ARC_DISPLAY_NAME}.`
                : `Withdrew ${amount} USDC from ${selected?.name ?? "the vault"} on ${ARC_DISPLAY_NAME}.`}
            </p>
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mb-6 text-[12px] text-[var(--vector-pink)] font-mono hover:opacity-80 transition-opacity"
              >
                {explorerIsTx
                  ? "View on Arc explorer ↗"
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
        ) : !selected ? (
          // ---- Vault list ----
          <div>
            {vaultsLoading && (
              <p className="text-[13px] text-[var(--vector-text-dim)] py-6 text-center">
                Loading vaults…
              </p>
            )}
            {vaultsError && (
              <p className="text-[13px] text-[var(--vector-pink)] font-mono py-4">
                {vaultsError}
              </p>
            )}
            {!vaultsLoading && !vaultsError && vaults && vaults.length === 0 && (
              <p className="text-[13px] text-[var(--vector-text-dim)] py-6 text-center leading-relaxed">
                No USDC vaults are available on {ARC_DISPLAY_NAME} right now. Check back
                later.
              </p>
            )}
            {vaults && vaults.length > 0 && (
              <div className="space-y-2">
                {vaults.map((v) => (
                  <button
                    key={v.vaultAddress}
                    onClick={() => {
                      setSelected(v);
                      setMode("deposit");
                      setAmount("");
                      setPlan(null);
                      setError(null);
                    }}
                    className="w-full text-left rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4 hover:border-[var(--vector-pink)] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-semibold text-[var(--vector-text)]">
                        {v.name}
                      </span>
                      <span className="text-[15px] font-semibold text-[var(--vector-pink)]">
                        {v.apyText ?? "—"}
                        <span className="text-[11px] text-[var(--vector-text-dim)] font-normal ml-1">
                          APY
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[11px] text-[var(--vector-text-dim)] font-mono">
                      <span>{v.protocol || "—"}</span>
                      {v.tvlText && <span>TVL {v.tvlText}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-6 text-[11px] leading-relaxed text-[var(--vector-text-dim)] text-center">
              Vaults are discovered live from Circle&apos;s Earn service. APY is
              variable and not guaranteed.
            </p>
          </div>
        ) : (
          // ---- Vault detail: deposit / withdraw ----
          <div>
            <div className="rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold">
                  {selected.name}
                </span>
                <span className="text-[15px] font-semibold text-[var(--vector-pink)]">
                  {selected.apyText ?? "—"}
                  <span className="text-[11px] text-[var(--vector-text-dim)] font-normal ml-1">
                    APY
                  </span>
                </span>
              </div>
              <div className="mt-2 text-[12px] text-[var(--vector-text-dim)] font-mono">
                Your position:{" "}
                <span className="text-[var(--vector-text)]">
                  {position?.currentBalance != null
                    ? `${position.currentBalance} USDC`
                    : "0 USDC"}
                </span>
              </div>
            </div>

            {/* Deposit / Withdraw toggle */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {(["deposit", "withdraw"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setAmount("");
                    setPlan(null);
                    setError(null);
                  }}
                  disabled={submitting}
                  className={`h-[40px] rounded-full text-[13px] font-semibold capitalize transition-colors disabled:opacity-40 ${
                    mode === m
                      ? "bg-[var(--vector-pink)] text-[#0b0b0e]"
                      : "bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] text-[var(--vector-text-dim)] hover:text-[var(--vector-text)]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Amount */}
            <div className="rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] text-[var(--vector-text-dim)]">
                  {mode === "deposit" ? "Deposit amount" : "Withdraw amount"}
                </span>
                <span className="text-[11px] text-[var(--vector-text-dim)] font-mono">
                  USDC
                </span>
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
                  {mode === "deposit"
                    ? usdcBalance !== null
                      ? `Balance: ${usdcBalance} USDC`
                      : "Balance: —"
                    : `In vault: ${position?.currentBalance ?? "0"} USDC`}
                </span>
                {maxForMode !== null &&
                  maxForMode !== "" &&
                  Number(maxForMode) > 0 && (
                    <button
                      onClick={() => {
                        setAmount(maxForMode);
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

            {overMax && !error && (
              <p className="text-[13px] text-[var(--vector-pink)] font-mono mb-4">
                {mode === "deposit"
                  ? "Amount exceeds your USDC balance."
                  : "Amount exceeds your vault balance."}
              </p>
            )}

            {error && (
              <p className="text-[13px] text-[var(--vector-pink)] font-mono mb-4">
                {error}
              </p>
            )}

            {plan ? (
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
              >
                {confirmLabel}
              </button>
            ) : (
              <button
                onClick={handleReview}
                disabled={!canReview}
                className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
              >
                {phase === "encoding"
                  ? "Preparing…"
                  : mode === "deposit"
                    ? "Review deposit"
                    : "Review withdrawal"}
              </button>
            )}

            <p className="mt-4 text-[11px] leading-relaxed text-[var(--vector-text-dim)] text-center">
              {plan
                ? totalSteps === 2
                  ? "Confirming is two steps: first approve, then the " +
                    mode +
                    ". You'll enter your Circle PIN for each. Gas is paid in USDC on Arc."
                  : "You'll enter your Circle PIN to confirm. Gas is paid in USDC on Arc."
                : `Runs on ${ARC_DISPLAY_NAME} through Circle's Earn. Gas is paid in USDC — leave a little for the network fee. APY is variable and not guaranteed.`}
            </p>
          </div>
        )}
    </VectorModalShell>
  );
}

function readableError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message.split("\n")[0];
  }
  if (typeof err === "string") return err;
  return fallback;
}
