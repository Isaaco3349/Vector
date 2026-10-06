"use client";

import { getProviderChainId, type Eip1193Provider } from "./appkit";
import type { EarnCall, EarnPlan } from "./google-earn";
import { chainId as ARC_CHAIN_ID, displayName as ARC_DISPLAY_NAME } from "./network";

const RECEIPT_TIMEOUT_MS = 180_000;
const RECEIPT_POLL_MS = 2_000;

function toHexQuantity(value: string): string {
  const asBigInt = value.startsWith("0x") ? BigInt(value) : BigInt(value || "0");
  return `0x${asBigInt.toString(16)}`;
}

async function sendCall(
  provider: Eip1193Provider,
  from: string,
  call: EarnCall,
  label: string,
  chainId: number,
): Promise<string> {
  const hash = await provider.request({
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
  if (typeof hash !== "string" || !hash.startsWith("0x")) {
    throw new Error(
      `Your wallet didn't return a transaction hash for the ${label} step.`,
    );
  }
  return hash;
}

async function waitForSuccess(
  provider: Eip1193Provider,
  hash: string,
  label: string,
): Promise<void> {
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: unknown } | null;

    if (receipt && typeof receipt === "object") {
      const status = receipt.status;
      const normalised =
        typeof status === "string"
          ? status.toLowerCase()
          : typeof status === "number"
            ? `0x${status.toString(16)}`
            : null;
      if (normalised === "0x1") return;
      if (normalised === "0x0") {
        throw new Error(
          `The ${label} transaction reverted on-chain (${hash}). No earn action completed.`,
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_MS));
  }
  throw new Error(
    `The ${label} transaction (${hash}) hasn't confirmed yet. Check your wallet before retrying.`,
  );
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
    await waitForSuccess(provider, approveTxHash, "approval");
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
  await waitForSuccess(provider, executeTxHash, plan.action);

  return { approveTxHash, executeTxHash };
}
