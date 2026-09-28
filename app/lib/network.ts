/**
 * Single source of truth for which Arc network Vector targets.
 *
 * Driven by NEXT_PUBLIC_NETWORK ("mainnet" | "testnet", default testnet).
 *
 * On mainnet, Arc RPC / explorer / native USDC+EURC locators come from
 * @circle-fin/app-kit `getSupportedChains("bridge")` (chain `"Arc"`, !isTestnet).
 * Static values are fallbacks only if that lookup fails.
 */

import { BridgeChain, EarnChain, SwapChain } from "@circle-fin/app-kit";
import {
  explorerBaseFromKitExplorerUrl,
  getArcMainnetKitBridgeChain,
} from "./kit-bridge-chains";

export type NetworkMode = "mainnet" | "testnet";

const rawNetwork =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_NETWORK?.trim().toLowerCase()
    : undefined;

export const networkMode: NetworkMode =
  rawNetwork === "mainnet" ? "mainnet" : "testnet";

export const isMainnet = networkMode === "mainnet";
export const isTestnet = !isMainnet;

const mainnetArcFromKit = isMainnet ? getArcMainnetKitBridgeChain() : undefined;

if (isMainnet && !mainnetArcFromKit && typeof console !== "undefined") {
  console.warn(
    "[vector/network] Arc mainnet not found in App Kit bridge chains (expected chain=Arc, isTestnet=false). Using static RPC/explorer fallbacks.",
  );
}

const FALLBACK_MAINNET_RPC = "https://rpc.arc.network/";
const FALLBACK_MAINNET_EXPLORER = "https://arcscan.app";
const TESTNET_RPC = "https://rpc.testnet.arc.network/";
const TESTNET_EXPLORER = "https://testnet.arcscan.app";

/** EVM chain id from SDK on mainnet when available. */
export const chainId = isMainnet
  ? (mainnetArcFromKit?.chainId ?? 5042)
  : 5042002;

/** App Kit bridge/swap/earn chain enum for Arc. */
export const appKitChain = isMainnet
  ? BridgeChain.Arc
  : BridgeChain.Arc_Testnet;

export const swapKitChain = isMainnet ? SwapChain.Arc : SwapChain.Arc_Testnet;

export const earnKitChain = isMainnet ? EarnChain.Arc : EarnChain.Arc_Testnet;

export const displayName = isMainnet ? "Arc" : "Arc Testnet";

/** Human-readable badge in the header — "Testnet" suffix only on testnet. */
export const headerNetworkLabel = isMainnet ? "Arc" : "Arc Testnet";

const envArcRpc =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim()
    : undefined;

const kitMainnetRpc = mainnetArcFromKit?.rpcEndpoints?.[0];

const defaultRpc = isMainnet
  ? kitMainnetRpc ?? FALLBACK_MAINNET_RPC
  : TESTNET_RPC;

export const rpcUrl = envArcRpc || defaultRpc;

const kitExplorerBase = explorerBaseFromKitExplorerUrl(
  mainnetArcFromKit?.explorerUrl,
);

export const explorerBaseUrl = isMainnet
  ? kitExplorerBase ?? FALLBACK_MAINNET_EXPLORER
  : TESTNET_EXPLORER;

export const chainIdHex = (`0x${chainId.toString(16)}`) as `0x${string}`;

/**
 * Circle Earn HTTP API `chain` field (W3S / REST proxy).
 * Matches App Kit CHAIN_TO_API: Arc → "ARC", Arc_Testnet → "ARC-TESTNET".
 */
export const earnApiChainDefault = isMainnet ? "ARC" : "ARC-TESTNET";

/**
 * W3S REST `blockchains` / portfolio labels.
 * Matches CHAIN_TO_API in @circle-fin/app-kit (Arc → "ARC"). w3s-pw-web-sdk
 * does not ship a public enum in this repo — confirm against Circle W3S docs
 * if initializeUser fails on mainnet.
 */
export const w3sBlockchainLabel = earnApiChainDefault;

function asHexAddress(
  value: string | null | undefined,
): `0x${string}` | undefined {
  if (typeof value === "string" && value.startsWith("0x")) {
    return value as `0x${string}`;
  }
  return undefined;
}

/**
 * Circle's Arc USDC ERC-20 interface (6 decimals) — CCTP, swap, and bridge burns
 * use this contract. Same predeploy on testnet and mainnet (App Kit chains def).
 */
export const ARC_USDC_ERC20_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;

/** USDC token address on Arc (from SDK on mainnet; constant fallback on testnet). */
export const arcUsdcAddress: `0x${string}` = isMainnet
  ? (asHexAddress(mainnetArcFromKit?.usdcAddress) ?? ARC_USDC_ERC20_ADDRESS)
  : ARC_USDC_ERC20_ADDRESS;

/** EURC on Arc (from SDK on mainnet). */
export const arcEurcAddress = isMainnet
  ? asHexAddress(mainnetArcFromKit?.eurcAddress)
  : undefined;

export function arcExplorerTxUrl(hash: string): string {
  return `${explorerBaseUrl}/tx/${hash}`;
}

export function arcExplorerAddressUrl(address: string): string {
  return `${explorerBaseUrl}/address/${address}`;
}

/** Testnet-only faucet URL (undefined on mainnet — do not link faucets in prod UI). */
export const arcFaucetUrl = isTestnet
  ? process.env.NEXT_PUBLIC_ARC_FAUCET_URL?.trim() ||
    "https://faucet.circle.com"
  : undefined;
