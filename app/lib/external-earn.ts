"use client";

import { waitArcTransactionReceipt } from "./arc-tx-wait";
import { getProviderChainId, type Eip1193Provider } from "./appkit";
import type { EarnCall, EarnPlan } from "./google-earn";
import { chainId as ARC_CHAIN_ID, displayName as ARC_DISPLAY_NAME } from "./network";
import { okxInAppBrowser, providerIsOkx } from "./wallet-brand";
import { withWalletRequestTimeout } from "./wallet-request-timeout";

function toHexQuantity(value: string): string {
  const asBigInt = value.startsWith("0x") ? BigInt(value) : BigInt(value || "0");
  return `0x${asBigInt.toString(16)}`;
}

function walletConfirmTimeoutMs(provider: Eip1193Provider): number {
  return okxInAppBrowser() || providerIsOkx(provider) ? 120_000 : 180_000;
}

async function sendCall(
  provider: Eip1193Provider,
  from: string,
  call: EarnCall,
  label: string,
  chainId: number,
): Promise<string> {
  const request = provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: call.to,
        data: call.data,
        value: toHexQuantity(call.value),
        chainId: `0x${chainId.toString(16)}`,
      },
    ],
  });
  const hash = await withWalletRequestTimeout(
    request,
    walletConfirmTimeoutMs(provider),
    providerIsOkx(provider) || okxInAppBrowser()
      ? "OKX did not respond to the earn prompt in time. Open the OKX extension, approve or reject, then try again."
      : "Your wallet did not respond in time. Approve or reject in the wallet, then try again.",
  );
  if (typeof hash !== "string" || !hash.startsWith("0x")) {
    throw new Error(
      `Your wallet didn't return a transaction hash for the ${label} step.`,
    );
  }
  return hash;
}

export type ExternalEarnResult = {
  approveTxHash: string | null;
  executeTxHash: string;
};

export async function executeEarnPlan(args: {
  provider: Eip1193Provider;
  from: string;
  plan: EarnPlan;
  onStage?: (stage: "approving" | "awaiting-approval" | "executing" | "awaiting-execution") => void;
}): Promise<ExternalEarnResult> {
  const { provider, from, plan, onStage } = args;

  const chainId = await getProviderChainId(provider);
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(
      chainId === null
        ? "Couldn't confirm which network your wallet is on, so nothing was sent."
        : `Your wallet is on chain ${chainId}, but earn runs on ${ARC_DISPLAY_NAME} (${ARC_CHAIN_ID}).`,
    );
  }

  let approveTxHash: string | null = null;
  if (plan.approve) {
    onStage?.("approving");
    approveTxHash = await sendCall(
      provider,
      from,
      plan.approve,
      "approval",
      ARC_CHAIN_ID,
    );
    onStage?.("awaiting-approval");
    await waitArcTransactionReceipt(provider, approveTxHash);
  }

  onStage?.("executing");
  const executeTxHash = await sendCall(
    provider,
    from,
    plan.execute,
    plan.action,
    ARC_CHAIN_ID,
  );
  onStage?.("awaiting-execution");
  try {
    await waitArcTransactionReceipt(provider, executeTxHash);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/has not confirmed yet/i.test(msg)) {
      throw new Error(
        `${msg} Your deposit may still land — check Arc explorer for ${executeTxHash.slice(0, 10)}… before sending again.`,
      );
    }
    throw err;
  }

  return { approveTxHash, executeTxHash };
}
