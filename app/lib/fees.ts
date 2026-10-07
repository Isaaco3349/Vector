import { formatUnits, getAddress, isAddress, parseUnits } from "viem";
import type { BridgeChain, BridgeChainId } from "./bridge-chains";

const USDC_DECIMALS = 6;

/** Flat Vector fee on swap / earn (USDC). */
export const VECTOR_SWAP_FEE_USDC = "0.15";

/** @deprecated Alias — use VECTOR_SWAP_FEE_USDC. */
export const VECTOR_FLAT_FEE_USDC = VECTOR_SWAP_FEE_USDC;

/**
 * Bridge platform fee (USDC). Kept low vs Relay/Jumper-style CCTP UIs — mostly
 * Circle CCTP + gas; override via NEXT_PUBLIC_VECTOR_BRIDGE_FEE_USDC.
 */
export const VECTOR_BRIDGE_FEE_USDC = (() => {
  const raw = process.env.NEXT_PUBLIC_VECTOR_BRIDGE_FEE_USDC?.trim();
  if (raw === "0" || raw === "0.0" || raw === "0.00") return "0";
  if (raw && /^\d+(\.\d+)?$/.test(raw)) return raw;
  return "0.01";
})();

/** @deprecated Use flat fee labels; kept for UI that still references bps keys. */
export const SWAP_FEE_BPS = 25;

/** @deprecated Use flat fee labels; kept for UI that still references bps keys. */
export const BRIDGE_FEE_BPS = 10;

export function vectorFlatFeeBaseUnits(): bigint {
  return parseUnits(VECTOR_SWAP_FEE_USDC as `${number}`, USDC_DECIMALS);
}

function bridgeFlatFeeBaseUnits(): bigint {
  if (VECTOR_BRIDGE_FEE_USDC === "0") return BigInt(0);
  return parseUnits(VECTOR_BRIDGE_FEE_USDC as `${number}`, USDC_DECIMALS);
}

const MISSING_RECIPIENT_MSG =
  "NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT is not set. Platform fees are required — add it to .env.local (see .env.local.example).";

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

export function bridgePlatformFeeBaseUnits(_amountHuman?: string): bigint {
  return bridgeFlatFeeBaseUnits();
}

/**
 * Inbound Arc from an ERC-20 source chain: OKX-safe path omits on-chain
 * customFee (see bridge-sequential-tx). Balance checks must match execution.
 */
export function isOkxStyleInboundArcRoute(
  from: BridgeChain | undefined,
  toChain: BridgeChainId,
): boolean {
  if (!from) return false;
  const inboundArc = toChain === "Arc" || toChain === "Arc_Testnet";
  return inboundArc && from.usdcKind === "erc20";
}

export function bridgePlatformFeeBaseUnitsForRoute(
  from: BridgeChain | undefined,
  toChain: BridgeChainId,
): bigint {
  if (isOkxStyleInboundArcRoute(from, toChain)) return BigInt(0);
  return bridgePlatformFeeBaseUnits();
}

export function bridgePlatformFeeHumanForRoute(
  from: BridgeChain | undefined,
  toChain: BridgeChainId,
): string {
  if (isOkxStyleInboundArcRoute(from, toChain)) return "0";
  return bridgePlatformFeeHuman();
}

export function formatBridgeFeeLabelForRoute(
  from: BridgeChain | undefined,
  toChain: BridgeChainId,
): string {
  if (isOkxStyleInboundArcRoute(from, toChain)) {
    return "No Vector bridge fee on this route — CCTP network fees only";
  }
  return formatBridgeFeeLabel();
}

export function bridgePlatformFeeHuman(_amountHuman?: string): string {
  return VECTOR_BRIDGE_FEE_USDC;
}

export function bridgeCustomFeeHumanForAppKit(_amountHuman: string) {
  const fee = bridgeFlatFeeBaseUnits();
  if (fee <= BigInt(0)) return {};
  return {
    customFee: {
      value: VECTOR_BRIDGE_FEE_USDC,
      recipientAddress: requirePlatformFeeRecipient(),
    },
  };
}

export function bridgeCustomFeeBaseForCctpBurn(_amountHuman: string) {
  const feeBase = bridgeFlatFeeBaseUnits();
  if (feeBase <= BigInt(0)) return {};
  return {
    customFee: {
      value: feeBase.toString(),
      recipientAddress: requirePlatformFeeRecipient(),
    },
  };
}

/**
 * Circle swap API requires `customFee.percentageBps` (not `value`). Map the
 * product flat swap fee to bps for the quoted swap size.
 */
export function swapCustomFeeConfig(amountHuman?: string) {
  const recipientAddress = requirePlatformFeeRecipient();
  let percentageBps = SWAP_FEE_BPS;
  const trimmed = amountHuman?.trim();
  if (trimmed && /^\d+(\.\d+)?$/.test(trimmed)) {
    const amount = Number(trimmed);
    if (Number.isFinite(amount) && amount > 0) {
      const flat = Number(VECTOR_SWAP_FEE_USDC);
      percentageBps = Math.ceil((flat / amount) * 10_000);
      percentageBps = Math.min(Math.max(percentageBps, 1), 10_000);
    }
  }
  return {
    customFee: {
      percentageBps,
      recipientAddress,
    },
  };
}

export function formatVectorFeeLabel(_bps?: number): string {
  return `Includes $${VECTOR_SWAP_FEE_USDC} Vector fee`;
}

export function formatBridgeFeeLabel(): string {
  if (VECTOR_BRIDGE_FEE_USDC === "0") {
    return "No Vector bridge fee — CCTP network fees only";
  }
  return `Includes $${VECTOR_BRIDGE_FEE_USDC} Vector bridge fee`;
}

export function bridgeTotalUsdcRequiredBaseUnits(amountHuman: string): bigint {
  const amountBase = parseBridgeAmountHuman(amountHuman);
  return amountBase + bridgeFlatFeeBaseUnits();
}

export function bridgeMaxAmountHumanFromBalance(balanceHuman: string): string | null {
  const trimmed = balanceHuman.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  let balanceBase: bigint;
  try {
    balanceBase = parseUnits(trimmed as `${number}`, USDC_DECIMALS);
  } catch {
    return null;
  }
  return bridgeMaxAmountHumanFromBalanceBaseUnits(balanceBase);
}

export function bridgeMaxAmountHumanFromBalanceBaseUnits(
  balanceBase: bigint,
  platformFeeBase?: bigint,
): string | null {
  const fee = platformFeeBase ?? bridgeFlatFeeBaseUnits();
  if (balanceBase <= fee) return null;
  const maxBase = balanceBase - fee;
  if (maxBase <= BigInt(0)) return null;
  return formatUnits(maxBase, USDC_DECIMALS);
}

export function bridgeAmountExceedsUsdcBalance(
  amountHuman: string,
  balanceBase: bigint,
  platformFeeBase?: bigint,
): boolean {
  if (balanceBase <= BigInt(0)) return true;
  try {
    const amountBase = parseBridgeAmountHuman(amountHuman.trim());
    const fee = platformFeeBase ?? bridgeFlatFeeBaseUnits();
    return amountBase + fee > balanceBase;
  } catch {
    return true;
  }
}
