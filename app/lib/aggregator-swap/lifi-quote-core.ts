import { formatUnits } from "viem";
import { isMainnet } from "../network";
import { formatLifiOfferLabel } from "./lifi-label";
import type { AggregatorPairSymbol } from "./tokens";
import { tokenDecimals } from "./tokens";
import type { SwapRouteOffer } from "./types";

/** Match Arc Portal default on [portal.arc.io/swap](https://portal.arc.io/swap). */
export const PORTAL_LIKE_SLIPPAGE = 0.005;

const ARC_CHAIN_ID = isMainnet ? 5042 : 5042002;

export function lifiIntegratorCandidates(): string[] {
  const custom =
    process.env.LIFI_INTEGRATOR?.trim() ||
    process.env.NEXT_PUBLIC_LIFI_INTEGRATOR?.trim() ||
    "vectorprotocol";
  return ["lifi-api", custom, "lifi-sdk", ""].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
}

export function buildLifiQuoteUrl(args: {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: string;
  fromAddress: string;
  slippageBps: number;
  integrator: string;
}): URL {
  const slippage = Math.min(
    Math.max(args.slippageBps / 10_000, PORTAL_LIKE_SLIPPAGE),
    0.5,
  );
  const url = new URL("https://li.quest/v1/quote");
  url.searchParams.set("fromChain", String(ARC_CHAIN_ID));
  url.searchParams.set("toChain", String(ARC_CHAIN_ID));
  url.searchParams.set("fromToken", args.tokenIn);
  url.searchParams.set("toToken", args.tokenOut);
  url.searchParams.set("fromAmount", args.amountIn);
  url.searchParams.set("fromAddress", args.fromAddress);
  url.searchParams.set("toAddress", args.fromAddress);
  url.searchParams.set("slippage", String(slippage));
  if (args.integrator) {
    url.searchParams.set("integrator", args.integrator);
  }
  url.searchParams.set("order", "RECOMMENDED");
  return url;
}

export function parseLifiQuoteJson(
  quote: unknown,
  args: {
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    tokenOutSymbol: AggregatorPairSymbol;
    amountIn: string;
  },
): { offer: SwapRouteOffer; quote: unknown } | null {
  if (!quote || typeof quote !== "object") return null;
  const q = quote as Record<string, unknown>;
  const txReq = q.transactionRequest as
    | { to?: string; data?: string }
    | undefined;
  if (!txReq?.to || !txReq?.data) return null;
  const estimate = q.estimate as Record<string, unknown> | undefined;
  const action = q.action as Record<string, unknown> | undefined;
  const amountOut =
    estimate?.toAmount ?? q.toAmount ?? action?.toAmount;
  if (typeof amountOut !== "string" || !/^\d+$/.test(amountOut)) return null;

  const lifiLabels = formatLifiOfferLabel(quote);
  const offer: SwapRouteOffer = {
    provider: "lifi",
    amountOut,
    amountOutHuman: formatUnits(
      BigInt(amountOut),
      tokenDecimals(args.tokenOutSymbol),
    ),
    tokenInAddress: args.tokenIn,
    tokenOutAddress: args.tokenOut,
    amountIn: args.amountIn,
    label: lifiLabels.label,
    sublabel: lifiLabels.sublabel,
  };
  return { offer, quote };
}
