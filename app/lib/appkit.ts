"use client";

/**
 * Isolated Circle App Kit integration (Swap).
 *
 * Everything version-sensitive or not-fully-documented about the App Kit SDK
 * surface lives in this one module, so the rest of Vector depends on a small,
 * stable local interface (`estimateSwap` / `executeSwap`) rather than on SDK
 * internals. If Circle renames an export or shifts a return shape, this file
 * is the only thing that changes.
 *
 * Requires (install before running — these are NOT yet in package.json):
 *   npm install @circle-fin/app-kit @circle-fin/adapter-viem-v2
 *
 * They're pulled in via dynamic import() so they only enter the browser bundle
 * when a user actually opens Swap — the login/wallet path stays lean, and if
 * the packages aren't installed yet the app still boots (Swap just errors when
 * opened, instead of white-screening everything).
 *
 * Why client-side? Circle's docs say App Kit runs "server-side only" — but that
 * caution is about the private-key and Circle-Wallets adapters, which hold
 * secrets. The browser-wallet adapter (`createViemAdapterFromProvider`) is the
 * documented exception: it wraps a *connected* wallet's EIP-1193 provider,
 * which only exists in the browser. Swap `config.kitKey` is optional (the SDK
 * runs in permissionless mode without it) but recommended for production rate
 * limits — wire via `NEXT_PUBLIC_KIT_KEY` or a server proxy, never hardcode.
 *
 * Chain requirement, learned from the adapter's own source: Circle's viem
 * adapter deliberately defers `wallet_switchEthereumChain` until execution
 * ("Chain switching is deferred to execute() via sendTransaction() to avoid
 * triggering wallet_switchEthereumChain during preparation" —
 * adapter-viem-v2). But a swap asks the wallet for an EIP-2612 permit
 * signature *before* it sends any transaction, and a wallet sitting on another
 * chain rejects a signature whose domain names a chain it isn't on. So the
 * caller must already be on Arc before `executeSwap` — never assume the SDK
 * will move the wallet there. `getProviderChainId` below is how a caller
 * checks, and it asks the wallet rather than trusting local state.
 */

export type Eip1193Provider = {
  request: (args: {
    method: string;
    params?: unknown[] | object;
  }) => Promise<unknown>;
};

export type SwapArgs = {
  provider: Eip1193Provider;
  tokenIn: string;
  tokenOut: string;
  /** Human-readable amount, e.g. "1.00" — App Kit takes it as a string. */
  amountIn: string;
  /** Optional kit key. Omitted on the public testnet tier; wire in server-side for production. */
  kitKey?: string;
  /**
   * How the swap contract is granted its allowance.
   *
   * Copied verbatim from the installed SDK rather than invented: App Kit's
   * `SwapConfig.allowanceStrategy?: 'permit' | 'approve'`, documented there as
   * "Defaults to 'permit' with fallback to 'approve'".
   *
   * Left undefined we get the default, gasless EIP-2612 permit — one wallet
   * confirmation, no approval transaction. Passing "approve" forces a real
   * on-chain approval instead: an extra transaction and extra gas, but it only
   * needs a plain signature from the wallet. That is the documented escape
   * hatch when a wallet or token can't produce a permit signature.
   */
  allowanceStrategy?: "permit" | "approve";
};

export type SwapQuote = {
  /** Best-effort estimated output amount, or null if the field name isn't recognised. */
  amountOut: string | null;
  /** Best-effort exchange rate. */
  rate: string | null;
  /** Best-effort fee description. */
  feeText: string | null;
  /** The raw estimate payload — always kept, never hidden, so nothing is faked. */
  raw: unknown;
};

export type SwapResult = {
  txHash: string | null;
  raw: unknown;
};

// Arc Testnet identifier as expected by App Kit's `from.chain` (per the Arc
// docs same-chain swap quickstart).
const ARC_TESTNET_CHAIN = "Arc_Testnet";

/**
 * The viem provider-adapter export name is in transition across SDK versions
 * (`createViemAdapterFromProvider` in newer docs, `createAdapterFromProvider`
 * in others). Rather than bet on one, resolve whichever the installed version
 * actually exports.
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

/** Resolve optional kit key — explicit arg wins, then NEXT_PUBLIC_KIT_KEY. */
function resolveKitKey(explicit?: string): string | undefined {
  if (explicit) return explicit;
  const fromEnv = process.env.NEXT_PUBLIC_KIT_KEY;
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

async function buildKitAndParams(args: SwapArgs) {
  // Dynamically imported so they only load when Swap is opened, and so the app
  // still boots if they're not installed yet. Note: these specifiers resolve
  // only AFTER `npm install @circle-fin/app-kit @circle-fin/adapter-viem-v2`
  // — until then your editor/tsc will flag them as missing, which is expected.
  const appKitMod = (await import("@circle-fin/app-kit")) as Record<
    string,
    unknown
  >;
  const adapterMod = (await import("@circle-fin/adapter-viem-v2")) as Record<
    string,
    unknown
  >;

  const AppKit = appKitMod.AppKit as new () => {
    estimateSwap: (p: unknown) => Promise<unknown>;
    swap: (p: unknown) => Promise<unknown>;
  };
  if (typeof AppKit !== "function") {
    throw new Error("@circle-fin/app-kit did not export `AppKit`.");
  }

  const makeAdapter = resolveProviderAdapterFactory(adapterMod);
  const adapter = await makeAdapter({ provider: args.provider });

  const kit = new AppKit();

  const kitKey = resolveKitKey(args.kitKey);

  // Both of these are fields of the SDK's `SwapConfig` (verified in app-kit's
  // swap.d.mts: `kitKey?: string` and `allowanceStrategy?: 'permit' |
  // 'approve'`), so they belong inside one `config` object rather than at the
  // top level. Only keys we actually have are set — passing an explicit
  // `undefined` would override the SDK's own default instead of deferring to it.
  const config: { kitKey?: string; allowanceStrategy?: "permit" | "approve" } =
    {};
  if (kitKey) config.kitKey = kitKey;
  if (args.allowanceStrategy) config.allowanceStrategy = args.allowanceStrategy;
  const hasConfig = Object.keys(config).length > 0;

  const swapParams = {
    from: {
      adapter,
      chain: ARC_TESTNET_CHAIN,
      // address is intentionally omitted — user-controlled adapters resolve it
      // from the connected wallet (AdapterContext + AddressField typing).
    },
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn: args.amountIn,
    ...(hasConfig ? { config } : {}),
  };

  return { kit, swapParams };
}

/**
 * The chain the wallet is ACTUALLY on, asked of the wallet itself via the
 * EIP-1193 `eth_chainId` method (a hex quantity, e.g. "0x4cef52").
 *
 * Why not wagmi's `useAccount().chainId`? Because that is wagmi's view of its
 * own connection, while Swap hands the raw provider to Circle's adapter. The
 * two can disagree — a second wallet extension owning `window.ethereum`, or a
 * `chainChanged` event that never reached wagmi — and it is the wallet, not
 * wagmi, that rejects a signature meant for a different chain. Asking the
 * provider directly is the one answer that cannot drift.
 *
 * Returns null rather than throwing when the wallet won't say: callers treat
 * "unknown" as "don't sign anything", which is the safe direction.
 */
export async function getProviderChainId(
  provider: Eip1193Provider,
): Promise<number | null> {
  try {
    const raw = await provider.request({ method: "eth_chainId" });
    if (typeof raw === "string") {
      // parseInt handles the "0x" prefix; base 16 is explicit for clarity.
      const parsed = Number.parseInt(raw, 16);
      return Number.isFinite(parsed) ? parsed : null;
    }
    // Some providers answer with a number instead of a hex string.
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    return null;
  } catch (err) {
    console.error("[Vector] eth_chainId request failed:", err);
    return null;
  }
}

/**
 * True when a swap failed while producing the gasless permit signature, rather
 * than while moving money.
 *
 * Matched against the installed SDK's own wording, which is either
 * "Permit generation failed: <cause>. No on-chain approval was sent because the
 * permit flow was expected to succeed. Retry or use allowanceStrategy:
 * \"approve\" to force on-chain approval." or "Permit generation returned null
 * despite adapter passing capability checks." — both thrown from the same guard
 * in app-kit's swap module.
 *
 * The reason this is worth detecting: that guard exists precisely because the
 * SDK skipped the on-chain approval in expectation of a permit, so it can state
 * that nothing was approved and nothing was spent. Retrying the same swap with
 * `allowanceStrategy: "approve"` is therefore safe — it is a first attempt at
 * moving funds, not a second.
 */
export function isPermitGenerationFailure(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  return /permit generation (failed|returned null)/i.test(message);
}

/** SwapEstimate.estimatedOutput / TokenAmount — { token, amount } both strings. */
function readTokenAmount(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const amount = rec.amount;
  if (typeof amount === "string" && amount.length > 0) return amount;
  if (typeof amount === "number" && Number.isFinite(amount)) return String(amount);
  return null;
}

/** SwapEstimate.fees — readonly ServiceSwapFee[] with { token, amount, type }. */
function formatSwapFees(fees: unknown): string | null {
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

function pickString(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Quote a swap without executing it. Maps the installed SDK's SwapEstimate
 * shape (`estimatedOutput.amount`, nested fees array) — see @circle-fin/app-kit
 * SwapEstimate / TokenAmount types.
 */
export async function estimateSwap(args: SwapArgs): Promise<SwapQuote> {
  const { kit, swapParams } = await buildKitAndParams(args);
  if (typeof console !== "undefined") {
    console.log("[Vector] estimateSwap params:", {
      ...swapParams,
      from: { chain: ARC_TESTNET_CHAIN, adapter: "[ViemAdapter]" },
      config: swapParams.config
        ? {
            ...swapParams.config,
            ...(swapParams.config.kitKey ? { kitKey: "[redacted]" } : {}),
          }
        : undefined,
    });
  }
  let estimate: unknown;
  try {
    estimate = await kit.estimateSwap(swapParams);
  } catch (err) {
    console.error("[Vector] estimateSwap threw:", err);
    throw err;
  }
  if (typeof console !== "undefined") {
    console.log("[Vector] estimateSwap raw result:", estimate);
  }

  const rec =
    estimate && typeof estimate === "object"
      ? (estimate as Record<string, unknown>)
      : null;
  const amountOut = readTokenAmount(rec?.estimatedOutput);
  const amountIn =
    typeof rec?.amountIn === "string" ? rec.amountIn : args.amountIn;

  let rate: string | null = null;
  if (amountOut && amountIn) {
    const inN = Number(amountIn);
    const outN = Number(amountOut);
    if (Number.isFinite(inN) && inN > 0 && Number.isFinite(outN)) {
      rate = `1 ${args.tokenIn} ≈ ${(outN / inN).toFixed(6)} ${args.tokenOut}`;
    }
  }

  return {
    amountOut,
    rate,
    feeText: formatSwapFees(rec?.fees),
    raw: estimate,
  };
}

/** Execute the swap. Returns a best-effort tx hash plus the raw result. */
export async function executeSwap(args: SwapArgs): Promise<SwapResult> {
  const { kit, swapParams } = await buildKitAndParams(args);
  const result = await kit.swap(swapParams);

  return {
    txHash: pickString(result, [
      "txHash",
      "transactionHash",
      "hash",
      "txId",
      "transactionId",
    ]),
    raw: result,
  };
}
