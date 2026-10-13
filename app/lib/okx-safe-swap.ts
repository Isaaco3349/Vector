"use client";

import type { Eip1193Provider } from "./appkit";
import {
  executeSwapRoute,
  type SwapRouteStage,
} from "./aggregator-swap/execute-client";
import { fetchSwapRoutesClient } from "./aggregator-swap/fetch-routes-client";
import { isMainnet } from "./network";
import type { AggregatorPairSymbol } from "./aggregator-swap/tokens";
import type { SwapSymbol } from "./google-swap";
import { executeSwapPlan } from "./external-swap";
import { buildSwapPlan } from "./google-swap";

const DEFAULT_SLIPPAGE_BPS = 300;

function isAggregatorPair(s: SwapSymbol): s is AggregatorPairSymbol {
  return s === "USDC" || s === "EURC" || s === "cirBTC";
}

/**
 * OKX-safe swap: compare Circle + Kyber + LI.FI on mainnet, then approve →
 * execute as plain `eth_sendTransaction` only (exact allowance, no permit/batch).
 */
export async function executeSwapViaSequentialTransactions(args: {
  provider: Eip1193Provider;
  walletAddress: string;
  tokenIn: SwapSymbol;
  tokenOut: SwapSymbol;
  amountIn: string;
  slippageBps?: number;
  onStage?: (stage: SwapRouteStage) => void;
}): Promise<{ txHash: string; approveTxHash: string; provider?: string }> {
  const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

  if (isMainnet && isAggregatorPair(args.tokenIn) && isAggregatorPair(args.tokenOut)) {
    try {
      const routes = await fetchSwapRoutesClient({
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        amount: args.amountIn,
        fromAddress: args.walletAddress,
        slippageBps,
      });
      if (routes.best) {
        const result = await executeSwapRoute({
          provider: args.provider,
          walletAddress: args.walletAddress,
          tokenIn: args.tokenIn,
          tokenOut: args.tokenOut,
          amountIn: args.amountIn,
          route: routes.best,
          slippageBps,
          onStage: args.onStage,
        });
        console.info(
          `[Vector] swap: OKX-safe sequential via ${result.provider} (eth_sendTransaction only)`,
        );
        return result;
      }
    } catch (err) {
      console.warn("[Vector] multi-route swap failed, falling back to Circle:", err);
    }
  }

  const plan = await buildSwapPlan({
    walletAddress: args.walletAddress,
    fromSymbol: args.tokenIn,
    toSymbol: args.tokenOut,
    amount: args.amountIn,
    usdcApprovalStyle: "erc20Approve",
    slippageBps,
  });

  const result = await executeSwapPlan({
    provider: args.provider,
    from: args.walletAddress,
    plan,
    onStage: args.onStage,
  });

  console.info("[Vector] swap: OKX-safe sequential path (Circle only)");

  return {
    txHash: result.executeTxHash,
    approveTxHash: result.approveTxHash,
    provider: "circle",
  };
}
