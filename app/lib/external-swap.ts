"use client";

/**
 * External-wallet executor for a Circle SwapPlan.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * Vector has two ways to price a swap:
 *
 *   1. App Kit `estimateSwap`  → GET  /v1/stablecoinKits/quote
 *   2. `buildSwapPlan`         → POST /v1/stablecoinKits/swap
 *
 * Path 1 signs and broadcasts by itself (App Kit's `.swap()`), so it needs no
 * executor. Path 2 only ever RETURNS calldata — Circle hands back adapter
 * `executionParams` plus a proxy-signed EIP-712 attestation, which
 * `buildSwapPlan` encodes into exactly two calls: `approve`, then `execute`.
 * Those two calls are wallet-agnostic `{to, data, value}` triples. The Google
 * wallet routes them through W3S contract-execution challenges; an external
 * wallet can simply send them. This module is that send step.
 *
 * `buildSwapPlan` lives in `google-swap.ts` for historical reasons — it was
 * written for the Google wallet first — but nothing in it is W3S-specific. It
 * encodes with a deliberately read-only provider that THROWS on every sign and
 * send method, so the plan cannot be broadcast during construction. All
 * money-critical bytes come from Circle's own adapter; see that file's header
 * for the source verification.
 *
 * ── WHY APPROVE-THEN-EXECUTE MUST BE SEQUENTIAL ───────────────────────────────
 * `execute` makes the Adapter Contract PULL the input token via allowance. If we
 * submitted both at once and the approval landed second (reordered, repriced, or
 * dropped), `execute` would revert and the user would pay gas for nothing. So we
 * wait for the approval's receipt and check it actually succeeded before sending
 * `execute`. Slower by one confirmation; correct instead of racy.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ─────────────────────────────────
 *  • No gas fields. The wallet estimates; we never guess a limit or a price.
 *  • No allowance pre-check. The plan's approval is `usdc.increaseAllowance`
 *    (or ERC-20 `approve`) as Circle's adapter chose it, and re-approving is
 *    safe. Reading allowance to skip a step would trade a small saving for a new
 *    way to under-approve.
 *  • No error prose invention. Chain and Circle errors are surfaced as-is;
 *    `describeSwapError` in appkit.ts is the single place that interprets them.
 */

import { getProviderChainId, type Eip1193Provider } from "./appkit";
import type { SwapCall, SwapPlan } from "./google-swap";
import { chainId as ARC_CHAIN_ID, displayName as ARC_DISPLAY_NAME } from "./network";

/** How long to wait for a receipt before giving up, and how often to ask. */
const RECEIPT_TIMEOUT_MS = 180_000;
const RECEIPT_POLL_MS = 2_000;

export type ExternalSwapResult = {
  /** Hash of the approval transaction. */
  approveTxHash: string;
  /** Hash of the swap execution — the one worth showing the user. */
  executeTxHash: string;
};

export type ExecuteSwapPlanArgs = {
  provider: Eip1193Provider;
  /** The connected wallet address; becomes `from` on both transactions. */
  from: string;
  plan: SwapPlan;
  /**
   * Called as each stage begins, so the panel can tell the user which of the
   * two confirmations they're looking at. Purely informational.
   */
  onStage?: (stage: "approving" | "awaiting-approval" | "executing" | "awaiting-execution") => void;
};

/** A decimal-or-hex string amount → the hex quantity `eth_sendTransaction` wants. */
function toHexQuantity(value: string): string {
  const asBigInt = value.startsWith("0x") ? BigInt(value) : BigInt(value || "0");
  return `0x${asBigInt.toString(16)}`;
}

/**
 * Submit one call and return its hash. Throws if the wallet doesn't return a
 * recognisable hash — a silent non-answer must not be reported as a success.
 */
async function sendCall(
  provider: Eip1193Provider,
  from: string,
  call: SwapCall,
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
      `Your wallet didn't return a transaction hash for the ${label} step, so ` +
        "Vector can't confirm what happened. Check your wallet activity before retrying.",
    );
  }
  return hash;
}

/**
 * Poll until the transaction has a receipt, then require `status === 0x1`.
 *
 * A mined-but-reverted transaction is the dangerous case: it looks like success
 * to anything that only checks "did we get a receipt". Arc reports status the
 * standard way, so we read it and fail loudly.
 */
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
      // Some nodes answer with a number rather than a hex quantity.
      const normalised =
        typeof status === "string"
          ? status.toLowerCase()
          : typeof status === "number"
            ? `0x${status.toString(16)}`
            : null;

      if (normalised === "0x1") return;
      if (normalised === "0x0") {
        throw new Error(
          `The ${label} transaction was mined but reverted on-chain (${hash}). ` +
            "No swap took place. This usually means the route moved or the " +
            "deadline in Circle's quote expired — get a fresh quote and try again.",
        );
      }
      // A receipt with no readable status: treat as unknown, keep waiting.
    }

    await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_MS));
  }

  throw new Error(
    `The ${label} transaction (${hash}) hasn't confirmed yet. It may still ` +
      "land — check your wallet or the Arc explorer before sending it again, so " +
      "you don't submit it twice.",
  );
}

/**
 * Send a SwapPlan from an external wallet: approve, wait, execute, wait.
 *
 * Re-checks the wallet's chain immediately before the first send. The panel
 * checks too, but a user can switch networks between clicking and confirming,
 * and an approval broadcast on the wrong chain is a real (if small) loss.
 */
export async function executeSwapPlan(
  args: ExecuteSwapPlanArgs,
): Promise<ExternalSwapResult> {
  const { provider, from, plan, onStage } = args;

  const chainId = await getProviderChainId(provider);
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(
      chainId === null
        ? "Couldn't confirm which network your wallet is on, so nothing was sent."
        : `Your wallet is on chain ${chainId}, but swaps run on ${ARC_DISPLAY_NAME} ` +
          `(${ARC_CHAIN_ID}). Nothing was sent.`,
    );
  }

  onStage?.("approving");
  const approveTxHash = await sendCall(
    provider,
    from,
    plan.approve,
    "approval",
    ARC_CHAIN_ID,
  );

  onStage?.("awaiting-approval");
  await waitForSuccess(provider, approveTxHash, "approval");

  onStage?.("executing");
  const executeTxHash = await sendCall(
    provider,
    from,
    plan.execute,
    "swap",
    ARC_CHAIN_ID,
  );

  onStage?.("awaiting-execution");
  await waitForSuccess(provider, executeTxHash, "swap");

  return { approveTxHash, executeTxHash };
}
