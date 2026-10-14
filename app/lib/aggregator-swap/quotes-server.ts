/**
 * Server-side swap quotes: Circle stablecoin kit, KyberSwap, Li.Fi on Arc.
 * Picks the highest `amountOut` for the same tokenIn/amountIn.
 */

import { formatUnits, parseUnits } from "viem";
import { swapCustomFeeConfig } from "../fees";
import { isMainnet } from "../network";
import {
  aggregatorTokenAddress,
  circleTokenAddress,
  tokenDecimals,
  type AggregatorPairSymbol,
} from "./tokens";
import { formatLifiOfferLabel } from "./lifi-label";
import type { SwapRouteExecution, SwapRouteOffer } from "./types";

const ARC_CHAIN_ID = isMainnet ? 5042 : 5042002;
const KYBER_CHAIN = isMainnet ? "arc" : "arct";
const LIFI_INTEGRATOR = "vectorprotocol";
const KYBER_CLIENT_ID = "VectorProtocol";

const CIRCLE_BASE_URL =
  process.env.NEXT_PUBLIC_CIRCLE_BASE_URL ?? "https://api.circle.com";

/** Don't let a slow Kyber/LI.FI leg block the whole quote comparison. */
const UPSTREAM_QUOTE_TIMEOUT_MS = 14_000;

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_QUOTE_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseAmountBase(symbol: AggregatorPairSymbol, amountHuman: string): string {
  const dec = tokenDecimals(symbol);
  return parseUnits(amountHuman.trim() as `${number}`, dec).toString();
}

function withHumanOut(
  offer: Omit<SwapRouteOffer, "amountOutHuman">,
  tokenOut: AggregatorPairSymbol,
): SwapRouteOffer {
  return {
    ...offer,
    amountOutHuman: formatUnits(
      BigInt(offer.amountOut),
      tokenDecimals(tokenOut),
    ),
  };
}

async function quoteKyber(args: {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  tokenOutSymbol: AggregatorPairSymbol;
  amountIn: string;
  fromAddress: string;
  slippageBps: number;
}): Promise<{ offer: SwapRouteOffer; routeSummary: unknown } | null> {
  const url = new URL(
    `https://aggregator-api.kyberswap.com/${KYBER_CHAIN}/api/v1/routes`,
  );
  url.searchParams.set("tokenIn", args.tokenIn);
  url.searchParams.set("tokenOut", args.tokenOut);
  url.searchParams.set("amountIn", args.amountIn);
  url.searchParams.set("to", args.fromAddress);

  let res: Response;
  try {
    res = await fetchWithTimeout(url.toString(), {
      headers: { "X-Client-Id": KYBER_CLIENT_ID, accept: "application/json" },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json()) as {
    data?: { routeSummary?: { amountOut?: string } };
  };
  const routeSummary = body.data?.routeSummary;
  const amountOut = routeSummary?.amountOut;
  if (!routeSummary || !amountOut || !/^\d+$/.test(amountOut)) return null;

  return {
    routeSummary,
    offer: withHumanOut(
      {
        provider: "kyber",
        amountOut,
        tokenInAddress: args.tokenIn,
        tokenOutAddress: args.tokenOut,
        amountIn: args.amountIn,
        label: "KyberSwap",
        sublabel: "Kyber aggregator on Arc",
      },
      args.tokenOutSymbol,
    ),
  };
}

async function quoteLifi(args: {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  tokenOutSymbol: AggregatorPairSymbol;
  amountIn: string;
  fromAddress: string;
  slippageBps: number;
}): Promise<{ offer: SwapRouteOffer; quote: unknown } | null> {
  const slippage = Math.min(Math.max(args.slippageBps / 10_000, 0.001), 0.5);
  const url = new URL("https://li.quest/v1/quote");
  url.searchParams.set("fromChain", String(ARC_CHAIN_ID));
  url.searchParams.set("toChain", String(ARC_CHAIN_ID));
  url.searchParams.set("fromToken", args.tokenIn);
  url.searchParams.set("toToken", args.tokenOut);
  url.searchParams.set("fromAmount", args.amountIn);
  url.searchParams.set("fromAddress", args.fromAddress);
  url.searchParams.set("slippage", String(slippage));
  url.searchParams.set("integrator", LIFI_INTEGRATOR);
  url.searchParams.set("order", "CHEAPEST_GAS");

  let res: Response;
  try {
    res = await fetchWithTimeout(url.toString(), {
      headers: { accept: "application/json" },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const quote = await res.json();
  const amountOut =
    quote?.estimate?.toAmount ??
    quote?.toAmount ??
    quote?.action?.toAmount;
  if (typeof amountOut !== "string" || !/^\d+$/.test(amountOut)) return null;

  const lifiLabels = formatLifiOfferLabel(quote);
  return {
    quote,
    offer: withHumanOut(
      {
        provider: "lifi",
        amountOut,
        tokenInAddress: args.tokenIn,
        tokenOutAddress: args.tokenOut,
        amountIn: args.amountIn,
        label: lifiLabels.label,
        sublabel: lifiLabels.sublabel,
      },
      args.tokenOutSymbol,
    ),
  };
}

async function quoteCircle(args: {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  tokenOutSymbol: AggregatorPairSymbol;
  amountIn: string;
  amountHuman: string;
  fromAddress: string;
  slippageBps: number;
}): Promise<SwapRouteOffer | null> {
  const swapBody: Record<string, unknown> = {
    tokenInAddress: args.tokenIn,
    tokenInChain: isMainnet ? "Arc" : "Arc_Testnet",
    tokenOutAddress: args.tokenOut,
    tokenOutChain: isMainnet ? "Arc" : "Arc_Testnet",
    fromAddress: args.fromAddress,
    toAddress: args.fromAddress,
    amount: args.amountIn,
    slippageBps: args.slippageBps,
    config: swapCustomFeeConfig(args.amountHuman),
  };

  let res: Response;
  try {
    res = await fetchWithTimeout(`${CIRCLE_BASE_URL}/v1/stablecoinKits/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(swapBody),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  const rawEstimate = data?.estimatedAmount;
  if (typeof rawEstimate !== "string" || !/^\d+$/.test(rawEstimate)) {
    return null;
  }

  return withHumanOut(
    {
      provider: "circle",
      amountOut: rawEstimate,
      tokenInAddress: args.tokenIn,
      tokenOutAddress: args.tokenOut,
      amountIn: args.amountIn,
      label: "Circle",
      sublabel: "Stablecoin Kit (USDC gas)",
    },
    args.tokenOutSymbol,
  );
}

function pickBest(offers: SwapRouteOffer[]): SwapRouteOffer | null {
  if (offers.length === 0) return null;
  return offers.reduce((best, cur) =>
    BigInt(cur.amountOut) > BigInt(best.amountOut) ? cur : best,
  );
}

/** Server-only Circle quote — no wallet App Kit, no Kyber. Used for USDC ↔ EURC fast path. */
export async function fetchCircleOnlyQuote(args: {
  tokenIn: AggregatorPairSymbol;
  tokenOut: AggregatorPairSymbol;
  amountHuman: string;
  fromAddress: string;
  slippageBps: number;
}): Promise<SwapRouteOffer | null> {
  const circleIn = circleTokenAddress(args.tokenIn);
  const circleOut = circleTokenAddress(args.tokenOut);
  if (!circleIn || !circleOut) return null;
  const amountIn = parseAmountBase(args.tokenIn, args.amountHuman);
  return quoteCircle({
    tokenIn: circleIn,
    tokenOut: circleOut,
    tokenOutSymbol: args.tokenOut,
    amountIn,
    amountHuman: args.amountHuman,
    fromAddress: args.fromAddress,
    slippageBps: args.slippageBps,
  });
}

export async function fetchSwapRouteOffers(args: {
  tokenIn: AggregatorPairSymbol;
  tokenOut: AggregatorPairSymbol;
  amountHuman: string;
  fromAddress: string;
  slippageBps: number;
}): Promise<{
  offers: SwapRouteOffer[];
  best: SwapRouteExecution | null;
  executions: SwapRouteExecution[];
  lifiExecution?: SwapRouteExecution | null;
}> {
  const aggIn = aggregatorTokenAddress(args.tokenIn);
  const aggOut = aggregatorTokenAddress(args.tokenOut);
  const circleIn = circleTokenAddress(args.tokenIn);
  const circleOut = circleTokenAddress(args.tokenOut);
  if (!aggIn || !aggOut || !circleIn || !circleOut) {
    return { offers: [], best: null, executions: [] };
  }

  const amountIn = parseAmountBase(args.tokenIn, args.amountHuman);

  const [kyber, lifi, circle] = await Promise.all([
    quoteKyber({
      tokenIn: aggIn,
      tokenOut: aggOut,
      tokenOutSymbol: args.tokenOut,
      amountIn,
      fromAddress: args.fromAddress,
      slippageBps: args.slippageBps,
    }),
    quoteLifi({
      tokenIn: aggIn,
      tokenOut: aggOut,
      tokenOutSymbol: args.tokenOut,
      amountIn,
      fromAddress: args.fromAddress,
      slippageBps: args.slippageBps,
    }),
    quoteCircle({
      tokenIn: circleIn,
      tokenOut: circleOut,
      tokenOutSymbol: args.tokenOut,
      amountIn,
      amountHuman: args.amountHuman,
      fromAddress: args.fromAddress,
      slippageBps: args.slippageBps,
    }),
  ]);

  const offers: SwapRouteOffer[] = [
    ...(kyber ? [kyber.offer] : []),
    ...(lifi ? [lifi.offer] : []),
    ...(circle ? [circle] : []),
  ];

  const executions: SwapRouteExecution[] = [];
  if (circle) {
    executions.push({ provider: "circle", offer: circle });
  }
  if (kyber) {
    executions.push({
      provider: "kyber",
      offer: kyber.offer,
      routeSummary: kyber.routeSummary,
    });
  }
  if (lifi) {
    executions.push({
      provider: "lifi",
      offer: lifi.offer,
      quote: lifi.quote,
    });
  }

  const bestOffer = pickBest(offers);
  const lifiExecution: SwapRouteExecution | null =
    lifi != null
      ? { provider: "lifi", offer: lifi.offer, quote: lifi.quote }
      : null;

  if (!bestOffer) {
    return { offers, best: null, executions, lifiExecution };
  }

  const best =
    executions.find((e) => e.offer.provider === bestOffer.provider) ?? null;

  return { offers, best, executions, lifiExecution };
}
