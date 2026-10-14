/**
 * Server-side swap quotes: Circle stablecoin kit, KyberSwap, Li.Fi on Arc.
 * Picks the highest `amountOut` for the same tokenIn/amountIn.
 */

import { formatUnits, parseUnits } from "viem";
import { swapCustomFeeConfig } from "../fees";
import { isMainnet } from "../network";
import { assembleSwapRoutes } from "./assemble-swap-routes";
import {
  buildLifiQuoteUrl,
  lifiIntegratorCandidates,
  parseLifiQuoteJson,
} from "./lifi-quote-core";
import {
  aggregatorTokenAddress,
  circleTokenAddress,
  tokenDecimals,
  type AggregatorPairSymbol,
} from "./tokens";
import { pairIncludesCirBtc, swapProviderExecutable } from "./routing-policy";
import type { SwapRouteExecution, SwapRouteOffer } from "./types";

const KYBER_CHAIN = isMainnet ? "arc" : "arct";
const KYBER_CLIENT_ID = "VectorProtocol";

const CIRCLE_BASE_URL =
  process.env.NEXT_PUBLIC_CIRCLE_BASE_URL ?? "https://api.circle.com";

/** Don't let a slow Kyber/LI.FI leg block the whole quote comparison. */
const UPSTREAM_QUOTE_TIMEOUT_MS = 14_000;
const LIFI_CIRBTC_QUOTE_TIMEOUT_MS = 24_000;

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = UPSTREAM_QUOTE_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
  timeoutMs?: number;
}): Promise<{ offer: SwapRouteOffer; quote: unknown } | null> {
  for (const integrator of lifiIntegratorCandidates()) {
    const url = buildLifiQuoteUrl({
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountIn: args.amountIn,
      fromAddress: args.fromAddress,
      slippageBps: args.slippageBps,
      integrator,
    });

    let res: Response;
    try {
      res = await fetchWithTimeout(
        url.toString(),
        {
          headers: { accept: "application/json" },
        },
        args.timeoutMs ?? UPSTREAM_QUOTE_TIMEOUT_MS,
      );
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const quote = await res.json();
    const parsed = parseLifiQuoteJson(quote, {
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      tokenOutSymbol: args.tokenOutSymbol,
      amountIn: args.amountIn,
    });
    if (parsed) return parsed;
  }

  return null;
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
  const cirBtcPair = pairIncludesCirBtc(args.tokenIn, args.tokenOut);
  const includeKyber =
    isMainnet &&
    !cirBtcPair &&
    process.env.VECTOR_ENABLE_KYBER_SWAP !== "0";

  const lifiArgs = {
    tokenIn: aggIn,
    tokenOut: aggOut,
    tokenOutSymbol: args.tokenOut,
    amountIn,
    fromAddress: args.fromAddress,
    slippageBps: args.slippageBps,
    timeoutMs: cirBtcPair ? LIFI_CIRBTC_QUOTE_TIMEOUT_MS : undefined,
  };

  let lifiPromise = quoteLifi(lifiArgs);
  const circlePromise = quoteCircle({
    tokenIn: circleIn,
    tokenOut: circleOut,
    tokenOutSymbol: args.tokenOut,
    amountIn,
    amountHuman: args.amountHuman,
    fromAddress: args.fromAddress,
    slippageBps: args.slippageBps,
  });
  const kyberPromise = includeKyber
    ? quoteKyber({
        tokenIn: aggIn,
        tokenOut: aggOut,
        tokenOutSymbol: args.tokenOut,
        amountIn,
        fromAddress: args.fromAddress,
        slippageBps: args.slippageBps,
      })
    : Promise.resolve(null);

  let lifi = await lifiPromise;
  const [kyber, circle] = await Promise.all([kyberPromise, circlePromise]);
  if (cirBtcPair && !lifi) {
    lifi = await quoteLifi({
      ...lifiArgs,
      timeoutMs: LIFI_CIRBTC_QUOTE_TIMEOUT_MS,
    });
  }

  const offers: SwapRouteOffer[] = [
    ...(kyber ? [kyber.offer] : []),
    ...(lifi ? [lifi.offer] : []),
    ...(circle ? [circle] : []),
  ];

  const executions: SwapRouteExecution[] = [];
  if (circle) {
    executions.push({ provider: "circle", offer: circle });
  }
  if (kyber && swapProviderExecutable("kyber", args.tokenIn, args.tokenOut, isMainnet)) {
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

  const lifiExecution: SwapRouteExecution | null =
    lifi != null
      ? { provider: "lifi", offer: lifi.offer, quote: lifi.quote }
      : null;

  return assembleSwapRoutes({
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    offers,
    executions,
    lifiExecution,
  });
}
