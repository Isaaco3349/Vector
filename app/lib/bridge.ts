"use client";

/**
 * Isolated Circle App Kit integration (Bridge / CCTP v2).
 *
 * Companion to app/lib/appkit.ts (Swap). Everything version-sensitive about the
 * App Kit *bridge* surface lives here, so the UI depends on a small stable local
 * interface (`estimateBridge` / `executeBridge`) rather than on SDK internals.
 *
 * WHAT THIS DOES
 * A bridge is a CCTP v2 cross-chain USDC transfer: burn on the source chain,
 * mint on the destination. App Kit handles all of that; we hand it a source
 * chain, a destination chain, an amount, and the connected wallet's provider.
 *
 * WHY ONE ADAPTER FOR BOTH LEGS
 * `@circle-fin/adapter-viem-v2`'s provider adapter is chain-agnostic — a single
 * instance wraps the wallet and lazily builds a client per chain. So the SAME
 * adapter is passed as both `from.adapter` and `to.adapter`; the chain is chosen
 * per-call via `from.chain` / `to.chain`. (Confirmed in the adapter's
 * index.d.mts: ViemAdapterOptions exposes per-chain getPublicClient/getWalletClient.)
 *
 * WHY useForwarder: true
 * With the forwarder on, Circle's Orbit relayer submits the destination mint, so
 * the wallet only signs the burn on the source chain — no mid-flow network
 * switch. Every chain in our registry has `cctp.forwarderSupported.destination:
 * true` (verified in @circle-fin/app-kit/chains.d.mts), so this is safe for all
 * of them. If a caller ever targets a destination that doesn't support it, we
 * omit the flag and let the adapter switch chains for a wallet-signed mint.
 *
 * Verified SDK shapes (node_modules/@circle-fin/app-kit/index.d.mts):
 *  - kit.estimateBridge(params): Promise<EstimateResult>  (@27972)
 *  - kit.bridge(params): Promise<BridgeResult>            (@27909)
 *  - BridgeResult.state: 'pending'|'success'|'error'      (@10294)
 *  - BridgeResult.steps: BridgeStep[]                     (@10329)
 *  - BridgeStep.txHash? / .explorerUrl? / .state          (@10219)
 *  - EstimateResult.fees[] {type,token,amount} + .gasFees[] {name,token,blockchain,fees} (@10348)
 *
 * Loaded via dynamic import() so these packages only enter the bundle when a
 * user opens Bridge, mirroring appkit.ts.
 */

import type { Eip1193Provider } from "./appkit";
import { bridgeCustomFeeForAmount } from "./fees";
import { formatUnits } from "viem";
import {
  bridgeChainById,
  explorerTxUrl,
  type BridgeChainId,
} from "./bridge-chains";

export type { Eip1193Provider };

export type BridgeArgs = {
  provider: Eip1193Provider;
  fromChain: BridgeChainId;
  toChain: BridgeChainId;
  /** Human-readable USDC amount, e.g. "1.00" — App Kit takes it as a string. */
  amount: string;
};

export type BridgeQuote = {
  /** The amount App Kit echoes back for the transfer (USDC), or null. */
  amount: string | null;
  /** Summarised protocol/relayer fees (USDC), or null if none reported. */
  feeText: string | null;
  /** Summarised source-chain gas estimate, or null if unavailable. */
  gasText: string | null;
  /** The raw estimate payload — always kept, never hidden, so nothing is faked. */
  raw: unknown;
};

export type BridgeExecution = {
  /** Source-chain (burn) tx hash, best-effort from BridgeResult.steps. */
  txHash: string | null;
  /** Explorer link for the source tx — SDK-provided if present, else built from our registry. */
  explorerUrl: string | null;
  /** Reported terminal state of the bridge. */
  state: "pending" | "success" | "error" | null;
  /**
   * Whatever Circle actually said about the failure, dug out of the result's
   * steps. Null when the SDK reported an error state but gave no reason.
   *
   * This exists because the panel used to answer every `state === "error"` with
   * one fixed sentence claiming Circle had reported a failure AND that no funds
   * moved. The first half discarded the only information that could explain the
   * failure; the second half was an assertion we cannot make, since a bridge
   * that fails after the burn has very much moved funds.
   */
  failureDetail: string | null;
  /** The raw BridgeResult — always kept. */
  raw: unknown;
};

/**
 * Same export-name resolution as appkit.ts: the viem provider-adapter factory
 * is `createViemAdapterFromProvider` in current versions, `createAdapterFromProvider`
 * in older ones. Resolve whichever the installed version actually exports rather
 * than betting on one.
 */
function resolveProviderAdapterFactory(
  mod: Record<string, unknown>,
): (arg: { provider: Eip1193Provider }) => unknown | Promise<unknown> {
  const candidates = [
    "createViemAdapterFromProvider",
    "createAdapterFromProvider",
  ];
  for (const name of candidates) {
    const fn = mod[name];
    if (typeof fn === "function") {
      return fn as (arg: {
        provider: Eip1193Provider;
      }) => unknown | Promise<unknown>;
    }
  }
  throw new Error(
    "Circle viem adapter: no provider-adapter factory found (looked for " +
      `${candidates.join(", ")}). Check your @circle-fin/adapter-viem-v2 version.`,
  );
}

type BridgeKit = {
  estimateBridge: (p: unknown) => Promise<unknown>;
  bridge: (p: unknown) => Promise<unknown>;
};

async function buildKitAndParams(args: BridgeArgs) {
  const from = bridgeChainById(args.fromChain);
  const to = bridgeChainById(args.toChain);
  if (!from) throw new Error(`Unsupported source chain: ${args.fromChain}`);
  if (!to) throw new Error(`Unsupported destination chain: ${args.toChain}`);
  if (from.appKitChain === to.appKitChain) {
    throw new Error("Choose two different chains to bridge between.");
  }

  const appKitMod = (await import("@circle-fin/app-kit")) as Record<
    string,
    unknown
  >;
  const adapterMod = (await import("@circle-fin/adapter-viem-v2")) as Record<
    string,
    unknown
  >;

  const AppKit = appKitMod.AppKit as new () => BridgeKit;
  if (typeof AppKit !== "function") {
    throw new Error("@circle-fin/app-kit did not export `AppKit`.");
  }

  const makeAdapter = resolveProviderAdapterFactory(adapterMod);
  // One chain-agnostic adapter instance serves BOTH legs of the bridge.
  const adapter = await makeAdapter({ provider: args.provider });

  const kit = new AppKit();

  // Only enable the forwarder when the destination genuinely supports it.
  // (All chains in our registry do; this guard keeps us honest if that ever
  // changes or a new chain is added without forwarder destination support.)
  const useForwarder = to.forwarderDestination === true;

  const bridgeParams = {
    from: {
      adapter,
      chain: from.appKitChain,
      // address omitted — user-controlled adapters resolve it from the wallet.
    },
    to: {
      adapter,
      chain: to.appKitChain,
      ...(useForwarder ? { useForwarder: true } : {}),
    },
    amount: args.amount,
    token: "USDC" as const,
    config: {
      ...bridgeCustomFeeForAmount(args.amount),
    },
  };

  return { kit, bridgeParams, from, to, useForwarder };
}

/** Summarise EstimateResult.fees[] — { type, token, amount } (amount may be null). */
function formatBridgeFees(fees: unknown): string | null {
  if (!Array.isArray(fees) || fees.length === 0) return null;
  const parts: string[] = [];
  for (const entry of fees) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const amount = rec.amount;
    if (typeof amount !== "string" || !amount) continue;
    const token = typeof rec.token === "string" ? rec.token : "";
    const type = typeof rec.type === "string" ? rec.type : "fee";
    parts.push(`${type}: ${amount}${token ? ` ${token}` : ""}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Summarise the source-chain gas fee from EstimateResult.gasFees[].
 * gasFees[].fees is EstimatedGas { gas, gasPrice, fee } where `fee` is total wei
 * (string). All three of our chains use an 18-decimal native currency, so we can
 * format honestly; if the shape isn't recognised we return null rather than guess.
 */
function formatSourceGas(
  gasFees: unknown,
  sourceChainId: BridgeChainId,
): string | null {
  if (!Array.isArray(gasFees) || gasFees.length === 0) return null;
  const source = bridgeChainById(sourceChainId);
  // gasFees entries carry a `blockchain` (Blockchain enum ~ the App Kit chain
  // string). Prefer the entry matching our source chain; fall back to the first
  // entry that has a usable fee.
  const candidates = gasFees.filter(
    (e) => e && typeof e === "object",
  ) as Record<string, unknown>[];
  const match =
    candidates.find(
      (e) => String(e.blockchain ?? "") === (source?.appKitChain ?? ""),
    ) ?? candidates[0];
  if (!match) return null;
  const feesObj = match.fees;
  if (!feesObj || typeof feesObj !== "object") return null;
  const feeWei = (feesObj as Record<string, unknown>).fee;
  const token = typeof match.token === "string" ? match.token : "";
  if (typeof feeWei !== "string" || feeWei.length === 0) return null;
  try {
    // 18-decimal native currency across our whole registry; format honestly via
    // viem rather than fixed-point math, then trim to 6 dp for display.
    const human = formatUnits(BigInt(feeWei), 18);
    const n = Number(human);
    const shown = Number.isFinite(n)
      ? n.toLocaleString("en-US", { maximumFractionDigits: 6, useGrouping: false })
      : human;
    return `~${shown}${token ? ` ${token}` : ""}`;
  } catch {
    return null;
  }
}

/** Estimate a bridge without executing it. Surfaces fees + gas for confirmation. */
export async function estimateBridge(args: BridgeArgs): Promise<BridgeQuote> {
  const { kit, bridgeParams } = await buildKitAndParams(args);
  if (typeof console !== "undefined") {
    console.log("[Vector] estimateBridge params:", {
      ...bridgeParams,
      from: { chain: bridgeParams.from.chain, adapter: "[ViemAdapter]" },
      to: {
        chain: bridgeParams.to.chain,
        adapter: "[ViemAdapter]",
        useForwarder: (bridgeParams.to as { useForwarder?: boolean }).useForwarder,
      },
    });
  }
  let estimate: unknown;
  try {
    estimate = await kit.estimateBridge(bridgeParams);
  } catch (err) {
    console.error("[Vector] estimateBridge threw:", err);
    throw err;
  }
  if (typeof console !== "undefined") {
    console.log("[Vector] estimateBridge raw result:", estimate);
  }

  const rec =
    estimate && typeof estimate === "object"
      ? (estimate as Record<string, unknown>)
      : null;
  const amount = typeof rec?.amount === "string" ? rec.amount : null;

  return {
    amount,
    feeText: formatBridgeFees(rec?.fees),
    gasText: formatSourceGas(rec?.gasFees, args.fromChain),
    raw: estimate,
  };
}

/**
 * Pull the source (burn) tx hash + explorer link out of a BridgeResult.
 * steps[] runs source→destination; the burn step is the first with a real
 * txHash and a non-noop state. Prefer the SDK's own explorerUrl when present.
 */
function extractSourceTx(
  result: unknown,
  fromChain: BridgeChainId,
): { txHash: string | null; explorerUrl: string | null } {
  if (!result || typeof result !== "object") {
    return { txHash: null, explorerUrl: null };
  }
  const steps = (result as Record<string, unknown>).steps;
  if (!Array.isArray(steps)) return { txHash: null, explorerUrl: null };
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const rec = step as Record<string, unknown>;
    const txHash = rec.txHash;
    const state = rec.state;
    if (typeof txHash === "string" && txHash.length > 0 && state !== "noop") {
      const sdkUrl =
        typeof rec.explorerUrl === "string" && rec.explorerUrl.length > 0
          ? rec.explorerUrl
          : null;
      return {
        txHash,
        explorerUrl: sdkUrl ?? explorerTxUrl(fromChain, txHash),
      };
    }
  }
  return { txHash: null, explorerUrl: null };
}

/**
 * Dig the human-readable reason out of a failed BridgeResult.
 *
 * The SDK does not document one canonical field, so this reads the candidates it
 * is known to use, in order of specificity, across both the top-level result and
 * each step. Anything unrecognised yields null rather than a guess — a wrong
 * explanation is worse than an honest "no reason given".
 */
function extractFailureDetail(result: unknown): string | null {
  const readFrom = (rec: Record<string, unknown>): string | null => {
    for (const key of ["detail", "message", "reason", "error"]) {
      const v = rec[key];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
      // `error` is sometimes an object/Error rather than a string.
      if (v && typeof v === "object") {
        const nested = v as Record<string, unknown>;
        for (const nk of ["detail", "message", "reason"]) {
          const nv = nested[nk];
          if (typeof nv === "string" && nv.trim().length > 0) return nv.trim();
        }
      }
    }
    return null;
  };

  if (!result || typeof result !== "object") return null;
  const top = result as Record<string, unknown>;

  // Prefer a failing STEP's reason — it names the leg that broke — then fall
  // back to anything on the result itself.
  const steps = top.steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      const rec = step as Record<string, unknown>;
      if (rec.state !== "error") continue;
      const detail = readFrom(rec);
      if (detail) return detail;
    }
  }
  return readFrom(top);
}

/** Execute the bridge. Returns best-effort source tx + state, plus raw result. */
export async function executeBridge(args: BridgeArgs): Promise<BridgeExecution> {
  const { kit, bridgeParams } = await buildKitAndParams(args);
  const result = await kit.bridge(bridgeParams);

  const { txHash, explorerUrl } = extractSourceTx(result, args.fromChain);
  const rawState =
    result && typeof result === "object"
      ? (result as Record<string, unknown>).state
      : null;
  const state =
    rawState === "pending" || rawState === "success" || rawState === "error"
      ? rawState
      : null;

  if (state === "error") {
    // Keep the whole object in the console: the extractor only knows the fields
    // it knows, and this is the artifact worth having when it comes back null.
    console.error("[Vector] bridge reported an error state. Raw result:", result);
  }

  return {
    txHash,
    explorerUrl,
    state,
    failureDetail: state === "error" ? extractFailureDetail(result) : null,
    raw: result,
  };
}
