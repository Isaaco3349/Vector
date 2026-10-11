"use client";

import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  fallback,
  http,
} from "viem";
import { arcUsdcNativeToErc20Minor } from "./arc-usdc-balance";
import type { Eip1193Provider } from "./appkit";
import { errorTextBlob } from "./wallet-errors";
import { arcUsdcAddress, rpcUrl } from "./network";
import { arcViemChain } from "./viem-arc-chain";

const ARC_PUBLIC_READ_FALLBACK_RPC = "https://rpc.arc.network/";
const ARC_READ_CACHE_MS = 5_000;

let arcReadClient: ReturnType<typeof createPublicClient> | null = null;

type CachedBigint = { value: bigint; at: number };
const bigintReadCache = new Map<string, CachedBigint>();

function arcReadRpcUrls(): string[] {
  const primary = rpcUrl.trim();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [primary, ARC_PUBLIC_READ_FALLBACK_RPC]) {
    const u = raw.trim();
    if (!u) continue;
    const key = u.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out.length > 0 ? out : [ARC_PUBLIC_READ_FALLBACK_RPC];
}

function isArcPublicRateLimitError(err: unknown): boolean {
  const blob = errorTextBlob(err);
  return /exceeds defined limit|rate limit|too many requests|429/i.test(blob);
}

async function withPublicReadRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [350, 900] as const;
  let last: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isArcPublicRateLimitError(err) || attempt === delays.length) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw last;
}

function readCacheGet(key: string): bigint | null {
  const hit = bigintReadCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ARC_READ_CACHE_MS) {
    bigintReadCache.delete(key);
    return null;
  }
  return hit.value;
}

function readCacheSet(key: string, value: bigint): void {
  bigintReadCache.set(key, { value, at: Date.now() });
}

export function arcPublicReadClient() {
  if (!arcReadClient) {
    const urls = arcReadRpcUrls();
    arcReadClient = createPublicClient({
      chain: arcViemChain,
      transport:
        urls.length === 1
          ? http(urls[0], { retryCount: 2, retryDelay: 350 })
          : fallback(
              urls.map((u) => http(u, { retryCount: 1, retryDelay: 400 })),
            ),
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

/** OKX: wallet reads first (retried in OKX provider wrap), public Arc RPC as fallback. */
export async function readSwapInputBalanceForSwap(
  provider: Eip1193Provider,
  token: string,
  owner: `0x${string}`,
  opts?: { preferWallet?: boolean },
): Promise<bigint> {
  const preferWallet = opts?.preferWallet === true;
  if (preferWallet) {
    try {
      return await readSwapInputBalanceViaProvider(provider, token, owner);
    } catch {
      return readSwapInputBalancePublic(token, owner);
    }
  }
  return readSwapInputBalanceViaProvider(provider, token, owner);
}

export async function readErc20AllowanceForSwap(
  provider: Eip1193Provider,
  token: string,
  owner: string,
  spender: string,
  opts?: { preferWallet?: boolean },
): Promise<bigint> {
  const preferWallet = opts?.preferWallet === true;
  if (preferWallet) {
    try {
      return await readErc20AllowanceViaProvider(provider, token, owner, spender);
    } catch {
      return readErc20AllowancePublic(
        token as `0x${string}`,
        owner as `0x${string}`,
        spender as `0x${string}`,
      );
    }
  }
  return readErc20AllowanceViaProvider(provider, token, owner, spender);
}

async function readErc20AllowanceViaProvider(
  provider: Eip1193Provider,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner as `0x${string}`, spender as `0x${string}`],
  });
  const result = await provider.request({
    method: "eth_call",
    params: [{ to: token, data }, "latest"],
  });
  return BigInt(result as string);
}

/** Arc public RPC — fallback when wallet `eth_call` fails; cached + rate-limit aware. */
export async function readErc20BalancePublic(
  token: `0x${string}`,
  owner: `0x${string}`,
): Promise<bigint> {
  const key = `bal:${token}:${owner}`;
  const cached = readCacheGet(key);
  if (cached !== null) return cached;

  const value = await withPublicReadRetry(() =>
    arcPublicReadClient().readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    }),
  );
  readCacheSet(key, value);
  return value;
}

export async function readErc20AllowancePublic(
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  const key = `allow:${token}:${owner}:${spender}`;
  const cached = readCacheGet(key);
  if (cached !== null) return cached;

  const value = await withPublicReadRetry(() =>
    arcPublicReadClient().readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    }),
  );
  readCacheSet(key, value);
  return value;
}

export async function readSwapInputBalancePublic(
  token: string,
  owner: `0x${string}`,
): Promise<bigint> {
  const key = `swapIn:${token}:${owner}`;
  const cached = readCacheGet(key);
  if (cached !== null) return cached;

  const erc20Minor = await readErc20BalancePublic(token as `0x${string}`, owner);
  if (!isArcUsdcToken(token)) {
    readCacheSet(key, erc20Minor);
    return erc20Minor;
  }

  const native = await withPublicReadRetry(() =>
    arcPublicReadClient().getBalance({ address: owner }),
  );
  const fromNative = arcUsdcNativeToErc20Minor(native);
  const combined = erc20Minor > fromNative ? erc20Minor : fromNative;
  const spendable = applyArcUsdcGasReserve(token, combined);
  readCacheSet(key, spendable);
  return spendable;
}
