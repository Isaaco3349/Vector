"use client";

import { fetchVectorApi } from "../okx-mobile-fetch";
import { assembleSwapRoutes } from "./assemble-swap-routes";
import { fetchLifiQuoteBrowser } from "./lifi-quote-browser";
import type { SwapRouteExecution, SwapRouteOffer } from "./types";
import type { AggregatorPairSymbol } from "./tokens";
import { pairIncludesCirBtc } from "./routing-policy";

export type ClientSwapRoutesResult = {
  offers: SwapRouteOffer[];
  best: SwapRouteExecution | null;
  executions?: SwapRouteExecution[];
  lifiExecution?: SwapRouteExecution | null;
};

const SWAP_ROUTES_TIMEOUT_MS = 32_000;
const CIRCLE_QUOTE_TIMEOUT_MS = 22_000;

async function postSwapRoutesApi(
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchVectorApi("/api/swap-routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSwapRoutesClient(args: {
  tokenIn: AggregatorPairSymbol;
  tokenOut: AggregatorPairSymbol;
  amount: string;
  fromAddress: string;
  slippageBps?: number;
}): Promise<ClientSwapRoutesResult> {
  let res: Response;
  try {
    res = await postSwapRoutesApi(
      {
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        amount: args.amount,
        fromAddress: args.fromAddress,
        ...(args.slippageBps != null ? { slippageBps: args.slippageBps } : {}),
      },
      SWAP_ROUTES_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "Swap route comparison timed out. Vector will try Circle pricing next — wait a moment or tap Refresh.",
      );
    }
    throw err;
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Could not compare swap routes.",
    );
  }
  return data as ClientSwapRoutesResult;
}

/**
 * Server compare first; if empty or failed, LI.FI from the browser (Arc Portal path).
 */
export async function fetchSwapRoutesResilient(args: {
  tokenIn: AggregatorPairSymbol;
  tokenOut: AggregatorPairSymbol;
  amount: string;
  fromAddress: string;
  slippageBps?: number;
}): Promise<ClientSwapRoutesResult> {
  const slippageBps = args.slippageBps ?? 300;
  let serverError: Error | null = null;

  try {
    const server = await fetchSwapRoutesClient({ ...args, slippageBps });
    if (server.offers.length > 0) return server;
  } catch (err) {
    serverError =
      err instanceof Error ? err : new Error("Could not compare swap routes.");
  }

  const lifi = await fetchLifiQuoteBrowser({
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountHuman: args.amount,
    fromAddress: args.fromAddress,
    slippageBps,
  });
  if (lifi) {
    const lifiExecution: SwapRouteExecution = {
      provider: "lifi",
      offer: lifi.offer,
      quote: lifi.quote,
    };
    return assembleSwapRoutes({
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      offers: [lifi.offer],
      executions: [lifiExecution],
      lifiExecution,
    });
  }

  try {
    const circle = await fetchCircleQuoteClient({ ...args, slippageBps });
    if (circle) {
      const circleExecution: SwapRouteExecution = {
        provider: "circle",
        offer: circle,
      };
      return assembleSwapRoutes({
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        offers: [circle],
        executions: [circleExecution],
        lifiExecution: null,
      });
    }
  } catch (err) {
    if (!serverError) {
      serverError =
        err instanceof Error ? err : new Error("Could not fetch Circle quote.");
    }
  }

  if (serverError) throw serverError;
  return { offers: [], best: null, executions: [], lifiExecution: null };
}

export async function fetchCircleQuoteClient(args: {
  tokenIn: AggregatorPairSymbol;
  tokenOut: AggregatorPairSymbol;
  amount: string;
  fromAddress: string;
  slippageBps?: number;
}): Promise<SwapRouteOffer | null> {
  let res: Response;
  try {
    res = await postSwapRoutesApi(
      {
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        amount: args.amount,
        fromAddress: args.fromAddress,
        circleOnly: true,
        ...(args.slippageBps != null ? { slippageBps: args.slippageBps } : {}),
      },
      CIRCLE_QUOTE_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "Circle quote timed out. This is usually Circle's API or your network — tap Refresh once.",
      );
    }
    throw err;
  }
  const data = (await res.json()) as { offer?: SwapRouteOffer | null; error?: string };
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Could not fetch Circle quote.",
    );
  }
  return data.offer ?? null;
}
