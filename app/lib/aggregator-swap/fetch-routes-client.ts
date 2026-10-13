"use client";

import { fetchVectorApi } from "../okx-mobile-fetch";
import type { SwapRouteExecution, SwapRouteOffer } from "./types";
import type { AggregatorPairSymbol } from "./tokens";

export type ClientSwapRoutesResult = {
  offers: SwapRouteOffer[];
  best: SwapRouteExecution | null;
  lifiExecution?: SwapRouteExecution | null;
};

const SWAP_ROUTES_TIMEOUT_MS = 25_000;

export async function fetchSwapRoutesClient(args: {
  tokenIn: AggregatorPairSymbol;
  tokenOut: AggregatorPairSymbol;
  amount: string;
  fromAddress: string;
  slippageBps?: number;
}): Promise<ClientSwapRoutesResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SWAP_ROUTES_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchVectorApi("/api/swap-routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        amount: args.amount,
        fromAddress: args.fromAddress,
        ...(args.slippageBps != null ? { slippageBps: args.slippageBps } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "Swap route comparison timed out. Vector will try Circle pricing next — wait a moment or tap Refresh.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Could not compare swap routes.",
    );
  }
  return data as ClientSwapRoutesResult;
}
