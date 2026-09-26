"use client";

/**
 * Isolated Circle Earn integration (yield vaults on Arc Testnet).
 *
 * Companion to app/lib/appkit.ts (Swap) and app/lib/bridge.ts (Bridge). Everything
 * version-sensitive about the `@circle-fin/earn-kit` surface lives here, so the UI
 * depends on a small, stable local interface (listArcVaults / getEarnPosition /
 * estimateDeposit / executeDeposit / estimateWithdraw / executeWithdraw) instead of
 * SDK internals. If Circle shifts a field name or return shape, this file is the
 * only thing that changes.
 *
 * WHAT THIS DOES
 * Earn lets a user deposit USDC into a yield-bearing vault and withdraw later.
 * This module covers the SAME-CHAIN flow on Arc Testnet (wallet on Arc → Arc
 * vault): the simplest, fully-verified path, which returns a real tx hash +
 * explorer URL immediately. Cross-chain deposits (bridging Base/Ethereum Sepolia
 * USDC into an Arc vault) are a deliberate follow-up — they add ERC-3009 signing,
 * a fee cap, and async bridge-status polling.
 *
 * NOTHING IS GUESSED
 *  - Vault addresses are DISCOVERED via `exploreVaults` from Circle's service —
 *    never hardcoded. A wrong vault address could send real test funds nowhere.
 *  - Amounts are passed as human-readable decimal STRINGS ("100.50"); the SDK
 *    scales them by the token's decimals. We never do fixed-point math here.
 *
 * SAME ADAPTER AS SWAP/BRIDGE → EXTERNAL WALLET ONLY
 * EarnKit takes `from: { adapter, chain }` where `adapter` is the
 * `@circle-fin/adapter-viem-v2` viem adapter (identical AdapterCapabilities to
 * Swap/Bridge). It wraps a connected wallet's EIP-1193 provider, so — exactly
 * like Swap/Bridge — it drives an EXTERNAL wallet and cannot drive the
 * Google-login (W3S) wallet. The UI gates the Google case honestly.
 *
 * Verified against installed first-party types (node_modules/@circle-fin/earn-kit
 * @v1.5.0 index.d.mts):
 *  - new EarnKit()                                            (@6164; config optional)
 *  - exploreVaults({chain,asset,sortBy,config}) → {vaults[]}  (@5464 params, @5962 result)
 *  - getPosition({from:{adapter,chain},vaultAddress}) → {currentBalance,shares,…}  (@5513/@5982)
 *  - getDepositQuote({from,vaultAddress,amount}) → {deposit,expectedShares,fees[],gasFees?}  (@5791/@6026)
 *  - deposit(sameChain) → {txHash,explorerUrl,vaultAddress,amount}  (@5589 / EarnSameChainDepositResult)
 *  - getWithdrawalQuote(...) → {withdrawal,sharesToRedeem,maxWithdrawable,fees[]}  (@6037)
 *  - withdraw({from,vaultAddress,amount}) → {txHash,explorerUrl,vaultAddress,amount}  (@5742 / EarnWithdrawResult)
 *  - EarnAssetAmount = {symbol:string, amount:string}         (@ EarnAssetAmount)
 *
 * Requires (installed in node_modules but NOT yet declared in package.json):
 *   npm install @circle-fin/earn-kit
 * Loaded via dynamic import() so it only enters the bundle when a user opens Earn,
 * mirroring appkit.ts / bridge.ts.
 */

import type { Eip1193Provider } from "./appkit";
import { arcBridgeChainId, explorerTxUrl } from "./bridge-chains";
import { EarnChain } from "@circle-fin/app-kit";
import { isMainnet } from "./network";

const ARC_CHAIN = isMainnet ? EarnChain.Arc : EarnChain.Arc_Testnet;

export type { Eip1193Provider };

/** A yield vault on Arc, in the small shape the UI needs. `raw` is always kept. */
export type EarnVault = {
  name: string;
  protocol: string;
  /** On-chain vault address to pass back into deposit / withdraw / getPosition. */
  vaultAddress: string;
  asset: string;
  /** Net APY as a decimal (0.085 = 8.5%), or null if not reported. */
  apy: number | null;
  /** Pre-formatted APY like "8.50%", or null. */
  apyText: string | null;
  /** Total deposits (human-readable), or null. */
  tvlText: string | null;
  /** Available liquidity (human-readable), or null. */
  liquidityText: string | null;
  raw: unknown;
};

/** The connected wallet's position in a single vault. */
export type EarnPosition = {
  /** Withdrawable balance (human-readable), or null when none / unreadable. */
  currentBalance: string | null;
  /** Vault shares held (human-readable), or null. */
  shares: string | null;
  raw: unknown;
};

/** A deposit or withdrawal preview. */
export type EarnQuote = {
  /** Headline preview line, e.g. "≈ 100.00 vault shares" or "≈ 50.00 USDC out". */
  expectedText: string | null;
  /** Summarised fees, or null when none reported. */
  feeText: string | null;
  raw: unknown;
};

/** The result of a submitted deposit / withdrawal. */
export type EarnExecution = {
  txHash: string | null;
  explorerUrl: string | null;
  raw: unknown;
};

/**
 * The viem provider-adapter factory name is in transition across SDK versions
 * (`createViemAdapterFromProvider` current, `createAdapterFromProvider` older).
 * Resolve whichever the installed version exports rather than betting on one —
 * identical to appkit.ts / bridge.ts.
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

/** Minimal view of the EarnKit methods we actually call. */
type EarnKitInstance = {
  exploreVaults: (p: unknown) => Promise<unknown>;
  getPosition: (p: unknown) => Promise<unknown>;
  getDepositQuote: (p: unknown) => Promise<unknown>;
  getWithdrawalQuote: (p: unknown) => Promise<unknown>;
  deposit: (p: unknown) => Promise<unknown>;
  withdraw: (p: unknown) => Promise<unknown>;
};

async function loadEarnKit(): Promise<EarnKitInstance> {
  // Resolves only AFTER `npm install @circle-fin/earn-kit`; until then tsc/editor
  // will flag it missing, which is expected.
  const mod = (await import("@circle-fin/earn-kit")) as Record<string, unknown>;
  const EarnKit = mod.EarnKit as (new () => EarnKitInstance) | undefined;
  if (typeof EarnKit !== "function") {
    throw new Error("@circle-fin/earn-kit did not export `EarnKit`.");
  }
  return new EarnKit();
}

async function buildAdapter(provider: Eip1193Provider): Promise<unknown> {
  const mod = (await import("@circle-fin/adapter-viem-v2")) as Record<
    string,
    unknown
  >;
  const makeAdapter = resolveProviderAdapterFactory(mod);
  return makeAdapter({ provider });
}

/** Attach `config: { kitKey }` only when a key is available. */
function withConfig<T extends object>(
  params: T,
  kitKey?: string,
): T & { config?: { kitKey: string } } {
  const key = resolveKitKey(kitKey);
  return key ? { ...params, config: { kitKey: key } } : params;
}

// ---------------------------------------------------------------------------
// Defensive result parsing — read only fields verified in the SDK types, keep
// `raw` on everything, and return null rather than invent a value.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(obj: unknown, keys: string[]): string | null {
  const rec = asRecord(obj);
  if (!rec) return null;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** EarnAssetAmount = { symbol: string, amount: string }. */
function formatAssetAmount(value: unknown): string | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const amount = typeof rec.amount === "string" ? rec.amount : null;
  if (!amount) return null;
  const symbol = typeof rec.symbol === "string" ? rec.symbol : "";
  return symbol ? `${amount} ${symbol}` : amount;
}

/** Join a fees array (EarnAssetAmount[]) into one line, or null if empty. */
function formatFees(fees: unknown): string | null {
  if (!Array.isArray(fees) || fees.length === 0) return null;
  const parts: string[] = [];
  for (const entry of fees) {
    const line = formatAssetAmount(entry);
    if (line && line !== "0" && !/^0(\.0+)?\s/.test(line)) parts.push(line);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function mapVault(raw: unknown): EarnVault | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  // `address` is the current primary; `vaultAddress` is the deprecated alias.
  const vaultAddress = pickString(rec, ["address", "vaultAddress"]);
  if (!vaultAddress) return null; // without an address we can't act on it — skip.

  const name = pickString(rec, ["name"]) ?? "Vault";
  const protocol = pickString(rec, ["protocol"]) ?? "";
  const asset = pickString(rec, ["asset"]) ?? "USDC";

  // APY: prefer apyProfile.current, fall back to deprecated currentApy.
  const apyProfile = asRecord(rec.apyProfile);
  let apy: number | null = null;
  const current = apyProfile?.current;
  if (typeof current === "number" && Number.isFinite(current)) apy = current;
  else if (typeof rec.currentApy === "number" && Number.isFinite(rec.currentApy))
    apy = rec.currentApy;

  const apyText = apy !== null ? `${(apy * 100).toFixed(2)}%` : null;

  // EarnVaultInfo overrides these as human-readable decimal strings.
  const tvlText = typeof rec.totalDeposits === "string" ? rec.totalDeposits : null;
  const liquidityText = typeof rec.liquidity === "string" ? rec.liquidity : null;

  return {
    name,
    protocol,
    vaultAddress,
    asset,
    apy,
    apyText,
    tvlText,
    liquidityText,
    raw,
  };
}

function vaultReportsZeroApy(v: EarnVault): boolean {
  if (v.apy === 0) return true;
  const raw = asRecord(v.raw);
  if (!raw) return false;
  if (raw.currentApy === 0) return true;
  const apyProfile = asRecord(raw.apyProfile);
  return apyProfile?.current === 0;
}

/** UI-only: hide low-signal vaults unless that would leave nothing to show. */
function filterVaultsForDisplay(vaults: EarnVault[]): EarnVault[] {
  const filtered = vaults.filter((v) => {
    const raw = asRecord(v.raw);
    const apiName = pickString(raw, ["name"]);
    if (!apiName || apiName.trim() === "") return false;
    if (/^test/i.test(apiName.trim())) return false;
    if (vaultReportsZeroApy(v)) return false;
    return true;
  });
  return filtered.length > 0 ? filtered : vaults;
}

function extractExecution(raw: unknown): EarnExecution {
  const rec = asRecord(raw);
  const txHash = pickString(rec, ["txHash", "transactionHash", "hash"]);
  const sdkUrl = pickString(rec, ["explorerUrl"]);
  return {
    txHash,
    explorerUrl:
      sdkUrl ?? (txHash ? explorerTxUrl(arcBridgeChainId(), txHash) : null),
    raw,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover USDC yield vaults on Arc Testnet, sorted by APY. No wallet needed —
 * discovery is a read against Circle's Earn service. Returns [] if none are
 * available so the UI can say so honestly instead of showing a fake vault.
 */
export async function listArcVaults(kitKey?: string): Promise<EarnVault[]> {
  const kit = await loadEarnKit();
  const res = await kit.exploreVaults(
    withConfig(
      { chain: ARC_CHAIN, asset: "USDC", sortBy: "apy" },
      kitKey,
    ),
  );
  const rec = asRecord(res);
  const vaults = Array.isArray(rec?.vaults) ? rec!.vaults : [];
  const mapped: EarnVault[] = [];
  for (const v of vaults) {
    const m = mapVault(v);
    if (m) mapped.push(m);
  }
  // exploreVaults uses sortBy: "apy" (desc); filtering preserves that order.
  return filterVaultsForDisplay(mapped);
}

export type EarnActionArgs = {
  provider: Eip1193Provider;
  vaultAddress: string;
  kitKey?: string;
};

export type EarnAmountArgs = EarnActionArgs & {
  /** Human-readable amount, e.g. "100.50". Passed to the SDK as-is. */
  amount: string;
};

/** Read the connected wallet's position in a specific Arc vault. */
export async function getEarnPosition(
  args: EarnActionArgs,
): Promise<EarnPosition> {
  const kit = await loadEarnKit();
  const adapter = await buildAdapter(args.provider);
  const res = await kit.getPosition(
    withConfig(
      {
        from: { adapter, chain: ARC_CHAIN },
        vaultAddress: args.vaultAddress,
      },
      args.kitKey,
    ),
  );
  const rec = asRecord(res);
  return {
    currentBalance:
      typeof rec?.currentBalance === "string" ? rec.currentBalance : null,
    shares: typeof rec?.shares === "string" ? rec.shares : null,
    raw: res,
  };
}

/** Preview a same-chain deposit (fees + expected vault shares). */
export async function estimateDeposit(args: EarnAmountArgs): Promise<EarnQuote> {
  const kit = await loadEarnKit();
  const adapter = await buildAdapter(args.provider);
  const res = await kit.getDepositQuote(
    withConfig(
      {
        from: { adapter, chain: ARC_CHAIN },
        vaultAddress: args.vaultAddress,
        amount: args.amount,
      },
      args.kitKey,
    ),
  );
  const rec = asRecord(res);
  const shares = formatAssetAmount(rec?.expectedShares);
  return {
    expectedText: shares ? `≈ ${shares}` : null,
    feeText: formatFees(rec?.fees),
    raw: res,
  };
}

/** Execute a same-chain deposit into an Arc vault. */
export async function executeDeposit(
  args: EarnAmountArgs,
): Promise<EarnExecution> {
  const kit = await loadEarnKit();
  const adapter = await buildAdapter(args.provider);
  const res = await kit.deposit(
    withConfig(
      {
        from: { adapter, chain: ARC_CHAIN },
        vaultAddress: args.vaultAddress,
        amount: args.amount,
      },
      args.kitKey,
    ),
  );
  return extractExecution(res);
}

/** Preview a withdrawal (fees + max withdrawable). */
export async function estimateWithdraw(
  args: EarnAmountArgs,
): Promise<EarnQuote> {
  const kit = await loadEarnKit();
  const adapter = await buildAdapter(args.provider);
  const res = await kit.getWithdrawalQuote(
    withConfig(
      {
        from: { adapter, chain: ARC_CHAIN },
        vaultAddress: args.vaultAddress,
        amount: args.amount,
      },
      args.kitKey,
    ),
  );
  const rec = asRecord(res);
  const maxOut = formatAssetAmount(rec?.maxWithdrawable);
  return {
    expectedText: maxOut ? `Max withdrawable: ${maxOut}` : null,
    feeText: formatFees(rec?.fees),
    raw: res,
  };
}

/** Execute a withdrawal from an Arc vault. */
export async function executeWithdraw(
  args: EarnAmountArgs,
): Promise<EarnExecution> {
  const kit = await loadEarnKit();
  const adapter = await buildAdapter(args.provider);
  const res = await kit.withdraw(
    withConfig(
      {
        from: { adapter, chain: ARC_CHAIN },
        vaultAddress: args.vaultAddress,
        amount: args.amount,
      },
      args.kitKey,
    ),
  );
  return extractExecution(res);
}
