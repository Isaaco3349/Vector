"use client";

import { encodeFunctionData, erc20Abi } from "viem";
import type { Eip1193Provider } from "../appkit";
import { chainId as ARC_CHAIN_ID } from "../network";
import { executeSwapPlan } from "../external-swap";
import { buildSwapPlan, type SwapSymbol } from "../google-swap";
import {
  invalidateArcAllowanceReadCache,
  readErc20AllowanceForSwap,
  readSwapInputBalanceForSwap,
} from "../arc-erc20-read";
import { waitArcTransactionReceipt } from "../arc-tx-wait";
import { okxInAppBrowser } from "../wallet-brand";
import { buildKyberSwapTx, fetchKyberRouteSummary } from "./kyber-client";
import type { SwapRouteExecution } from "./types";

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
  await waitArcTransactionReceipt(provider, hash);
  invalidateArcAllowanceReadCache(token, from, spender);
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

async function readInputBalance(
  provider: Eip1193Provider,
  token: string,
  owner: `0x${string}`,
): Promise<bigint> {
  return readSwapInputBalanceForSwap(provider, token, owner, {
    preferWallet: !okxInAppBrowser(),
  });
}

async function readErc20Allowance(
  provider: Eip1193Provider,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  return readErc20AllowanceForSwap(provider, token, owner, spender, {
    preferWallet: !okxInAppBrowser(),
  });
}

function parseKyberAmountIn(routeSummary: unknown): bigint | null {
  const amountIn = (routeSummary as { amountIn?: string })?.amountIn;
  if (!amountIn || !/^\d+$/.test(amountIn)) return null;
  return BigInt(amountIn);
}

/** Cap sell size to on-chain balance; shave 1 wei on full-balance sells (aggregator rounding). */
function kyberSpendCap(balance: bigint, quotedIn: bigint): bigint {
  const cap = balance < quotedIn ? balance : quotedIn;
  if (cap >= balance && balance > BigInt(1)) return balance - BigInt(1);
  return cap;
}

type KyberPrepared = {
  summary: unknown;
  payload: Awaited<ReturnType<typeof buildKyberSwapTx>>;
  swapAmountIn: bigint;
};

async function prepareKyberFromSummary(
  provider: Eip1193Provider,
  from: string,
  tokenIn: string,
  tokenOut: string,
  routeSummary: unknown,
  slippageBps: number,
): Promise<KyberPrepared> {
  const quotedIn = parseKyberAmountIn(routeSummary);
  if (quotedIn === null) {
    throw new Error("Kyber route is missing amountIn.");
  }
  const balance = await readInputBalance(provider, tokenIn, from as `0x${string}`);
  if (balance === BigInt(0)) {
    throw new Error("Your wallet has no balance of the token you are swapping.");
  }

  let summary = routeSummary;
  const spend = kyberSpendCap(balance, quotedIn);
  if (spend !== quotedIn) {
    summary = await fetchKyberRouteSummary({
      tokenIn,
      tokenOut,
      amountIn: spend.toString(),
      to: from,
    });
  }

  const payload = await buildKyberSwapTx(summary, from, slippageBps);
  const routeIn = parseKyberAmountIn(summary);
  const swapAmountIn = payload.amountIn ? BigInt(payload.amountIn) : routeIn;
  if (!swapAmountIn || swapAmountIn > balance) {
    throw new Error(
      "Kyber could not fit this swap to your wallet balance. Try a slightly smaller amount.",
    );
  }
  return { summary, payload, swapAmountIn: swapAmountIn ?? spend };
}

async function ensureKyberAllowance(
  provider: Eip1193Provider,
  from: string,
  tokenIn: string,
  routerAddress: string,
  amount: bigint,
  onStage: ((s: Stage) => void) | undefined,
  existingApproveHash: string,
): Promise<string> {
  const allowance = await readErc20Allowance(provider, tokenIn, from, routerAddress);
  if (allowance >= amount) return existingApproveHash;
  const hash = await approveExact(
    provider,
    from,
    tokenIn,
    routerAddress,
    amount.toString(),
    onStage,
  );
  return existingApproveHash === "0x" ? hash : existingApproveHash;
}

async function executeKyber(
  provider: Eip1193Provider,
  from: string,
  routeSummary: unknown,
  slippageBps: number,
  onStage?: (s: Stage) => void,
): Promise<{ txHash: string; approveTxHash: string }> {
  const tokenIn = kyberTokenAddress(routeSummary, "tokenIn");
  const tokenOut = kyberTokenAddress(routeSummary, "tokenOut");
  const quotedIn = parseKyberAmountIn(routeSummary);
  if (!tokenIn || !tokenOut || quotedIn === null) {
    throw new Error("Kyber route is missing token details.");
  }

  let prepared = await prepareKyberFromSummary(
    provider,
    from,
    tokenIn,
    tokenOut,
    routeSummary,
    slippageBps,
  );

  const allowanceBefore = await readErc20Allowance(
    provider,
    tokenIn,
    from,
    prepared.payload.routerAddress,
  );
  let approveTxHash = "0x";
  const needsFreshApprove = allowanceBefore < prepared.swapAmountIn;

  if (needsFreshApprove) {
    approveTxHash = await ensureKyberAllowance(
      provider,
      from,
      tokenIn,
      prepared.payload.routerAddress,
      prepared.swapAmountIn,
      onStage,
      "0x",
    );
    prepared = await prepareKyberFromSummary(
      provider,
      from,
      tokenIn,
      tokenOut,
      prepared.summary,
      slippageBps,
    );
  }

  onStage?.("executing");
  const txHash = await sendTx(
    provider,
    from,
    prepared.payload.routerAddress,
    prepared.payload.data,
    prepared.payload.transactionValue,
  );
  onStage?.("awaiting-execution");
  await waitArcTransactionReceipt(provider, txHash);
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
  await waitArcTransactionReceipt(provider, txHash);
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
