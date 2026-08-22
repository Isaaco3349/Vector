"use client";

import { useMemo, useState } from "react";
import { erc20Abi, isAddress, parseUnits } from "viem";
import {
  useAccount,
  useSendTransaction,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { bridgeChainByNumericId } from "../lib/bridge-chains";
import {
  VECTOR_ROUTER_ABI,
  vectorRouterAddress,
} from "../lib/vector-router";
import { useSendBalance } from "./useSendBalance";

const ARC_TESTNET_ID = 5042002;

/**
 * Send USDC panel for external (injected) wallets.
 *
 * Sends USDC on whatever chain the wallet is currently connected to:
 *  - Arc Testnet: USDC is the native gas asset. When Vector's router is
 *    configured (NEXT_PUBLIC_VECTOR_ROUTER_ARC) the send goes through
 *    `VectorRouter.send(to, amount)` — a real contract call that emits an
 *    indexable `VectorSend` event, with the router's fee deployed at ZERO so the
 *    recipient still receives 100%. Without the router configured it falls back
 *    to a plain native value transfer (today's shipped behaviour), so a missing
 *    env var can never produce a Send button that only fails.
 *  - Base / Ethereum Sepolia: USDC is an ERC-20 → a `transfer(to, amount)` call
 *    (already a contract call; the router is Arc-only and not used there).
 *
 * The chain, USDC address, decimals, and explorer URL all come from the same
 * verified registry the Bridge uses (app/lib/bridge-chains.ts) — nothing about
 * where funds go is guessed. Amounts are validated against the true on-chain
 * balance as integers (no float rounding) before anything is signed.
 *
 * Only renders for an external wallet; Google-login (W3S) sends take a
 * different, server-side path handled by its own panel (GoogleSendPanel).
 */
export function SendPanel({ onClose }: { onClose: () => void }) {
  const { address, isConnected, chainId } = useAccount();
  const chain = bridgeChainByNumericId(chainId);
  const balance = useSendBalance(chain);
  const { switchChain, isPending: switching } = useSwitchChain();

  // Vector's Arc router, if configured. null = fall back to a plain transfer;
  // it is never an error state, so Send always works either way.
  const routerAddress = useMemo(() => vectorRouterAddress(), []);
  const routedThroughVector =
    !!routerAddress && chain?.chainId === ARC_TESTNET_ID;

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const receipt = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    chainId: chain?.chainId,
    query: { enabled: !!txHash },
  });

  const recipientTrimmed = to.trim();
  const recipientValid = useMemo(
    () => isAddress(recipientTrimmed),
    [recipientTrimmed],
  );

  // Parse the amount to an integer in the token's smallest unit, using the
  // decimals actually read on-chain. null = not a valid positive amount yet.
  const parsed = useMemo(() => {
    if (balance.decimals === null) return null;
    const a = amount.trim();
    if (!a || Number(a) <= 0) return null;
    try {
      return parseUnits(a, balance.decimals);
    } catch {
      return null;
    }
  }, [amount, balance.decimals]);

  const insufficient = useMemo(() => {
    if (parsed === null || balance.raw === null) return false;
    return parsed > balance.raw;
  }, [parsed, balance.raw]);

  const explorerUrl =
    txHash && chain ? chain.explorerTx.replace("{hash}", txHash) : null;

  const sending = submitting || receipt.isLoading;

  const canSend =
    isConnected &&
    !!address &&
    !!chain &&
    recipientValid &&
    parsed !== null &&
    !insufficient &&
    !sending;

  async function handleSend() {
    if (!chain || parsed === null || !recipientValid) return;
    const recipient = recipientTrimmed as `0x${string}`;
    setSubmitting(true);
    setError(null);
    setTxHash(null);
    try {
      let hash: `0x${string}`;
      if (chain.usdcKind === "native") {
        const router = chain.chainId === ARC_TESTNET_ID ? routerAddress : null;
        if (router) {
          // Arc + router configured: a real contract call. `parsed` is passed
          // BOTH as the argument and as msg.value — the router reverts unless
          // they match, so a units bug can't move an unintended amount.
          hash = await writeContractAsync({
            address: router,
            abi: VECTOR_ROUTER_ABI,
            functionName: "send",
            args: [recipient, parsed],
            value: parsed,
            chainId: chain.chainId,
          });
        } else {
          // No router configured → plain native value transfer (shipped behaviour).
          hash = await sendTransactionAsync({
            to: recipient,
            value: parsed,
            chainId: chain.chainId,
          });
        }
      } else {
        // Base / Ethereum Sepolia: USDC is an ERC-20 → transfer().
        hash = await writeContractAsync({
          address: chain.usdcAddress!,
          abi: erc20Abi,
          functionName: "transfer",
          args: [recipient, parsed],
          chainId: chain.chainId,
        });
      }
      setTxHash(hash);
    } catch (err) {
      setError(
        readableError(err, "Send failed. No funds were moved if you rejected it."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!isConnected || !address) return null;

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

        {!chain ? (
          // Connected to a network Vector doesn't support — never guess how to
          // move funds there. Offer a switch to Arc instead.
          <div className="text-center py-4">
            <p className="text-[13px] text-[var(--vector-text-dim)] mb-5 leading-relaxed">
              You&apos;re on a network Vector doesn&apos;t support for sending yet.
              Switch to Arc Testnet, Base Sepolia, or Ethereum Sepolia.
            </p>
            <button
              onClick={() => switchChain({ chainId: ARC_TESTNET_ID })}
              disabled={switching}
              className="w-full h-[48px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[14px] disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {switching ? "Switching…" : "Switch to Arc Testnet"}
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
                  {chain.label}
                </span>
              </div>
              <input
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="0x… recipient address"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full bg-transparent text-[15px] font-mono outline-none placeholder:text-[var(--vector-line)] break-all"
              />
              {recipientTrimmed.length > 0 && !recipientValid && (
                <p className="mt-2 text-[11px] text-[var(--vector-pink)] font-mono">
                  That doesn&apos;t look like a valid address.
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
                className="w-full bg-transparent text-[28px] font-semibold outline-none placeholder:text-[var(--vector-line)]"
              />
              <div className="flex items-center justify-between mt-2 text-[11px] text-[var(--vector-text-dim)] font-mono">
                <span>
                  {balance.isLoading
                    ? "Balance: …"
                    : balance.formatted !== null
                      ? `Balance: ${balance.formatted} USDC`
                      : "Balance: —"}
                </span>
                {balance.formatted !== null && Number(balance.formatted) > 0 && (
                  <button
                    onClick={() => setAmount(balance.formatted as string)}
                    className="text-[var(--vector-pink)] hover:opacity-80 transition-opacity uppercase tracking-wide"
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
                Amount exceeds your USDC balance on {chain.label}.
              </p>
            )}

            {txHash && explorerUrl && (
              <div className="mb-4">
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[13px] text-[var(--vector-pink)] font-mono underline break-all"
                >
                  {receipt.isSuccess
                    ? "Sent ✓ — view on explorer ↗"
                    : "Submitted — view on explorer ↗"}
                </a>
                {receipt.isLoading && (
                  <p className="mt-2 text-[11px] text-[var(--vector-text-dim)] font-mono">
                    Waiting for confirmation…
                  </p>
                )}
              </div>
            )}

            <button
              onClick={handleSend}
              disabled={!canSend}
              className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
            >
              {submitting
                ? "Confirm in your wallet…"
                : receipt.isLoading
                  ? "Confirming…"
                  : "Send USDC"}
            </button>

            {chain.usdcKind === "native" ? (
              <p className="mt-4 text-[11px] leading-relaxed text-[var(--vector-text-dim)] text-center">
                On Arc, gas is paid in USDC — leave a little for the network fee.
                {routedThroughVector
                  ? " Routed on-chain through Vector — no fee, you send 100%."
                  : ""}
              </p>
            ) : (
              <p className="mt-4 text-[11px] leading-relaxed text-[var(--vector-text-dim)] text-center">
                Sending USDC on {chain.label} needs a little ETH for gas.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function readableError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    if (/reject|denied|user cancel|user rejected/i.test(err.message)) {
      return "You cancelled the request in your wallet.";
    }
    if (/insufficient funds/i.test(err.message)) {
      return "Not enough balance to cover the amount plus gas.";
    }
    if (/chain mismatch|does not match/i.test(err.message)) {
      return "Your wallet is on a different network. Switch and try again.";
    }
    // VectorRouter's own custom errors — translate them instead of leaking a
    // raw revert string. ValueMismatch is the units guard firing: nothing moved.
    if (/ValueMismatch/.test(err.message)) {
      return "Amount check failed on Vector's router, so nothing was sent. Please try again.";
    }
    if (/PayoutFailed/.test(err.message)) {
      return "The recipient rejected the transfer, so nothing was sent.";
    }
    if (/ZeroAmount|ZeroAddress/.test(err.message)) {
      return "Check the recipient and amount — nothing was sent.";
    }
    // viem messages can be long; take the first line for the UI.
    return err.message.split("\n")[0];
  }
  if (typeof err === "string") return err;
  return fallback;
}
