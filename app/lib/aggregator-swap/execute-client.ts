"use client";

import { encodeFunctionData, erc20Abi } from "viem";
import type { Eip1193Provider } from "../appkit";
import { chainId as ARC_CHAIN_ID } from "../network";
import { executeSwapPlan } from "../external-swap";
import { buildSwapPlan, type SwapSymbol } from "../google-swap";
import type { SwapRouteExecution } from "./types";

const KYBER_CHAIN = "arc";
const KYBER_CLIENT_ID = "VectorProtocol";

type Stage = "approving" | "awaiting-approval" | "executing" | "awaiting-execution";

async function sendTx(
  provider: Eip1193Provider,
  from: string,
  to: string,
  data: string,
  value: string,
): Promise<string> {
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to,
        data,
        value: value.startsWith("0x") ? value : `0x${BigInt(value || "0").toString(16)}`,
        chainId: `0x${ARC_CHAIN_ID.toString(16)}`,
      },
    ],
  });
  if (typeof hash !== "string" || !hash.startsWith("0x")) {
    throw new Error("Wallet did not return a transaction hash.");
  }
  return hash;
}

async function waitReceipt(provider: Eip1193Provider, hash: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string | number } | null;
    if (receipt && typeof receipt === "object") {
      const s = receipt.status;
      const norm =
        typeof s === "number" ? `0x${s.toString(16)}` : String(s).toLowerCase();
      if (norm === "0x1") return;
      if (norm === "0x0") {
        throw new Error(`Transaction reverted on-chain (${hash}).`);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Transaction ${hash} has not confirmed yet.`);
}

async function approveExact(
  provider: Eip1193Provider,
  from: string,
  token: string,
  spender: string,
  amount: string,
  onStage?: (s: Stage) => void,
): Promise<string> {
  onStage?.("approving");
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender as `0x${string}`, BigInt(amount)],
  });
  const hash = await sendTx(provider, from, token, data, "0");
  onStage?.("awaiting-approval");
  await waitReceipt(provider, hash);
  return hash;
}

function kyberTokenAddress(routeSummary: unknown, key: "tokenIn" | "tokenOut"): string | null {
  const raw = (routeSummary as Record<string, unknown> | null)?.[key];
  if (typeof raw === "string" && /^0x[a-fA-F0-9]{40}$/.test(raw)) return raw;
  if (raw && typeof raw === "object") {
    const addr = (raw as { address?: string }).address;
    if (typeof addr === "string" && /^0x[a-fA-F0-9]{40}$/.test(addr)) return addr;
  }
  return null;
}

async function readErc20Balance(
  provider: Eip1193Provider,
  token: string,
  owner: string,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner as `0x${string}`],
  });
  const result = await provider.request({
    method: "eth_call",
    params: [{ to: token, data }, "latest"],
  });
  return BigInt(result as string);
}

async function readErc20Allowance(
  provider: Eip1193Provider,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner as `0x${string}`, spender as `0x${string}`],
  });
  const result = await provider.request({
    method: "eth_call",
    params: [{ to: token, data }, "latest"],
  });
  return BigInt(result as string);
}

async function fetchKyberRouteSummary(args: {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  to: string;
}): Promise<unknown> {
  const url = new URL(
    `https://aggregator-api.kyberswap.com/${KYBER_CHAIN}/api/v1/routes`,
  );
  url.searchParams.set("tokenIn", args.tokenIn);
  url.searchParams.set("tokenOut", args.tokenOut);
  url.searchParams.set("amountIn", args.amountIn);
  url.searchParams.set("to", args.to);
  const res = await fetch(url.toString(), {
    headers: { "X-Client-Id": KYBER_CLIENT_ID, accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error("KyberSwap could not refresh this route. Try again.");
  }
  const body = (await res.json()) as { data?: { routeSummary?: unknown } };
  const routeSummary = body.data?.routeSummary;
  if (!routeSummary) {
    throw new Error("KyberSwap returned no route for this amount.");
  }
  return routeSummary;
}

async function buildKyberSwapTx(
  routeSummary: unknown,
  from: string,
  slippageBps: number,
): Promise<{
  data: string;
  routerAddress: string;
  transactionValue: string;
  amountIn?: string;
}> {
  const buildRes = await fetch(
    `https://aggregator-api.kyberswap.com/${KYBER_CHAIN}/api/v1/route/build`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": KYBER_CLIENT_ID,
      },
      body: JSON.stringify({
        routeSummary,
        sender: from,
        recipient: from,
        slippageTolerance: slippageBps,
      }),
    },
  );
  const build = (await buildRes.json()) as {
    data?: {
      data?: string;
      routerAddress?: string;
      transactionValue?: string;
      amountIn?: string;
    };
  };
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

async function executeKyber(
  provider: Eip1193Provider,
  from: string,
  routeSummary: unknown,
  slippageBps: number,
  onStage?: (s: Stage) => void,
): Promise<{ txHash: string; approveTxHash: string }> {
  let summary = routeSummary;
  let tokenIn = kyberTokenAddress(summary, "tokenIn");
  let tokenOut = kyberTokenAddress(summary, "tokenOut");
  let amountInStr = (summary as { amountIn?: string })?.amountIn;
  if (!tokenIn || !tokenOut || !amountInStr || !/^\d+$/.test(amountInStr)) {
    throw new Error("Kyber route is missing token details.");
  }

  let balance = await readErc20Balance(provider, tokenIn, from);
  if (balance === BigInt(0)) {
    throw new Error("Your wallet has no balance of the token you are swapping.");
  }

  let quotedIn = BigInt(amountInStr);
  if (balance < quotedIn) {
    summary = await fetchKyberRouteSummary({
      tokenIn,
      tokenOut,
      amountIn: balance.toString(),
      to: from,
    });
    tokenIn = kyberTokenAddress(summary, "tokenIn") ?? tokenIn;
    tokenOut = kyberTokenAddress(summary, "tokenOut") ?? tokenOut;
    amountInStr = (summary as { amountIn?: string }).amountIn;
    if (!amountInStr || !/^\d+$/.test(amountInStr)) {
      throw new Error("Kyber could not quote your full balance. Try a slightly smaller amount.");
    }
    quotedIn = BigInt(amountInStr);
    balance = await readErc20Balance(provider, tokenIn, from);
  }

  let payload = await buildKyberSwapTx(summary, from, slippageBps);
  let approveAmount = payload.amountIn ? BigInt(payload.amountIn) : quotedIn;
  if (approveAmount > balance) {
    approveAmount = balance;
    summary = await fetchKyberRouteSummary({
      tokenIn,
      tokenOut,
      amountIn: approveAmount.toString(),
      to: from,
    });
    payload = await buildKyberSwapTx(summary, from, slippageBps);
    approveAmount = payload.amountIn ? BigInt(payload.amountIn) : approveAmount;
    if (approveAmount > balance) approveAmount = balance;
  }

  let approveTxHash = "0x";
  const allowance = await readErc20Allowance(
    provider,
    tokenIn,
    from,
    payload.routerAddress,
  );
  if (allowance < approveAmount) {
    approveTxHash = await approveExact(
      provider,
      from,
      tokenIn,
      payload.routerAddress,
      approveAmount.toString(),
      onStage,
    );
  }

  onStage?.("executing");
  const txHash = await sendTx(
    provider,
    from,
    payload.routerAddress,
    payload.data,
    payload.transactionValue,
  );
  onStage?.("awaiting-execution");
  await waitReceipt(provider, txHash);
  return { txHash, approveTxHash };
}

export async function executeLifiFromQuote(
  provider: Eip1193Provider,
  from: string,
  quote: Record<string, unknown>,
  onStage?: (s: Stage) => void,
): Promise<{ txHash: string; approveTxHash: string }> {
  const estimate = quote.estimate as Record<string, unknown> | undefined;
  const action = quote.action as Record<string, unknown> | undefined;
  const fromToken = action?.fromToken as { address?: string } | undefined;
  const fromAmount = action?.fromAmount as string | undefined;
  const approvalAddress = estimate?.approvalAddress as string | undefined;
  const txReq = quote.transactionRequest as
    | { to?: string; data?: string; value?: string }
    | undefined;

  if (!txReq?.to || !txReq.data) {
    throw new Error("LI.FI returned no executable transaction.");
  }

  let approveTxHash = "0x";
  if (
    approvalAddress &&
    fromToken?.address &&
    fromAmount &&
    /^0x[a-fA-F0-9]{40}$/.test(approvalAddress)
  ) {
    approveTxHash = await approveExact(
      provider,
      from,
      fromToken.address,
      approvalAddress,
      fromAmount,
      onStage,
    );
  }

  onStage?.("executing");
  const txHash = await sendTx(
    provider,
    from,
    txReq.to,
    txReq.data,
    txReq.value ?? "0",
  );
  onStage?.("awaiting-execution");
  await waitReceipt(provider, txHash);
  return { txHash, approveTxHash };
}

export async function executeSwapRoute(args: {
  provider: Eip1193Provider;
  walletAddress: string;
  tokenIn: SwapSymbol;
  tokenOut: SwapSymbol;
  amountIn: string;
  route: SwapRouteExecution;
  slippageBps: number;
  onStage?: (s: Stage) => void;
}): Promise<{ txHash: string; approveTxHash: string; provider: string }> {
  const { route } = args;

  if (route.provider === "circle") {
    const plan = await buildSwapPlan({
      walletAddress: args.walletAddress,
      fromSymbol: args.tokenIn,
      toSymbol: args.tokenOut,
      amount: args.amountIn,
      usdcApprovalStyle: "erc20Approve",
      slippageBps: args.slippageBps,
    });
    const result = await executeSwapPlan({
      provider: args.provider,
      from: args.walletAddress,
      plan,
      onStage: args.onStage,
    });
    return {
      txHash: result.executeTxHash,
      approveTxHash: result.approveTxHash,
      provider: "circle",
    };
  }

  if (route.provider === "kyber") {
    const result = await executeKyber(
      args.provider,
      args.walletAddress,
      route.routeSummary,
      args.slippageBps,
      args.onStage,
    );
    return { ...result, provider: "kyber" };
  }

  const result = await executeLifiFromQuote(
    args.provider,
    args.walletAddress,
    route.quote as Record<string, unknown>,
    args.onStage,
  );
  return { ...result, provider: "lifi" };
}
