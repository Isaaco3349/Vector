"use client";

import { useMemo, useState } from "react";
import { isAddress, parseUnits } from "viem";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { runChallenge, type W3sAuth } from "../lib/w3s-tx";
import {
  arcBridgeChainId,
  explorerAddressUrl,
  explorerTxUrl,
} from "../lib/bridge-chains";
import { displayName as ARC_DISPLAY_NAME } from "../lib/network";
import { useLatestTxHash } from "../lib/use-latest-tx-hash";
import {
  ARC_NATIVE_DECIMALS,
  encodeVectorSend,
  vectorRouterAddress,
} from "../lib/vector-router";
import { VectorModalShell } from "./VectorModalShell";

/**
 * Send USDC panel for the Google-login (Circle user-controlled / W3S) wallet.
 *
 * This is a different path from SendPanel (which drives an external wagmi
 * wallet). A user-controlled send is a two-step handshake, and NOTHING about
 * the money-moving call is guessed.
 *
 * ── TWO ROUTES, PICKED BY CONFIG ──────────────────────────────────────────────
 * A) ROUTER (when NEXT_PUBLIC_VECTOR_ROUTER_ARC is set) — the send becomes a real
 *    on-chain CONTRACT CALL to Vector's own router, emitting an indexable
 *    `VectorSend` event instead of being an anonymous value transfer:
 *      1. (server) action "createContractExecutionChallenge" → Circle's verified
 *         POST /v1/w3s/user/transactions/contractExecution with
 *         contractAddress = the router, callData = `send(to, amount)` encoded by
 *         viem from OUR OWN contract's ABI (contracts/VectorRouter.sol in this
 *         repo — a first-party ABI, so there is nothing third-party to guess),
 *         and `amount` = the NATIVE msg.value. Returns a `challengeId`.
 *      2. (browser) runChallenge → Circle's PIN UI → Circle signs + broadcasts.
 *    The router's fee is deployed at ZERO, so the recipient still receives 100%.
 *    The amount is sent BOTH as calldata and as the native value; the router
 *    reverts unless they match exactly, so if Circle ever interpreted the value
 *    string in different units than we encoded, the transaction fails loudly
 *    instead of moving an unintended amount.
 *
 * B) PLAIN TRANSFER (router not configured) — today's shipped behaviour, kept as
 *    the fallback so a missing env var degrades to something that works rather
 *    than a Send button that can only fail:
 *      1. (server) action "createTransferChallenge" → Circle's verified
 *         /v1/w3s/user/transactions/transfer builds the transfer from structured
 *         inputs (walletId, tokenId, destinationAddress, amount) and returns a
 *         `challengeId`. Circle constructs the transfer itself — no hand-encoding.
 *      2. (browser) runChallenge, as above.
 *    The USDC token is identified by Circle's `tokenId` (read from the balances
 *    endpoint), so no USDC address is hardcoded. Amounts are passed as the same
 *    human-readable decimal string the balances endpoint reports.
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

  // Vector's Arc router, if configured. null = fall back to Circle's plain
  // transfer; never an error state, so Send works either way.
  const routerAddress = useMemo(() => vectorRouterAddress(), []);
  const routedThroughVector = routerAddress !== null;

  // The router moves NATIVE value, so it needs a positive balance rather than a
  // Circle `tokenId`. The transfer path needs the tokenId to name the asset.
  const hasSpendableBalance = balanceNum !== null && balanceNum > 0;
  const hasWhatThisPathNeeds = routedThroughVector
    ? hasSpendableBalance
    : !!tokenId;

  const canSend =
    recipientValid &&
    !isSelfSend &&
    amountValid &&
    !insufficient &&
    hasWhatThisPathNeeds &&
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
    ? explorerTxUrl(arcBridgeChainId(), sendTxHash)
    : explorerAddressUrl(arcBridgeChainId(), walletAddress);
  const explorerIsTx = sendTxHash != null;

  async function handleSend() {
    if (!canSend) return;
    if (!routedThroughVector && !tokenId) return;
    setError(null);
    setPhase("creating");
    try {
      // Step 1 — server creates the challenge over Circle's REST API. WHICH
      // challenge depends on whether Vector's router is configured: a contract
      // execution against the router (a real, attributable on-chain call), or
      // Circle's plain transfer as the fallback.
      const amountTrimmed = amount.trim();
      const body = routerAddress
        ? {
            action: "createContractExecutionChallenge",
            userToken: auth.userToken,
            walletId,
            contractAddress: routerAddress,
            callData: encodeVectorSend(
              recipientTrimmed as `0x${string}`,
              parseUnits(amountTrimmed, ARC_NATIVE_DECIMALS),
            ),
            // The NATIVE msg.value, as the same human-readable decimal string
            // every other Circle W3S amount field takes. The router requires
            // this to equal the amount in the calldata above, so a units
            // disagreement reverts instead of sending the wrong amount.
            amount: amountTrimmed,
          }
        : {
            action: "createTransferChallenge",
            userToken: auth.userToken,
            walletId,
            tokenId,
            destinationAddress: recipientTrimmed,
            amount: amountTrimmed,
          };

      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    <VectorModalShell title="Send USDC" onClose={onClose}>
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
                  {ARC_DISPLAY_NAME}
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

            {!hasWhatThisPathNeeds && !error && (
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
              {routedThroughVector
                ? " Routed on-chain through Vector — no fee, you send 100%."
                : ""}
            </p>
          </>
        )}
    </VectorModalShell>
  );
}
