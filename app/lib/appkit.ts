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
    ...(kitKey ? { config: { kitKey } } : {}),
  };

  return { kit, swapParams };
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
      config: swapParams.config ? { kitKey: "[redacted]" } : undefined,
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
