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

async function executeKyber(
  provider: Eip1193Provider,
  from: string,
  routeSummary: unknown,
  slippageBps: number,
  onStage?: (s: Stage) => void,
): Promise<{ txHash: string; approveTxHash: string }> {
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
    };
  };
  const payload = build.data;
  if (!payload?.data || !payload.routerAddress) {
    throw new Error("KyberSwap could not build this route. Try again.");
  }

  const tokenIn = (routeSummary as { tokenIn?: string })?.tokenIn;
  const amountIn = (routeSummary as { amountIn?: string })?.amountIn;
  if (!tokenIn || !amountIn) {
    throw new Error("Kyber route is missing token details.");
  }

  const approveTxHash = await approveExact(
    provider,
    from,
    tokenIn,
    payload.routerAddress,
    amountIn,
    onStage,
  );

  onStage?.("executing");
  const txHash = await sendTx(
    provider,
    from,
    payload.routerAddress,
    payload.data,
    payload.transactionValue ?? "0",
  );
  onStage?.("awaiting-execution");
  await waitReceipt(provider, txHash);
  return { txHash, approveTxHash };
}

async function executeLifi(
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

  const result = await executeLifi(
    args.provider,
    args.walletAddress,
    route.quote as Record<string, unknown>,
    args.onStage,
  );
  return { ...result, provider: "lifi" };
}
