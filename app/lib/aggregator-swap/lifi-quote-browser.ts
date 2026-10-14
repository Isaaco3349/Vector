"use client";

import { parseUnits } from "viem";
import {
  aggregatorTokenAddress,
  tokenDecimals,
  type AggregatorPairSymbol,
} from "./tokens";
import {
  buildLifiQuoteUrl,
  lifiIntegratorCandidates,
  parseLifiQuoteJson,
} from "./lifi-quote-core";

const BROWSER_LIFI_TIMEOUT_MS = 28_000;

/**
 * Same LI.FI quote Arc Portal uses in the browser when Vector's server route is empty.
 * Portal loads li.quest from the client; wallet WebViews sometimes block server-side quotes.
 */
export async function fetchLifiQuoteBrowser(args: {
  tokenIn: AggregatorPairSymbol;
  tokenOut: AggregatorPairSymbol;
  amountHuman: string;
  fromAddress: string;
  slippageBps: number;
}): Promise<{ offer: import("./types").SwapRouteOffer; quote: unknown } | null> {
  const tokenIn = aggregatorTokenAddress(args.tokenIn);
  const tokenOut = aggregatorTokenAddress(args.tokenOut);
  if (!tokenIn || !tokenOut) return null;

  const amountIn = parseUnits(
    args.amountHuman.trim() as `${number}`,
    tokenDecimals(args.tokenIn),
  ).toString();

  for (const integrator of lifiIntegratorCandidates()) {
    const url = buildLifiQuoteUrl({
      tokenIn,
      tokenOut,
      amountIn,
      fromAddress: args.fromAddress,
      slippageBps: args.slippageBps,
      integrator,
    });

    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      BROWSER_LIFI_TIMEOUT_MS,
    );
    try {
      const res = await fetch(url.toString(), {
        headers: { accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) continue;
      const quote = await res.json();
      const parsed = parseLifiQuoteJson(quote, {
        tokenIn,
        tokenOut,
        tokenOutSymbol: args.tokenOut,
        amountIn,
      });
      if (parsed) return parsed;
    } catch {
      continue;
    } finally {
      window.clearTimeout(timer);
    }
  }

  return null;
}
