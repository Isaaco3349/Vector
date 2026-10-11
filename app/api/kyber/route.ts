import { NextResponse } from "next/server";
import { isMainnet } from "../../lib/network";
import {
  rejectIfDisallowedOrigin,
  rejectIfRateLimited,
} from "../../lib/endpoints-abuse-guard";

const KYBER_CHAIN = "arc";
const KYBER_CLIENT_ID = "VectorProtocol";

export async function POST(request: Request) {
  const originBlock = rejectIfDisallowedOrigin(request);
  if (originBlock) return originBlock;

  const rateBlock = rejectIfRateLimited(request, "kyber");
  if (rateBlock) return rateBlock;

  if (!isMainnet) {
    return NextResponse.json(
      { error: "Kyber proxy is enabled on Arc mainnet only." },
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
  const op = params.op;

  try {
    if (op === "routes") {
      const tokenIn = params.tokenIn;
      const tokenOut = params.tokenOut;
      const amountIn = params.amountIn;
      const to = params.to;
      if (
        typeof tokenIn !== "string" ||
        typeof tokenOut !== "string" ||
        typeof amountIn !== "string" ||
        typeof to !== "string"
      ) {
        return NextResponse.json({ error: "Invalid routes params." }, { status: 400 });
      }
      const url = new URL(
        `https://aggregator-api.kyberswap.com/${KYBER_CHAIN}/api/v1/routes`,
      );
      url.searchParams.set("tokenIn", tokenIn);
      url.searchParams.set("tokenOut", tokenOut);
      url.searchParams.set("amountIn", amountIn);
      url.searchParams.set("to", to);
      const res = await fetch(url.toString(), {
        headers: { "X-Client-Id": KYBER_CLIENT_ID, accept: "application/json" },
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.ok ? 200 : 502 });
    }

    if (op === "build") {
      const routeSummary = params.routeSummary;
      const sender = params.sender;
      const recipient = params.recipient;
      const slippageBps = params.slippageBps;
      if (
        routeSummary === undefined ||
        typeof sender !== "string" ||
        typeof recipient !== "string" ||
        typeof slippageBps !== "number"
      ) {
        return NextResponse.json({ error: "Invalid build params." }, { status: 400 });
      }
      const res = await fetch(
        `https://aggregator-api.kyberswap.com/${KYBER_CHAIN}/api/v1/route/build`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Id": KYBER_CLIENT_ID,
          },
          body: JSON.stringify({
            routeSummary,
            sender,
            recipient,
            slippageTolerance: slippageBps,
          }),
        },
      );
      const data = await res.json();
      return NextResponse.json(data, { status: res.ok ? 200 : 502 });
    }

    return NextResponse.json({ error: "Unknown op." }, { status: 400 });
  } catch (err) {
    console.error("[Vector] kyber proxy failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kyber proxy failed." },
      { status: 502 },
    );
  }
}
