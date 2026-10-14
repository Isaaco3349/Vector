"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useSwitchChain } from "wagmi";
import {
  flushBalancesAfterSwap,
  scheduleBalancePoll,
} from "../lib/balance-refresh";
import {
  estimateBridge,
  executeBridge,
  type BridgeQuote,
  type Eip1193Provider,
} from "../lib/bridge";
import {
  BRIDGE_CHAINS,
  bridgeChainById,
  defaultBridgeFromChain,
  defaultBridgeToChain,
  explorerAddressUrl,
  bridgeRouteUsesLifi,
  type BridgeChainId,
} from "../lib/bridge-chains";
import { getProviderChainId } from "../lib/appkit";
import { switchConnectedWalletToArc } from "../lib/switch-to-arc";
import {
  bridgeAmountExceedsUsdcBalance,
  bridgeMaxAmountHumanFromBalanceBaseUnits,
  bridgePlatformFeeBaseUnitsForRoute,
  bridgePlatformFeeHumanForRoute,
  formatBridgeFeeLabelForRoute,
} from "../lib/fees";
import { TxSuccessCard } from "./TxSuccessCard";
import { isOkxWallet } from "../lib/wallet-brand";
import { useWalletSigningProviderRef } from "./useWalletSigningProvider";
import {
  friendlyBridgeFailureMessage,
  friendlyWalletError,
} from "../lib/wallet-errors";
import { useBridgeBalance } from "./useBridgeBalance";
import { VectorModalShell } from "./VectorModalShell";
import { logVectorActivity } from "../lib/record-vector-activity";

function isArcBridgeChain(id: BridgeChainId): boolean {
  return id === "Arc" || id === "Arc_Testnet";
}

/**
 * Bridge panel (CCTP v2) for external (injected) wallets.
 *
 * Moves USDC cross-chain across the nine verified CCTP testnets in
 * bridge-chains.ts via Circle's App Kit.
 *
 * ── THE CHAIN GUARD (do not remove) ───────────────────────────────────────────
 * `useForwarder: true` means Circle's relayer performs the DESTINATION mint, so
 * the wallet never has to switch to the destination. It does NOT excuse the
 * source side: a CCTP bridge begins with a burn transaction on the source chain,
 * and a wallet sitting on a different chain cannot sign it.
 *
 * This panel previously had no chain check at all, which produced a reproducible
 * failure: bridge Arc → somewhere (wallet ends up on Arc), then select a
 * non-Arc source and bridge again. `estimateBridge` still succeeded — it is
 * read-only and builds its own public client per chain, so fees rendered
 * normally — and only `kit.bridge()` failed, surfacing as "Circle reported the
 * bridge didn't go through". Circle was not the problem; the wallet was on the
 * wrong network.
 *
 * So the source chain is enforced twice, mirroring SwapPanel:
 *   1. `needsChainSwitch` replaces the action button with a switch prompt, so a
 *      bridge that cannot be signed is never offered.
 *   2. `handleBridge` re-reads the chain from the provider immediately before
 *      executing and refuses on a mismatch — the state could be stale, and
 *      nothing should be sent on a guess.
 * Both ask the PROVIDER (`getProviderChainId`) rather than wagmi, because the
 * two disagree when several wallet extensions are installed.
 *
 * Mirrors SwapPanel: same modal shell, debounced quoting, honest error/tx
 * surfacing. Only renders when an external wallet is the active connection
 * (Google-login wallets take a different, server-side path — GoogleBridgePanel).
 */
export function BridgePanel({ onClose }: { onClose: () => void }) {
  const { address, isConnected, connector, chainId: wagmiChainId } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();

  const [fromChain, setFromChain] = useState<BridgeChainId>(defaultBridgeFromChain());
  const [toChain, setToChain] = useState<BridgeChainId>(defaultBridgeToChain());
  const [amount, setAmount] = useState("");
  const [debouncedAmount, setDebouncedAmount] = useState("");

  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [bridging, setBridging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txUrl, setTxUrl] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const [activityUrl, setActivityUrl] = useState<string | null>(null);
  /**
   * The chain the WALLET reports being on. Null means "not yet known" — which is
   * deliberately different from "wrong", so an unreadable provider can't produce
   * a misleading switch prompt.
   */
  const [walletChainId, setWalletChainId] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const balanceFrom = useBridgeBalance(fromChain);

  const syncBalancesAfterBridge = useCallback(
    async (txHash: string | null) => {
      const srcChainId = bridgeChainById(fromChain)?.chainId;
      await flushBalancesAfterSwap(
        queryClient,
        txHash,
        [
          async () => {
            await balanceFrom.refetch();
          },
        ],
        srcChainId,
      );
    },
    [queryClient, fromChain, balanceFrom.refetch],
  );
  const burnOnArc = isArcBridgeChain(fromChain);

  /**
   * The numeric id of the chain the burn has to be signed on. Comes from the
   * verified registry, so the switch prompt can't target a chain that isn't
   * registered in wagmi-config (BridgeChainNumericId is a literal union of
   * exactly the registered ids).
   */
  const sourceChainId = bridgeChainById(fromChain)?.chainId ?? null;

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
    const id = await getProviderChainId(provider, wagmiChainId);
    setWalletChainId(id);
    return id;
  }, [wagmiChainId]);

  useEffect(() => {
    if (!providerReady) return;
    const provider = providerRef.current;
    if (!provider) return;
    let cancelled = false;
    void (async () => {
      const id = await getProviderChainId(provider, wagmiChainId);
      if (!cancelled) setWalletChainId(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [connector, wagmiChainId, providerReady, providerRef]);

  useEffect(() => {
    if (!providerReady) return;
    void refreshWalletChain();
  }, [fromChain, providerReady, refreshWalletChain]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedAmount(amount.trim());
    }, 480);
    return () => window.clearTimeout(handle);
  }, [amount]);

  const parsedAmount = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const parsedAmountForQuote = useMemo(() => {
    const n = Number(debouncedAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [debouncedAmount]);

  const sameChain = fromChain === toChain;

  const fromMeta = useMemo(() => bridgeChainById(fromChain), [fromChain]);
  const toMeta = useMemo(() => bridgeChainById(toChain), [toChain]);
  const routePlatformFeeBase = useMemo(
    () => bridgePlatformFeeBaseUnitsForRoute(fromMeta, toChain),
    [fromMeta, toChain],
  );
  const routePlatformFeeHuman = useMemo(
    () => bridgePlatformFeeHumanForRoute(fromMeta, toChain),
    [fromMeta, toChain],
  );

  const maxBridgeableHuman = useMemo(() => {
    if (balanceFrom.balanceBaseUnits === null) return null;
    return bridgeMaxAmountHumanFromBalanceBaseUnits(
      balanceFrom.balanceBaseUnits,
      routePlatformFeeBase,
    );
  }, [balanceFrom.balanceBaseUnits, routePlatformFeeBase]);

  const insufficient = useMemo(() => {
    if (!amount.trim() || balanceFrom.balanceBaseUnits === null) return false;
    return bridgeAmountExceedsUsdcBalance(
      amount,
      balanceFrom.balanceBaseUnits,
      routePlatformFeeBase,
    );
  }, [amount, balanceFrom.balanceBaseUnits, routePlatformFeeBase]);

  const insufficientMessage = useMemo(() => {
    if (!insufficient) return null;
    const bal = balanceFrom.formatted ?? "—";
    const max = maxBridgeableHuman;
    if (max) {
      const feeLine = `Vector's $${routePlatformFeeHuman} bridge fee`;
      return `Your ${chainLabel(fromChain)} wallet must cover the bridge amount plus ${feeLine} (${bal} USDC on file). Max bridgeable: ${trimBridgeHint(max)} USDC — try MAX or a smaller amount.`;
    }
    return "Amount exceeds your USDC balance on the source chain (including Vector's bridge fee).";
  }, [
    insufficient,
    balanceFrom.formatted,
    maxBridgeableHuman,
    fromChain,
    routePlatformFeeHuman,
  ]);

  // Only claim the wallet is on the wrong chain once it has actually told us.
  // A null answer means "unknown", which is not the same as "wrong" — the
  // pre-flight check in handleBridge refuses to sign on an unknown chain
  // anyway, so an unreadable provider can't turn into a misleading prompt here.
  const needsChainSwitch =
    walletChainId !== null &&
    sourceChainId !== null &&
    walletChainId !== sourceChainId;

  // Debounced quoting whenever inputs settle.
  useEffect(() => {
    if (txHash || bridging) return;
    setPendingNote(null);
    setActivityUrl(null);
    if (sameChain) {
      setQuote(null);
      setError("Choose two different chains.");
      return;
    }
    if (!parsedAmountForQuote) {
      setQuote(null);
      setQuoting(false);
      if (!parsedAmount) setError(null);
      return;
    }
    if (insufficient) {
      setQuote(null);
      setQuoting(false);
      setError(insufficientMessage);
      return;
    }
    if (!providerReady) return;
    const provider = providerRef.current;
    if (!provider) {
      setError("No wallet provider available. Reconnect your wallet and try again.");
      return;
    }

    let cancelled = false;
    setQuoting(true);
    setError(null);
    void (async () => {
      try {
        const q = await estimateBridge({
          provider,
          fromChain,
          toChain,
          amount: String(parsedAmountForQuote),
        });
        if (!cancelled) setQuote(q);
      } catch (err) {
        if (!cancelled) {
          setQuote(null);
          setError(
            friendlyWalletError(err, "Couldn't estimate this bridge route."),
          );
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    parsedAmount,
    parsedAmountForQuote,
    fromChain,
    toChain,
    sameChain,
    insufficient,
    insufficientMessage,
    providerReady,
    txHash,
    bridging,
    providerRef,
  ]);

  /**
   * Move the wallet to the SOURCE chain, so the burn can be signed. Unlike
   * SwapPanel this target is dynamic — it's whichever chain is selected as the
   * source, taken from the verified registry rather than hand-typed.
   */
  async function handleSwitch() {
    if (sourceChainId === null) return;
    setError(null);
    const provider = providerRef.current;
    let switchError: unknown = null;
    try {
      if (burnOnArc && provider) {
        await switchConnectedWalletToArc(provider);
      } else {
        await switchChainAsync({ chainId: sourceChainId });
      }
    } catch (err) {
      switchError = err;
    }
    // Judge success by what the wallet now reports, not by whether the call
    // resolved. Some wallets resolve the request and stay put.
    const id = await refreshWalletChain();
    if (id === sourceChainId) return;
    if (switchError) {
      setError(
        friendlyWalletError(
          switchError,
          `Couldn't switch networks. Switch to ${chainLabel(fromChain)} in your wallet, then try again.`,
        ),
      );
      return;
    }
    setError(
      "Your wallet still reports a different network. If you have more than one wallet extension enabled, switch networks in the one Vector is connected to.",
    );
  }

  async function handleBridge() {
    const provider = providerRef.current;
    if (!provider || !parsedAmount || sameChain || insufficient) return;
    if (
      sourceChainId !== null &&
      walletChainId !== null &&
      walletChainId !== sourceChainId
    ) {
      return;
    }
    setBridging(true);
    setError(null);
    setTxHash(null);
    setTxUrl(null);
    setPendingNote(null);
    setActivityUrl(null);
    try {
      // A bridge's first move is a burn on the SOURCE chain, and a wallet on
      // another chain cannot sign it. Ask the wallet where it is right now —
      // not when the panel opened — and refuse rather than raise a request that
      // could only fail. This is the check whose absence made a non-Arc bridge
      // fail with "Circle reported the bridge didn't go through".
      const liveChainId = await getProviderChainId(provider, wagmiChainId);
      setWalletChainId(liveChainId);
      if (liveChainId !== sourceChainId) {
        setError(null);
        return;
      }
      const result = await executeBridge({
        provider,
        fromChain,
        toChain,
        amount: String(parsedAmount),
        useSequentialTransactions: true,
      });
      setTxHash(result.txHash);
      setTxUrl(result.explorerUrl);
      if (result.txHash) {
        const src = bridgeChainById(fromChain);
        if (src) {
          logVectorActivity({
            walletAddress: address,
            txHash: result.txHash,
            kind: "bridge",
            chainId: src.chainId,
            chainLabel: chainLabel(fromChain),
            detail: `${chainLabel(fromChain)} → ${chainLabel(toChain)}`,
          });
        }
        setError(null);
        setAmount("");
        void syncBalancesAfterBridge(result.txHash);
      } else if (result.state !== "error") {
        scheduleBalancePoll(queryClient);
      }
      if (result.state === "error") {
        setError(
          friendlyBridgeFailureMessage(result.failureDetail, {
            burnSubmitted: Boolean(result.txHash),
            fromChainLabel: chainLabel(fromChain),
          }),
        );
      } else if (!result.txHash) {
        // bridge() resolved without error, so the burn was submitted — the SDK
        // just hasn't handed back a source hash yet. That is NOT a failure, so
        // show a calm note (not an alarming red error) and point at the wallet's
        // activity on the source chain, matching the Google wallet's UX.
        setPendingNote(
          "Bridge submitted. Circle is still finalizing the source transaction — it'll show in your wallet activity shortly, and the destination mint follows within a few minutes.",
        );
        if (address) setActivityUrl(explorerAddressUrl(fromChain, address));
      } else if (result.state !== "success") {
        // Burn is on-chain; the destination mint (via the relayer) can still be
        // in flight. Say so honestly rather than implying instant completion.
        setPendingNote(
          "Burn confirmed on the source chain. The destination mint is handled by Circle's relayer and usually lands within a few minutes.",
        );
      }
    } catch (err) {
      setError(
        friendlyWalletError(
          err,
          "Bridge didn't complete. Nothing was sent if you cancelled.",
        ),
      );
    } finally {
      setBridging(false);
    }
  }

  function flip() {
    setFromChain(toChain);
    setToChain(fromChain);
    setQuote(null);
    // Drop any message from the previous direction — including a stale
    // wrong-network error, which the switch prompt below now supersedes.
    setError(null);
    setPendingNote(null);
  }

  if (!isConnected || !address) {
    return null;
  }

  return (
    <VectorModalShell title="Bridge USDC" onClose={onClose}>
        {/* From chain + amount */}
        <div className="vector-input-panel p-4 mb-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] text-[var(--vector-text-dim)]">From</span>
            <ChainSelect value={fromChain} onChange={setFromChain} />
          </div>
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="w-full bg-transparent text-[28px] font-semibold outline-none placeholder:text-[var(--vector-line)]"
          />
          <BalanceRow
            label="Balance"
            balance={balanceFrom.formatted}
            isLoading={balanceFrom.isLoading}
            symbol="USDC"
            onMax={
              balanceFrom.balanceBaseUnits !== null
                ? () => {
                    const max = bridgeMaxAmountHumanFromBalanceBaseUnits(
                      balanceFrom.balanceBaseUnits as bigint,
                      routePlatformFeeBase,
                    );
                    if (max) setAmount(trimBridgeHint(max));
                  }
                : undefined
            }
          />
          {!balanceFrom.isLoading &&
            balanceFrom.formatted === null &&
            !isArcBridgeChain(fromChain) && (
              <p className="mt-1 text-[10px] leading-snug text-[var(--vector-pink)]">
                Couldn&apos;t read USDC on {chainLabel(fromChain)}. Reconnect
                your wallet or try again in a moment.
              </p>
            )}
          {burnOnArc && balanceFrom.arcWalletDesync && (
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--vector-pink)]">
              Wallet shows token USDC but not Arc gas USDC — on Arc they are one
              balance. Re-add Arc in OKX/MetaMask or switch networks, then retry.
            </p>
          )}
        </div>

        {/* Flip */}
        <div className="flex justify-center -my-2 relative z-10">
          <button
            onClick={flip}
            className="w-9 h-9 rounded-full border border-[var(--vector-line)] bg-[var(--vector-surface)] flex items-center justify-center hover:border-[var(--vector-pink)] transition-colors"
            aria-label="Flip chains"
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

        {/* To chain */}
        <div className="vector-input-panel p-4 mt-1 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] text-[var(--vector-text-dim)]">To</span>
            <ChainSelect value={toChain} onChange={setToChain} />
          </div>
          <div className="text-[28px] font-semibold text-[var(--vector-text)]">
            {quoting ? (
              <span className="text-[var(--vector-text-dim)] text-[20px]">
                Estimating…
              </span>
            ) : quote?.amount ? (
              quote.amount
            ) : (
              <span className="text-[var(--vector-line)]">0.00</span>
            )}{" "}
            <span className="text-[16px] text-[var(--vector-text-dim)] font-mono">
              USDC
            </span>
          </div>
          <p className="mt-2 text-[11px] text-[var(--vector-text-dim)] font-mono">
            Received on {chainLabel(toChain)}
          </p>
        </div>

        {/* Quote detail */}
        {(quote || amount.trim()) && (
          <div className="text-[12px] text-[var(--vector-text-dim)] font-mono mb-4 space-y-1">
            {bridgeRouteUsesLifi(fromMeta, toMeta) ? (
              <div>
                BNB Chain uses LI.FI (not Circle CCTP). Circle CCTP fees do not
                apply — see LI.FI quote below.
              </div>
            ) : (
              <div>{formatBridgeFeeLabelForRoute(fromMeta, toChain)}</div>
            )}
            {quote?.feeText &&
              bridgeRouteUsesLifi(fromMeta, toMeta) && (
                <div>{quote.feeText}</div>
              )}
          </div>
        )}

        {txHash && !error && (
          <TxSuccessCard
            title="Bridge successful"
            txHash={txHash}
            explorerUrl={txUrl}
            subtitle={
              pendingNote ??
              "Circle's relayer completes the mint on the destination chain — usually within a few minutes."
            }
            onDismiss={() => {
              setTxHash(null);
              setTxUrl(null);
              setPendingNote(null);
              setActivityUrl(null);
            }}
          />
        )}

        {error && !txHash && (
          <p className="text-[13px] text-[var(--vector-pink)] font-mono mb-4">{error}</p>
        )}

        {pendingNote && !txHash && (
          <p className="text-[12px] text-[var(--vector-text-dim)] font-mono mb-4 leading-relaxed">
            {pendingNote}
          </p>
        )}

        {activityUrl && (
          <a
            href={activityUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[13px] text-[var(--vector-pink)] font-mono mb-4 underline break-all"
          >
            View your wallet on the {chainLabel(fromChain)} explorer ↗
          </a>
        )}

        {needsChainSwitch ? (
          <div>
            <p className="text-[12px] text-[var(--vector-text-dim)] leading-relaxed mb-3 text-center">
              CCTP burns USDC on <span className="font-semibold">{chainLabel(fromChain)}</span> first.
              Your wallet is still on{" "}
              {walletChainId === 5042 || walletChainId === 5042002 ? (
                <span className="font-semibold">Arc</span>
              ) : (
                <span className="font-mono">chain {walletChainId}</span>
              )}
              . Tap below to switch to {chainLabel(fromChain)} — nothing has been sent yet.
            </p>
            <button
              onClick={handleSwitch}
              disabled={switching}
              className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
            >
              {switching ? "Switching…" : `Switch to ${chainLabel(fromChain)}`}
            </button>
          </div>
        ) : (
          <button
            onClick={handleBridge}
            disabled={
              bridging ||
              quoting ||
              !quote?.amount ||
              sameChain ||
              !parsedAmount ||
              insufficient
            }
            className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
          >
            {bridging
              ? "Bridging…"
              : quoting
                ? "Estimating…"
                : `Bridge to ${chainLabel(toChain)}`}
          </button>
        )}

        {okxWallet && (
          <p className="mt-3 text-[11px] text-center text-[var(--vector-text-dim)]">
            Using OKX — choose <span className="font-semibold">OKX Wallet</span>{" "}
            at connect if you run multiple extensions.
          </p>
        )}
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

function ChainSelect({
  value,
  onChange,
}: {
  value: BridgeChainId;
  onChange: (v: BridgeChainId) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BridgeChainId)}
      className="bg-[var(--vector-surface)] border border-[var(--vector-line)] rounded-full px-3 py-1.5 text-[13px] font-semibold text-[var(--vector-text)] outline-none hover:border-[var(--vector-pink)] transition-colors cursor-pointer"
    >
      {BRIDGE_CHAINS.map((c) => (
        <option
          key={c.appKitChain}
          value={c.appKitChain}
          className="bg-[var(--vector-surface)]"
        >
          {c.label}
        </option>
      ))}
    </select>
  );
}

function chainLabel(id: BridgeChainId): string {
  return BRIDGE_CHAINS.find((c) => c.appKitChain === id)?.label ?? id;
}

/** Short human amount for inputs and hints (up to 6 dp, no trailing zeros). */
function trimBridgeHint(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n
    .toLocaleString("en-US", { maximumFractionDigits: 6, useGrouping: false })
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

