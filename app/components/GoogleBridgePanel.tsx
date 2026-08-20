"use client";

import { useState } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { runChallenge, type W3sAuth } from "../lib/w3s-tx";
import {
  buildBridgePlan,
  type BridgePlan,
} from "../lib/google-bridge";
import {
  bridgeChainById,
  explorerAddressUrl,
  explorerTxUrl,
  type BridgeChainId,
} from "../lib/bridge-chains";
import { useLatestTxHash } from "../lib/use-latest-tx-hash";

/**
 * Bridge USDC panel for the Google-login (Circle user-controlled / W3S) wallet.
 *
 * This is the W3S counterpart to BridgePanel (which drives an external wagmi
 * wallet through App Kit). A W3S wallet has no signer/provider, so it can't let
 * App Kit broadcast — instead it moves funds through Circle's challenge flow.
 *
 * A CCTP bridge is TWO on-chain calls: approve (let the bridge pull USDC) then
 * burn (lock USDC on Arc; Circle's relayer mints on the destination). So this is
 * a THREE-phase flow:
 *   1. (browser) buildBridgePlan(...) uses Circle's OWN CCTP encoder to produce
 *      the exact {to,data,value} for approve + burn. Nothing is hand-encoded.
 *   2. (server→browser) approve: createContractExecutionChallenge → runChallenge
 *      → Circle PIN → Circle signs + broadcasts the approve.
 *   3. (server→browser) burn: same handshake for the burn calldata.
 * Source is always Arc; the user picks the destination.
 *
 * Because the source burn is all the W3S wallet ever signs (useForwarder makes
 * Circle's relayer do the destination mint), the wallet never has to switch
 * chains — which it couldn't do anyway, being Arc-scoped.
 */

/** Destinations a Google (Arc-scoped) wallet can bridge TO. Source is fixed to Arc. */
const DEST_CHAINS: BridgeChainId[] = ["Base_Sepolia", "Ethereum_Sepolia"];

export function GoogleBridgePanel({
  sdk,
  auth,
  walletId,
  walletAddress,
  balance,
  onClose,
  onSuccess,
}: {
  sdk: W3SSdk;
  auth: W3sAuth;
  walletId: string;
  walletAddress: string;
  balance: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [toChain, setToChain] = useState<BridgeChainId>("Base_Sepolia");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  // phase drives the button label through the three-step flow.
  const [phase, setPhase] = useState<
    "encoding" | "approving" | "burning" | null
  >(null);
  const [done, setDone] = useState(false);

  const submitting = phase !== null;

  const destChain = bridgeChainById(toChain);
  const destLabel = destChain?.label ?? toChain;

  const amountNum = Number(amount);
  const balanceNum = balance !== null && balance !== "" ? Number(balance) : null;
  const amountValid =
    amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const insufficient =
    amountValid && balanceNum !== null && amountNum > balanceNum;

  const canBridge = amountValid && !insufficient && !submitting && !done;

  // The burn is a W3S contractExecution challenge, which returns no txHash, so
  // resolve the real hash from Circle's transactions list in the background
  // once the bridge is started. Until it lands (or if it never does), the
  // success screen links the wallet's explorer address page on Arc — always
  // correct and needs no hash.
  const burnTxHash = useLatestTxHash({
    userToken: auth.userToken,
    walletId,
    trigger: done,
  });
  const explorerUrl = burnTxHash
    ? explorerTxUrl("Arc_Testnet", burnTxHash)
    : explorerAddressUrl("Arc_Testnet", walletAddress);
  const explorerIsTx = burnTxHash != null;

  /**
   * Run one contractExecution challenge (approve or burn) to completion.
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

  async function handleBridge() {
    if (!canBridge) return;
    setError(null);

    let plan: BridgePlan;
    try {
      // Phase 1 — encode approve + burn with Circle's own CCTP provider.
      setPhase("encoding");
      plan = await buildBridgePlan({
        walletAddress,
        toChain,
        amount: amount.trim(),
      });
    } catch (err) {
      setPhase(null);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't prepare the bridge. No funds moved.",
      );
      return;
    }

    try {
      // Phase 2 — approve (lets the Arc bridge pull the USDC). PIN #1.
      setPhase("approving");
      await runContractCall(plan.approve);

      // Phase 3 — burn on Arc; Circle's relayer mints on the destination. PIN #2.
      setPhase("burning");
      await runContractCall(plan.burn);

      setPhase(null);
      setDone(true);
      onSuccess();
      setTimeout(onSuccess, 4000);
    } catch (err) {
      setPhase(null);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "The bridge didn't complete.",
      );
    }
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

        {done ? (
          <div className="text-center py-6">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--vector-surface-raised)] border border-[var(--vector-pink)]">
              <span className="text-[var(--vector-pink)] text-[22px] leading-none">
                ✓
              </span>
            </div>
            <p className="text-[15px] font-semibold mb-1.5">Bridge started</p>
            <p className="text-[13px] text-[var(--vector-text-dim)] leading-relaxed mb-6">
              {amount} USDC was burned on Arc. Circle&apos;s relayer will mint it
              to your wallet on {destLabel} shortly — this can take a few minutes.
            </p>
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mb-6 text-[12px] text-[var(--vector-pink)] font-mono hover:opacity-80 transition-opacity"
              >
                {explorerIsTx
                  ? "View burn on Arc explorer ↗"
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
            {/* Route: Arc → destination */}
            <div className="rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[12px] text-[var(--vector-text-dim)]">
                  From
                </span>
                <span className="text-[13px] font-mono">Arc Testnet</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[var(--vector-text-dim)]">
                  To
                </span>
                <div className="flex gap-1.5">
                  {DEST_CHAINS.map((id) => {
                    const c = bridgeChainById(id);
                    const active = id === toChain;
                    return (
                      <button
                        key={id}
                        onClick={() => setToChain(id)}
                        disabled={submitting}
                        className={
                          "px-3 h-[32px] rounded-full text-[12px] font-mono transition-colors disabled:opacity-40 " +
                          (active
                            ? "bg-[var(--vector-pink)] text-[#0b0b0e]"
                            : "border border-[var(--vector-line)] text-[var(--vector-text)] hover:border-[var(--vector-pink)]")
                        }
                      >
                        {c?.label ?? id}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-[var(--vector-text-dim)] mb-4 px-1">
              Your Google wallet lives on Arc, so bridges start from Arc. To
              bridge from Base or Ethereum Sepolia, connect an external wallet
              instead.
            </p>

            {/* Amount */}
            <div className="rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] text-[var(--vector-text-dim)]">
                  Amount
                </span>
                <span className="text-[11px] text-[var(--vector-text-dim)] font-mono">
                  USDC
                </span>
              </div>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                }
                disabled={submitting}
                className="w-full bg-transparent text-[28px] font-semibold outline-none placeholder:text-[var(--vector-line)] disabled:opacity-60"
              />
              <div className="flex items-center justify-between mt-2 text-[11px] text-[var(--vector-text-dim)] font-mono">
                <span>
                  {balance !== null ? `Balance: ${balance} USDC` : "Balance: —"}
                </span>
                {balanceNum !== null && balanceNum > 0 && (
                  <button
                    onClick={() => setAmount(balance as string)}
                    disabled={submitting}
                    className="text-[var(--vector-pink)] hover:opacity-80 transition-opacity uppercase tracking-wide disabled:opacity-40"
                  >
                    Max
                  </button>
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

            <button
              onClick={handleBridge}
              disabled={!canBridge}
              className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
            >
              {phase === "encoding"
                ? "Preparing…"
                : phase === "approving"
                  ? "Approve in the popup (1 of 2)…"
                  : phase === "burning"
                    ? "Confirm bridge in the popup (2 of 2)…"
                    : `Bridge to ${destLabel}`}
            </button>

            <p className="mt-4 text-[11px] leading-relaxed text-[var(--vector-text-dim)] text-center">
              Bridging is two confirmations: first approve, then the transfer.
              You&apos;ll enter your Circle PIN for each. Gas is paid in USDC on
              Arc, so leave a little for fees. Funds arrive on {destLabel} after
              Circle&apos;s relayer mints them.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
