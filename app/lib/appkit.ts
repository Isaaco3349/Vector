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
  /**
   * Maximum acceptable slippage, in basis points.
   *
   * Copied from the installed SDK's `SwapConfig.slippageBps`, documented there
   * as "1 BPS = 0.01%, so 300 BPS = 3% slippage. Defaults to 300 BPS (3%)."
   *
   * Left undefined we get Circle's 3% default. It is raised only when the user
   * explicitly asks for a looser tolerance after the SDK has told us the
   * slippage constraint is what blocked the swap — a wider tolerance means
   * accepting a worse price, so it is never widened on the user's behalf.
   */
  slippageBps?: number;
};

/** Circle's documented default slippage tolerance (SwapConfig.slippageBps). */
export const DEFAULT_SLIPPAGE_BPS = 300;

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

  // These are all fields of the SDK's `SwapConfig` (verified in app-kit's
  // swap.d.mts: `kitKey?: string`, `allowanceStrategy?: 'permit' | 'approve'`,
  // `slippageBps?: number`), so they belong inside one `config` object rather
  // than at the top level. Only keys we actually have are set — passing an
  // explicit `undefined` would override the SDK's own default instead of
  // deferring to it.
  const config: {
    kitKey?: string;
    allowanceStrategy?: "permit" | "approve";
    slippageBps?: number;
  } = {};
  if (kitKey) config.kitKey = kitKey;
  if (args.allowanceStrategy) config.allowanceStrategy = args.allowanceStrategy;
  if (typeof args.slippageBps === "number" && Number.isFinite(args.slippageBps)) {
    config.slippageBps = args.slippageBps;
  }
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

/**
 * What actually went wrong with a swap, as Circle itself classified it.
 *
 * Distinguishing these matters because the advice differs completely:
 * "unsupported-route" is permanent (the SDK marks it FATAL), while
 * "slippage" and "insufficient-liquidity" are both retryable but need
 * *different* remedies — a looser tolerance versus a smaller size or more
 * time. Collapsing them into one "no liquidity, try later" message tells
 * users to wait for something that may never arrive, and hides the one knob
 * that would have worked.
 */
export type SwapErrorKind =
  | "user-cancelled"
  | "chain-mismatch"
  | "permit-generation"
  | "unsupported-route"
  | "unsupported-token"
  | "slippage"
  | "insufficient-liquidity"
  | "amount-out-of-range"
  | "rate-limited"
  | "network"
  | "service"
  | "unknown";

export type SwapErrorInfo = {
  kind: SwapErrorKind;
  /** The SDK's own error name, e.g. "INPUT_UNSUPPORTED_ROUTE". */
  name: string | null;
  /** The SDK's own numeric code, e.g. 1003. */
  code: number | null;
  /** "FATAL" | "RETRYABLE" as the SDK reported it — never inferred by us. */
  recoverability: string | null;
  /** The SDK's message, kept verbatim so nothing is hidden from the user. */
  detail: string | null;
  /** Amount bounds, when Circle attached them (amount-range errors). */
  minAmount: string | null;
  maxAmount: string | null;
  amountToken: string | null;
};

/**
 * Circle's `KitError` carries `name`, `code`, `type` and `recoverability` as
 * enumerable readonly properties (verified in app-kit's KitError constructor),
 * and App Kit rethrows provider errors unchanged — `withErrorTelemetry` logs and
 * then `throw error`s the original — so these fields survive all the way out to
 * a caller. That makes them a far better signal than the message prose.
 *
 * Both tables are transcribed from the SDK's own error registries (InputError,
 * LiquidityError, ServiceError, NetworkError, RateLimitError). Name is checked
 * first because a string is the more stable identifier; the code table is a
 * cross-check for anything that renames.
 *
 * `INPUT_VALIDATION_FAILED` (1098) is deliberately absent: it is the SDK's
 * generic bucket, and the permit-generation guard throws it, so it has to fall
 * through to the message checks below to be told apart from real validation
 * problems.
 */
const KIND_BY_ERROR_NAME: Record<string, SwapErrorKind> = {
  INPUT_USER_CANCELLED: "user-cancelled",
  INPUT_NETWORK_MISMATCH: "chain-mismatch",
  INPUT_CHAIN_MISMATCH: "chain-mismatch",
  INPUT_CHAIN_SWITCH_REJECTED: "chain-mismatch",
  INPUT_UNRECOGNIZED_CHAIN: "chain-mismatch",
  INPUT_UNSUPPORTED_ROUTE: "unsupported-route",
  INPUT_UNSUPPORTED_TOKEN: "unsupported-token",
  INPUT_SLIPPAGE_CONSTRAINT_NOT_MET: "slippage",
  INPUT_INSUFFICIENT_SWAP_AMOUNT: "amount-out-of-range",
  INPUT_AMOUNT_OUT_OF_RANGE: "amount-out-of-range",
  INPUT_INVALID_AMOUNT: "amount-out-of-range",
  LIQUIDITY_INSUFFICIENT: "insufficient-liquidity",
  RATE_LIMIT_EXCEEDED: "rate-limited",
  NETWORK_CONNECTION_FAILED: "network",
  NETWORK_TIMEOUT: "network",
  SERVICE_INTERNAL_ERROR: "service",
  SERVICE_UNKNOWN_ERROR: "service",
};

const KIND_BY_ERROR_CODE: Record<number, SwapErrorKind> = {
  1001: "chain-mismatch",
  1002: "amount-out-of-range",
  1003: "unsupported-route",
  1006: "unsupported-token",
  1007: "amount-out-of-range",
  1009: "slippage",
  1010: "chain-mismatch",
  1011: "chain-mismatch",
  1012: "chain-mismatch",
  1013: "amount-out-of-range",
  1099: "user-cancelled",
  3001: "network",
  3002: "network",
  6001: "insufficient-liquidity",
  7001: "rate-limited",
  8001: "service",
  8002: "service",
};

/**
 * Circle attaches amount bounds at `cause.trace.{minAmount,maxAmount,token}`
 * when the service rejects a size (verified in the SDK's 400/503 handlers,
 * which build that trace from `extractAmountError`). Read defensively — every
 * field is optional and this is only ever used to make a message more specific.
 */
function readAmountBounds(cause: unknown): {
  minAmount: string | null;
  maxAmount: string | null;
  amountToken: string | null;
} {
  const empty = { minAmount: null, maxAmount: null, amountToken: null };
  if (!cause || typeof cause !== "object") return empty;
  const trace = (cause as Record<string, unknown>).trace;
  if (!trace || typeof trace !== "object") return empty;
  const rec = trace as Record<string, unknown>;
  const str = (v: unknown): string | null => {
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return null;
  };
  return {
    minAmount: str(rec.minAmount),
    maxAmount: str(rec.maxAmount),
    amountToken: str(rec.token),
  };
}

/**
 * Classify a swap failure using Circle's structured error fields, falling back
 * to message inspection only for errors that aren't Circle's — a wallet
 * rejection, or the chain mismatch that arrives nested inside the SDK's generic
 * permit-generation error.
 */
export function classifySwapError(err: unknown): SwapErrorInfo {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const rec =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;

  const name = typeof rec?.name === "string" ? rec.name : null;
  const code = typeof rec?.code === "number" ? rec.code : null;
  const recoverability =
    typeof rec?.recoverability === "string" ? rec.recoverability : null;

  let kind: SwapErrorKind =
    (name ? KIND_BY_ERROR_NAME[name] : undefined) ??
    (code !== null ? KIND_BY_ERROR_CODE[code] : undefined) ??
    "unknown";

  if (kind === "unknown" && message) {
    if (/reject|denied|user cancel/i.test(message)) {
      kind = "user-cancelled";
    } else if (
      // Checked before the permit case on purpose: this text arrives *inside*
      // the permit-generation message, and it is the actionable half.
      /must match the active chain|does not match the target chain|chain mismatch/i.test(
        message,
      )
    ) {
      kind = "chain-mismatch";
    } else if (/permit generation (failed|returned null)/i.test(message)) {
      kind = "permit-generation";
    }
  }

  return {
    kind,
    name,
    code,
    recoverability,
    detail: message.length > 0 ? message : null,
    ...readAmountBounds(rec?.cause),
  };
}
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
