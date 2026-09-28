import { formatUnits, getAddress, isAddress, parseUnits } from "viem";

const USDC_DECIMALS = 6;

/** 0.25% — do not change without product approval. */
export const SWAP_FEE_BPS = 25;

/** 0.10% — do not change without product approval. */
export const BRIDGE_FEE_BPS = 10;

const MISSING_RECIPIENT_MSG =
  "NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT is not set. Platform fees are required — add it to .env.local (see .env.local.example).";

/**
 * EVM address that receives Vector's share of Circle custom fees (90% per Circle docs).
 * Public env var — safe for client bundles.
 */
export function requirePlatformFeeRecipient(): `0x${string}` {
  const raw = process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT?.trim();
  if (!raw) {
    throw new Error(MISSING_RECIPIENT_MSG);
  }
  if (!isAddress(raw)) {
    throw throwInvalidRecipient(raw);
  }
  return getAddress(raw);
}

function throwInvalidRecipient(raw: string): never {
  throw new Error(
    `NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT is not a valid address: ${raw}`,
  );
}

function parseBridgeAmountHuman(amountHuman: string): bigint {
  const trimmed = amountHuman.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Invalid bridge amount for platform fee calculation.");
  }
  try {
    const amountBase = parseUnits(trimmed as `${number}`, USDC_DECIMALS);
    if (amountBase <= BigInt(0)) {
      throw new Error("Invalid bridge amount for platform fee calculation.");
    }
    return amountBase;
  } catch {
    throw new Error("Invalid bridge amount for platform fee calculation.");
  }
}

/** Platform fee in USDC base units (6 decimals): amount × BRIDGE_FEE_BPS / 10_000. */
export function bridgePlatformFeeBaseUnits(amountHuman: string): bigint {
  const amountBase = parseBridgeAmountHuman(amountHuman);
  return (amountBase * BigInt(BRIDGE_FEE_BPS)) / BigInt(10_000);
}

/** Human USDC fee string for display / SDK paths that expect decimal amounts. */
export function bridgePlatformFeeHuman(amountHuman: string): string {
  return formatUnits(bridgePlatformFeeBaseUnits(amountHuman), USDC_DECIMALS);
}

/**
 * App Kit / Bridge Kit `config.customFee.value` — human-readable USDC decimal string.
 * Bridge Kit scales `amount`, `maxFee`, and `customFee.value` to base units at the
 * kit boundary; passing base units here is interpreted as whole USDC and overscales.
 */
export function bridgeCustomFeeHumanForAppKit(amountHuman: string) {
  return {
    customFee: {
      value: bridgePlatformFeeHuman(amountHuman),
      recipientAddress: requirePlatformFeeRecipient(),
    },
  };
}

/**
 * CCTP v2 provider `burn()` when `amount` is already in minor units — fee must
 * match the same unit (integer string). Used by the Google-wallet encoder path.
 */
export function bridgeCustomFeeBaseForCctpBurn(amountHuman: string) {
  const feeBase = bridgePlatformFeeBaseUnits(amountHuman);
  return {
    customFee: {
      value: feeBase.toString(),
      recipientAddress: requirePlatformFeeRecipient(),
    },
  };
}

/** App Kit / Stablecoin Service swap `config.customFee` (percentage of swap input). */
export function swapCustomFeeConfig() {
  return {
    customFee: {
      percentageBps: SWAP_FEE_BPS,
      recipientAddress: requirePlatformFeeRecipient(),
    },
  };
}

/** Label for review screens — e.g. "Includes 0.25% Vector fee". */
export function formatVectorFeeLabel(bps: number): string {
  const pct = bps / 100;
  return `Includes ${pct.toFixed(2)}% Vector fee`;
}

/**
 * USDC (6 dp) the wallet must hold for a bridge: burn amount + Vector kit fee.
 * Circle approves/pulls `amount + customFee` on the source chain.
 */
export function bridgeTotalUsdcRequiredBaseUnits(amountHuman: string): bigint {
  const amountBase = parseBridgeAmountHuman(amountHuman);
  return amountBase + bridgePlatformFeeBaseUnits(amountHuman);
}

/**
 * Largest human USDC amount bridgeable from a balance without exceeding it
 * after the 0.10% kit fee. Use for MAX instead of the raw balance string.
 */
export function bridgeMaxAmountHumanFromBalance(balanceHuman: string): string | null {
  const trimmed = balanceHuman.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  let balanceBase: bigint;
  try {
    balanceBase = parseUnits(trimmed as `${number}`, USDC_DECIMALS);
  } catch {
    return null;
  }
  if (balanceBase <= BigInt(0)) return null;
  const maxBase =
    (balanceBase * BigInt(10_000)) / BigInt(10_000 + BRIDGE_FEE_BPS);
  if (maxBase <= BigInt(0)) return null;
  return formatUnits(maxBase, USDC_DECIMALS);
}
