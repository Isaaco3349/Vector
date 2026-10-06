"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import {
  estimateDeposit,
  estimateWithdraw,
  executeDeposit,
  executeWithdraw,
  getEarnPosition,
  listArcVaults,
  type EarnExecution,
  type EarnPosition,
  type EarnQuote,
  type EarnVault,
} from "../lib/earn";
import { arcBridgeChainId, bridgeChainById } from "../lib/bridge-chains";
import { chainId as ARC_CHAIN_ID, displayName as ARC_DISPLAY_NAME } from "../lib/network";
import { useSendBalance } from "./useSendBalance";
import { useWalletSigningProviderRef } from "./useWalletSigningProvider";

/**
 * Earn panel for external (injected) wallets — deposit USDC into an Arc yield vault.
 *
 * Vaults are DISCOVERED from Circle's Earn service (never hardcoded), so the
 * list reflects what actually exists; if none are available the panel says so
 * rather than inventing one. Deposits/withdrawals run same-chain on Arc, so the
 * wallet must be connected to the configured Arc network — if it isn't, the panel offers to
 * switch instead of guessing.
 *
 * Like Swap/Bridge, Earn uses Circle's viem browser adapter, which only works
 * with an external wallet. The Google-login (W3S) case has its own panel
 * (GoogleEarnPanel), which routes deposit/withdraw through Circle's challenge
 * flow instead.
 */
export function EarnPanel({ onClose }: { onClose: () => void }) {
  const { address, isConnected, chainId, connector } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const onArc = chainId === ARC_CHAIN_ID;
  const arcChain = useMemo(() => bridgeChainById(arcBridgeChainId()), []);
  const usdc = useSendBalance(arcChain);

  const [vaults, setVaults] = useState<EarnVault[] | null>(null);
  const [vaultsLoading, setVaultsLoading] = useState(false);
  const [vaultsError, setVaultsError] = useState<string | null>(null);

  const [selected, setSelected] = useState<EarnVault | null>(null);
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");

  const [position, setPosition] = useState<EarnPosition | null>(null);
  const [quote, setQuote] = useState<EarnQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { providerRef, ready: providerReady } =
    useWalletSigningProviderRef(connector);

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

  const refreshPosition = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider || !selected) return;
    try {
      const pos = await getEarnPosition({
        provider,
        vaultAddress: selected.vaultAddress,
      });
      setPosition(pos);
    } catch (err) {
      // A read failure shouldn't block depositing — surface nothing, log it.
      console.error("[Vector] getEarnPosition failed:", err);
      setPosition(null);
    }
  }, [selected]);

  // Load the position whenever a vault is selected (and a provider is ready).
  useEffect(() => {
    setPosition(null);
    if (selected) void refreshPosition();
  }, [selected, refreshPosition]);

  const parsedAmount = useMemo(() => {
    const a = amount.trim();
    const n = Number(a);
    return a && Number.isFinite(n) && n > 0 ? a : null;
  }, [amount]);

  // Balance/limit for the active mode: wallet USDC for deposit, position for withdraw.
  const maxForMode =
    mode === "deposit" ? usdc.formatted : position?.currentBalance ?? null;

  const overMax = useMemo(() => {
    if (!parsedAmount || maxForMode === null) return false;
    const a = Number(parsedAmount);
    const m = Number(maxForMode);
    return Number.isFinite(a) && Number.isFinite(m) && a > m;
  }, [parsedAmount, maxForMode]);

  // Debounced quote whenever amount / mode / vault settles.
  useEffect(() => {
    setTxHash(null);
    setExplorerUrl(null);
    if (!selected || !parsedAmount || overMax) {
      setQuote(null);
      return;
    }
    if (!providerReady) return;
    const provider = providerRef.current;
    if (!provider) {
      setError("No wallet provider available. Reconnect and try again.");
      return;
    }
    let cancelled = false;
    setQuoting(true);
    setError(null);
    const handle = setTimeout(async () => {
      try {
        const fn = mode === "deposit" ? estimateDeposit : estimateWithdraw;
        const q = await fn({
          provider,
          vaultAddress: selected.vaultAddress,
          amount: parsedAmount,
        });
        if (!cancelled) setQuote(q);
      } catch (err) {
        if (!cancelled) {
          setQuote(null);
          setError(readableError(err, "Couldn't get a quote for that amount."));
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [selected, parsedAmount, mode, overMax, providerReady]);

  async function handleSubmit() {
    const provider = providerRef.current;
    if (!provider || !selected || !parsedAmount || overMax) return;
    setSubmitting(true);
    setError(null);
    setTxHash(null);
    setExplorerUrl(null);
    try {
      const fn = mode === "deposit" ? executeDeposit : executeWithdraw;
      const result: EarnExecution = await fn({
        provider,
        vaultAddress: selected.vaultAddress,
        amount: parsedAmount,
      });
      setTxHash(result.txHash);
      setExplorerUrl(result.explorerUrl);
      if (!result.txHash) {
        setError(
          `${mode === "deposit" ? "Deposit" : "Withdrawal"} submitted, but no transaction hash came back. Check your wallet activity to confirm.`,
        );
      } else {
        setAmount("");
        void refreshPosition();
      }
    } catch (err) {
      setError(
        readableError(
          err,
          `${mode === "deposit" ? "Deposit" : "Withdrawal"} failed. No funds moved if you rejected it.`,
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!isConnected || !address) return null;

  const canSubmit =
    onArc && !!selected && !!parsedAmount && !overMax && !submitting && !quoting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-t-3xl sm:rounded-3xl border border-[var(--vector-line)] bg-[var(--vector-surface)] p-6 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            {selected && (
              <button
                onClick={() => {
                  setSelected(null);
                  setAmount("");
                  setQuote(null);
                  setError(null);
                }}
                className="text-[var(--vector-text-dim)] text-[13px] hover:text-[var(--vector-text)]"
                aria-label="Back to vaults"
              >
                ‹ Vaults
              </button>
            )}
            <span className="text-[17px] font-semibold">
              {selected ? "Earn" : "Earn — Arc vaults"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--vector-text-dim)] text-[13px] hover:text-[var(--vector-text)]"
          >
            Close
          </button>
        </div>

        {!selected ? (
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
                <span className="text-[15px] font-semibold">{selected.name}</span>
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
                    setQuote(null);
                    setError(null);
                  }}
                  className={`h-[40px] rounded-full text-[13px] font-semibold capitalize transition-colors ${
                    mode === m
                      ? "bg-[var(--vector-pink)] text-[#0b0b0e]"
                      : "bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] text-[var(--vector-text-dim)] hover:text-[var(--vector-text)]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {!onArc ? (
              <div className="text-center py-4">
                <p className="text-[13px] text-[var(--vector-text-dim)] mb-5 leading-relaxed">
                  Earn deposits and withdrawals run on {ARC_DISPLAY_NAME}. Switch your
                  wallet to Arc to continue.
                </p>
                <button
                  onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
                  disabled={switching}
                  className="w-full h-[48px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[14px] disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {switching ? "Switching…" : `Switch to ${ARC_DISPLAY_NAME}`}
                </button>
              </div>
            ) : (
              <>
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
                    onChange={(e) =>
                      setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                    }
                    className="w-full bg-transparent text-[28px] font-semibold outline-none placeholder:text-[var(--vector-line)]"
                  />
                  <div className="flex items-center justify-between mt-2 text-[11px] text-[var(--vector-text-dim)] font-mono">
                    <span>
                      {mode === "deposit"
                        ? usdc.isLoading
                          ? "Balance: …"
                          : usdc.formatted !== null
                            ? `Balance: ${usdc.formatted} USDC`
                            : "Balance: —"
                        : `In vault: ${position?.currentBalance ?? "0"} USDC`}
                    </span>
                    {maxForMode !== null && Number(maxForMode) > 0 && (
                      <button
                        onClick={() => setAmount(maxForMode as string)}
                        className="text-[var(--vector-pink)] hover:opacity-80 transition-opacity uppercase tracking-wide"
                      >
                        Max
                      </button>
                    )}
                  </div>
                </div>

                {quote && (quote.expectedText || quote.feeText) && (
                  <div className="text-[12px] text-[var(--vector-text-dim)] font-mono mb-4 space-y-1">
                    {quote.expectedText && <div>{quote.expectedText}</div>}
                    {quote.feeText && <div>Fee: {quote.feeText}</div>}
                  </div>
                )}

                {overMax && (
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

                {txHash && explorerUrl && (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-[13px] text-[var(--vector-pink)] font-mono mb-4 underline break-all"
                  >
                    {mode === "deposit" ? "Deposited" : "Withdrawn"} ✓ — view on
                    ArcScan ↗
                  </a>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
                >
                  {submitting
                    ? "Confirm in your wallet…"
                    : quoting
                      ? "Getting quote…"
                      : mode === "deposit"
                        ? "Deposit USDC"
                        : "Withdraw USDC"}
                </button>

                <p className="mt-4 text-[11px] leading-relaxed text-[var(--vector-text-dim)] text-center">
                  Runs on {ARC_DISPLAY_NAME} through Circle&apos;s Earn. Gas is paid in
                  USDC — leave a little for the network fee.
                </p>
              </>
            )}
          </div>
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
    if (/insufficient funds|insufficient balance/i.test(err.message)) {
      return "Not enough balance to cover the amount plus gas.";
    }
    if (/chain mismatch|does not match/i.test(err.message)) {
      return "Your wallet is on a different network. Switch to Arc and try again.";
    }
    return err.message.split("\n")[0];
  }
  if (typeof err === "string") return err;
  return fallback;
}
