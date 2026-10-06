"use client";

import type { Eip1193Provider } from "./appkit";
import { executeEarnPlan } from "./external-earn";
import {
  buildDepositPlan,
  buildWithdrawPlan,
  type EarnAction,
} from "./google-earn";

/**
 * OKX-safe earn: Circle Earn service plan + sequential eth_sendTransaction
 * (same contracts as Google wallet, no App Kit typed-data / batch paths).
 */
export async function executeEarnViaSequentialTransactions(args: {
  provider: Eip1193Provider;
  walletAddress: string;
  vaultAddress: string;
  amount: string;
  action: EarnAction;
  onStage?: Parameters<typeof executeEarnPlan>[0]["onStage"];
}): Promise<{ txHash: string; approveTxHash: string | null }> {
  const build =
    args.action === "deposit" ? buildDepositPlan : buildWithdrawPlan;
  const plan = await build({
    walletAddress: args.walletAddress,
    vaultAddress: args.vaultAddress,
    amount: args.amount,
    usdcApprovalStyle: "erc20Approve",
  });

  const result = await executeEarnPlan({
    provider: args.provider,
    from: args.walletAddress,
    plan,
    onStage: args.onStage,
  });

  if (typeof console !== "undefined") {
    console.info(
      `[Vector] earn ${args.action}: OKX-safe sequential path (eth_sendTransaction only)`,
    );
  }

  return {
    txHash: result.executeTxHash,
    approveTxHash: result.approveTxHash,
  };
}
