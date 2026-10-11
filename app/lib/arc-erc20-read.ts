"use client";

import { encodeFunctionData, erc20Abi } from "viem";
import type { Eip1193Provider } from "./appkit";

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
