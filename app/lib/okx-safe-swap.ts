"use client";

import type { Eip1193Provider } from "./appkit";
import { executeSwapPlan } from "./external-swap";
import { buildSwapPlan, type SwapSymbol } from "./google-swap";

/**
 * OKX-safe swap: Circle POST /swap plan + approve → execute as plain
 * `eth_sendTransaction` only (no App Kit permit / batch paths).
 */
export async function executeSwapViaSequentialTransactions(args: {
  provider: Eip1193Provider;
  walletAddress: string;
  tokenIn: SwapSymbol;
  tokenOut: SwapSymbol;
  amountIn: string;
  onStage?: Parameters<typeof executeSwapPlan>[0]["onStage"];
}): Promise<{ txHash: string; approveTxHash: string }> {
  const plan = await buildSwapPlan({
    walletAddress: args.walletAddress,
    fromSymbol: args.tokenIn,
    toSymbol: args.tokenOut,
    amount: args.amountIn,
  });

  const result = await executeSwapPlan({
    provider: args.provider,
    from: args.walletAddress,
    plan,
    onStage: args.onStage,
  });

  if (typeof console !== "undefined") {
    console.info("[Vector] swap: OKX-safe sequential path (eth_sendTransaction only)");
  }

  return {
    txHash: result.executeTxHash,
    approveTxHash: result.approveTxHash,
  };
}
