import { arcEurcAddress, arcUsdcAddress, isMainnet } from "../network";

/** USDC ERC-20 interface on Arc (6 decimals). */
export const ARC_USDC = arcUsdcAddress;

/**
 * Circle App Kit EURC vs Li.Fi / Kyber indexed EURC on Arc mainnet differ.
 * Aggregators only route the Li.Fi-verified contract; Circle kit uses SDK eurcAddress.
 */
export const AGGREGATOR_EURC_MAINNET =
  "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as const;

export const CIRCLE_EURC_TESTNET =
  "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as const;

import type { SwapSymbol as KitSwapSymbol } from "../google-swap";

export type AggregatorPairSymbol = Extract<KitSwapSymbol, "USDC" | "EURC">;

/** Li.Fi / Kyber indexed tokens on Arc. */
export function aggregatorTokenAddress(
  symbol: AggregatorPairSymbol,
): `0x${string}` | null {
  if (symbol === "USDC") return ARC_USDC;
  if (!isMainnet) return CIRCLE_EURC_TESTNET;
  return AGGREGATOR_EURC_MAINNET;
}

/** Circle stablecoin kit token addresses. */
export function circleTokenAddress(
  symbol: AggregatorPairSymbol,
): `0x${string}` | null {
  if (symbol === "USDC") return ARC_USDC;
  if (!isMainnet) return CIRCLE_EURC_TESTNET;
  return (arcEurcAddress ?? AGGREGATOR_EURC_MAINNET) as `0x${string}`;
}

export function tokenDecimals(symbol: AggregatorPairSymbol): number {
  return symbol === "USDC" || symbol === "EURC" ? 6 : 6;
}
