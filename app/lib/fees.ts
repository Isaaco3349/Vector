import { getAddress, isAddress, parseUnits } from "viem";

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

/** App Kit / Stablecoin Service swap `config.customFee` (percentage of swap input). */
export function swapCustomFeeConfig() {
  return {
    customFee: {
      percentageBps: SWAP_FEE_BPS,
      recipientAddress: requirePlatformFeeRecipient(),
    },
  };
}

/**
 * App Kit / Bridge Kit `config.customFee.value` — integer string in USDC base units
 * (6 decimals). Some bridge paths call `BigInt(value)` before scaling human amounts.
 */
export function bridgeCustomFeeForAmount(amountHuman: string) {
  const trimmed = amountHuman.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Invalid bridge amount for platform fee calculation.");
  }
  let amountBase: bigint;
  try {
    amountBase = parseUnits(trimmed as `${number}`, USDC_DECIMALS);
  } catch {
    throw new Error("Invalid bridge amount for platform fee calculation.");
  }
  if (amountBase <= BigInt(0)) {
    throw new Error("Invalid bridge amount for platform fee calculation.");
  }
  const feeBase = (amountBase * BigInt(BRIDGE_FEE_BPS)) / BigInt(10_000);
  return {
    customFee: {
      value: feeBase.toString(),
      recipientAddress: requirePlatformFeeRecipient(),
    },
  };
}

/** Label for review screens — e.g. "Includes 0.25% Vector fee". */
export function formatVectorFeeLabel(bps: number): string {
  const pct = bps / 100;
  return `Includes ${pct.toFixed(2)}% Vector fee`;
}
