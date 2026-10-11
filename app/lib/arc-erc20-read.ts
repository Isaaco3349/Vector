"use client";

import { createPublicClient, encodeFunctionData, erc20Abi, http } from "viem";
import { arcUsdcNativeToErc20Minor } from "./arc-usdc-balance";
import type { Eip1193Provider } from "./appkit";
import { arcUsdcAddress, rpcUrl } from "./network";
import { arcViemChain } from "./viem-arc-chain";

let arcReadClient: ReturnType<typeof createPublicClient> | null = null;

function arcPublicReadClient() {
  if (!arcReadClient) {
    arcReadClient = createPublicClient({
      chain: arcViemChain,
      transport: http(rpcUrl),
    });
  }
  return arcReadClient;
}

/** SDK-verified ERC-20 decimals on Arc (avoid extra RPC that can fail multicall). */
export function verifiedArcTokenDecimals(symbol: string): number | null {
  if (symbol === "cirBTC") return 8;
  if (symbol === "EURC") return 6;
  return null;
}

export async function readErc20BalanceViaProvider(
  provider: Eip1193Provider,
  token: `0x${string}`,
  owner: `0x${string}`,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
  const result = await provider.request({
    method: "eth_call",
    params: [{ to: token, data }, "latest"],
  });
  return BigInt(result as string);
}

export function isArcUsdcToken(token: string): boolean {
  return token.toLowerCase() === arcUsdcAddress.toLowerCase();
}

/** Keep native USDC on Arc for gas when swapping USDC (6-decimal minor units). */
export const ARC_USDC_GAS_RESERVE_MINOR = BigInt(50_000); // 0.05 USDC

export function applyArcUsdcGasReserve(token: string, balanceMinor: bigint): bigint {
  if (!isArcUsdcToken(token)) return balanceMinor;
  if (balanceMinor <= ARC_USDC_GAS_RESERVE_MINOR) return BigInt(0);
  return balanceMinor - ARC_USDC_GAS_RESERVE_MINOR;
}

/**
 * Spendable input balance for swaps — Arc USDC uses native + ERC-20 (one pool).
 */
export async function readSwapInputBalanceViaProvider(
  provider: Eip1193Provider,
  token: string,
  owner: `0x${string}`,
): Promise<bigint> {
  const erc20Minor = await readErc20BalanceViaProvider(
    provider,
    token as `0x${string}`,
    owner,
  );
  if (!isArcUsdcToken(token)) return erc20Minor;

  const nativeHex = await provider.request({
    method: "eth_getBalance",
    params: [owner, "latest"],
  });
  const fromNative = arcUsdcNativeToErc20Minor(BigInt(nativeHex as string));
  const combined = erc20Minor > fromNative ? erc20Minor : fromNative;
  return applyArcUsdcGasReserve(token, combined);
}

/** Arc RPC reads — OKX mobile WebView often returns -32603 on wallet `eth_call`. */
export async function readErc20BalancePublic(
  token: `0x${string}`,
  owner: `0x${string}`,
): Promise<bigint> {
  return arcPublicReadClient().readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

export async function readErc20AllowancePublic(
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  return arcPublicReadClient().readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
}

export async function readSwapInputBalancePublic(
  token: string,
  owner: `0x${string}`,
): Promise<bigint> {
  const erc20Minor = await readErc20BalancePublic(token as `0x${string}`, owner);
  if (!isArcUsdcToken(token)) return erc20Minor;

  const native = await arcPublicReadClient().getBalance({ address: owner });
  const fromNative = arcUsdcNativeToErc20Minor(native);
  const combined = erc20Minor > fromNative ? erc20Minor : fromNative;
  return applyArcUsdcGasReserve(token, combined);
}
