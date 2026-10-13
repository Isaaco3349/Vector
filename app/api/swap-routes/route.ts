import { NextResponse } from "next/server";
import {
  fetchCircleOnlyQuote,
  fetchSwapRouteOffers,
} from "../../lib/aggregator-swap/quotes-server";
import type { AggregatorPairSymbol } from "../../lib/aggregator-swap/tokens";
import {
  rejectIfDisallowedOrigin,
  rejectIfRateLimited,
} from "../../lib/endpoints-abuse-guard";
import { isMainnet } from "../../lib/network";

const DEFAULT_SLIPPAGE_BPS = 300;

export async function POST(request: Request) {
  const originBlock = rejectIfDisallowedOrigin(request);
  if (originBlock) return originBlock;

  const rateBlock = rejectIfRateLimited(request, "swap-routes");
  if (rateBlock) return rateBlock;

  if (!isMainnet) {
    return NextResponse.json(
      {
        error:
          "Multi-route swap quotes (Kyber / LI.FI) are enabled on Arc mainnet only.",
      },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const params = body as Record<string, unknown>;
  const tokenIn = params.tokenIn as AggregatorPairSymbol;
  const tokenOut = params.tokenOut as AggregatorPairSymbol;
  const amount = params.amount;
  const fromAddress = params.fromAddress;
  const slippageBps =
    typeof params.slippageBps === "number" && Number.isFinite(params.slippageBps)
      ? params.slippageBps
      : DEFAULT_SLIPPAGE_BPS;

  const allowed = new Set(["USDC", "EURC", "cirBTC"]);
  if (
    !allowed.has(tokenIn) ||
    !allowed.has(tokenOut) ||
    tokenIn === tokenOut
  ) {
    return NextResponse.json({ error: "Unsupported token pair." }, { status: 400 });
  }

  if (typeof amount !== "string" || !/^\d+(\.\d+)?$/.test(amount.trim())) {
    return NextResponse.json({ error: "Invalid amount." }, { status: 400 });
  }

  if (typeof fromAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(fromAddress)) {
    return NextResponse.json({ error: "Invalid fromAddress." }, { status: 400 });
  }

  try {
    if (params.circleOnly === true) {
      const offer = await fetchCircleOnlyQuote({
        tokenIn,
        tokenOut,
        amountHuman: amount.trim(),
        fromAddress,
        slippageBps,
      });
      return NextResponse.json({ offer }, { status: 200 });
    }

    const result = await fetchSwapRouteOffers({
      tokenIn,
      tokenOut,
      amountHuman: amount.trim(),
      fromAddress,
      slippageBps,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[Vector] swap-routes failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not fetch swap routes.",
      },
      { status: 502 },
    );
  }
}
