"use client";

async function kyberRoutes(args: {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  to: string;
}): Promise<{ data?: { routeSummary?: unknown } }> {
  const res = await fetch("/api/kyber", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "routes", ...args }),
  });
  const body = (await res.json()) as { data?: { routeSummary?: unknown }; error?: string };
  if (!res.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : "KyberSwap could not refresh this route.",
    );
  }
  return body;
}

export async function fetchKyberRouteSummary(args: {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  to: string;
}): Promise<unknown> {
  const body = await kyberRoutes(args);
  const routeSummary = body.data?.routeSummary;
  if (!routeSummary) {
    throw new Error("KyberSwap returned no route for this amount.");
  }
  return routeSummary;
}

export async function buildKyberSwapTx(
  routeSummary: unknown,
  from: string,
  slippageBps: number,
): Promise<{
  data: string;
  routerAddress: string;
  transactionValue: string;
  amountIn?: string;
}> {
  const buildRes = await fetch("/api/kyber", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      op: "build",
      routeSummary,
      sender: from,
      recipient: from,
      slippageBps,
    }),
  });
  const build = (await buildRes.json()) as {
    data?: {
      data?: string;
      routerAddress?: string;
      transactionValue?: string;
      amountIn?: string;
    };
    error?: string;
  };
  if (!buildRes.ok) {
    throw new Error(
      typeof build.error === "string" ? build.error : "KyberSwap could not build this route.",
    );
  }
  const payload = build.data;
  if (!payload?.data || !payload.routerAddress) {
    throw new Error("KyberSwap could not build this route. Try again.");
  }
  return {
    data: payload.data,
    routerAddress: payload.routerAddress,
    transactionValue: payload.transactionValue ?? "0",
    amountIn: payload.amountIn,
  };
}
