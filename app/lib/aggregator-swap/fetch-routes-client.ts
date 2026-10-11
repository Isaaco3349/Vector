"use client";

import type { SwapRouteExecution, SwapRouteOffer } from "./types";
import type { AggregatorPairSymbol } from "./tokens";

export type ClientSwapRoutesResult = {
  offers: SwapRouteOffer[];
  best: SwapRouteExecution | null;
  lifiExecution?: SwapRouteExecution | null;
};

export async function fetchSwapRoutesClient(args: {
  tokenIn: AggregatorPairSymbol;
  tokenOut: AggregatorPairSymbol;
  amount: string;
  fromAddress: string;
  slippageBps?: number;
}): Promise<ClientSwapRoutesResult> {
  const res = await fetch("/api/swap-routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amount: args.amount,
      fromAddress: args.fromAddress,
      ...(args.slippageBps != null ? { slippageBps: args.slippageBps } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Could not compare swap routes.",
    );
  }
  return data as ClientSwapRoutesResult;
}
