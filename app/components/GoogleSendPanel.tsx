"use client";

import { useMemo, useState } from "react";
import { isAddress } from "viem";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { runChallenge, type W3sAuth } from "../lib/w3s-tx";
import { explorerAddressUrl, explorerTxUrl } from "../lib/bridge-chains";
import { useLatestTxHash } from "../lib/use-latest-tx-hash";

/**
 * Send USDC panel for the Google-login (Circle user-controlled / W3S) wallet.
 *
 * This is a different path from SendPanel (which drives an external wagmi
 * wallet). A user-controlled send is a two-step handshake, and NOTHING about
 * the money-moving call is guessed:
 *   1. (server) POST /api/endpoints action "createTransferChallenge" →
 *      Circle's verified /v1/w3s/user/transactions/transfer builds the transfer
 *      from structured inputs (walletId, tokenId, destinationAddress, amount)
 *      and returns a `challengeId`. Circle constructs the transfer itself — we
 *      hand-encode no calldata.
 *   2. (browser) runChallenge(sdk, auth, challengeId) → Circle's own PIN /
 *      confirmation UI opens over this modal; on approval Circle signs and
 *      broadcasts.
 *
 * The USDC token is identified by Circle's `tokenId` (read from the balances
 * endpoint), so no USDC address is hardcoded. Amounts are passed as the same
 * human-readable decimal string the balances endpoint reports.
 */
export function GoogleSendPanel({
  sdk,
  auth,
  walletId,
  walletAddress,
  tokenId,
  balance,
  onClose,
  onSuccess,
}: {
  sdk: W3SSdk;
  auth: W3sAuth;
  walletId: string;
  walletAddress: string;
  tokenId: string | null;
  balance: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  // phase drives the button label through the two-step handshake.
  const [phase, setPhase] = useState<"creating" | "confirming" | null>(null);
  const [done, setDone] = useState(false);

  const submitting = phase !== null;

  const recipientTrimmed = to.trim();
  const recipientValid = useMemo(
    () => isAddress(recipientTrimmed),
    [recipientTrimmed],
  );
  // Sending to this wallet's own address is almost always a mistake — catch it.
  const isSelfSend =
    recipientValid &&
    recipientTrimmed.toLowerCase() === walletAddress.toLowerCase();

  const amountNum = Number(amount);
  const balanceNum = balance !== null && balance !== "" ? Number(balance) : null;
  const amountValid =
    amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const insufficient =
    amountValid && balanceNum !== null && amountNum > balanceNum;

  const canSend =
    recipientValid &&
    !isSelfSend &&
    amountValid &&
    !insufficient &&
    !!tokenId &&
    !submitting &&
    !done;

  // A W3S transfer challenge returns no txHash, so resolve the real hash from
  // Circle's transactions list in the background once the send is done. Until
  // it lands, the success screen links the wallet's explorer address page on
  // Arc (always correct, needs no hash).
  const sendTxHash = useLatestTxHash({
    userToken: auth.userToken,
    walletId,
    trigger: done,
  });
  const explorerUrl = sendTxHash
    ? explorerTxUrl("Arc_Testnet", sendTxHash)
    : explorerAddressUrl("Arc_Testnet", walletAddress);
  const explorerIsTx = sendTxHash != null;

  async function handleSend() {
    if (!canSend || !tokenId) return;
    setError(null);
    setPhase("creating");
    try {
      // Step 1 — server creates the transfer challenge over Circle's REST API.
      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createTransferChallenge",
          userToken: auth.userToken,
          walletId,
          tokenId,
          destinationAddress: recipientTrimmed,
          amount: amount.trim(),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setPhase(null);
        setError(
          data?.code === "TIMEOUT"
            ? "That's taking longer than expected reaching Circle. Please try again."
            : typeof data?.message === "string" && data.message
              ? data.message
              : typeof data?.error === "string" && data.error
                ? data.error
                : "Couldn't start the transfer. No funds moved — please try again.",
        );
        return;
      }

      const challengeId =
        typeof data?.challengeId === "string" ? data.challengeId : null;
      if (!challengeId) {
        setPhase(null);
        setError("Couldn't start the transfer. No funds moved — please try again.");
        return;
      }

      // Step 2 — browser runs the challenge; Circle shows its PIN UI, then
      // signs + broadcasts. Resolves only on a COMPLETE status.
      setPhase("confirming");
      await runChallenge(sdk, auth, challengeId);

      setPhase(null);
      setDone(true);
      // Balance usually lags a moment behind broadcast — refresh now and again.
      onSuccess();
      setTimeout(onSuccess, 4000);
    } catch (err) {
      setPhase(null);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "The transfer didn't complete. No funds moved.",
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
          <span className="text-[17px] font-semibold">Send USDC</span>
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
            <p className="text-[15px] font-semibold mb-1.5">Sent</p>
            <p className="text-[13px] text-[var(--vector-text-dim)] leading-relaxed mb-6">
              {amount} USDC is on its way to{" "}
              <span className="font-mono">
                {recipientTrimmed.slice(0, 6)}…{recipientTrimmed.slice(-4)}
              </span>
              . Your balance will update shortly.
            </p>
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mb-6 text-[12px] text-[var(--vector-pink)] font-mono hover:opacity-80 transition-opacity"
              >
                {explorerIsTx
                  ? "View transaction on Arc explorer ↗"
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
            {/* Recipient */}
            <div className="rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] text-[var(--vector-text-dim)]">
                  To
                </span>
                <span className="text-[11px] text-[var(--vector-text-dim)] font-mono">
                  Arc Testnet
                </span>
              </div>
              <input
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="0x… recipient address"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={submitting}
                className="w-full bg-transparent text-[15px] font-mono outline-none placeholder:text-[var(--vector-line)] break-all disabled:opacity-60"
              />
              {recipientTrimmed.length > 0 && !recipientValid && (
                <p className="mt-2 text-[11px] text-[var(--vector-pink)] font-mono">
                  That doesn&apos;t look like a valid address.
                </p>
              )}
              {isSelfSend && (
                <p className="mt-2 text-[11px] text-[var(--vector-pink)] font-mono">
                  That&apos;s this wallet&apos;s own address.
                </p>
              )}
            </div>

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

            {!tokenId && !error && (
              <p className="text-[13px] text-[var(--vector-text-dim)] font-mono mb-4">
                This wallet has no USDC to send yet.
              </p>
            )}

            <button
              onClick={handleSend}
              disabled={!canSend}
              className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
            >
              {phase === "creating"
                ? "Preparing…"
                : phase === "confirming"
                  ? "Confirm in the popup…"
                  : "Send USDC"}
            </button>

            <p className="mt-4 text-[11px] leading-relaxed text-[var(--vector-text-dim)] text-center">
              On Arc, gas is paid in USDC — leave a little for the network fee.
              You&apos;ll confirm with your Circle PIN.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
