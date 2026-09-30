"use client";

/**
 * OKX-safe CCTP execution: approve → burn as plain `eth_sendTransaction` calls.
 *
 * Circle App Kit may use EIP-5792 batching or typed-data paths that OKX blocks as
 * "risky signature" with no Confirm. This module encodes with Circle's CCTP
 * provider (same bytes as Arc Portal) and submits only legacy transactions.
 */
import { createPublicClient, http, type Hash } from "viem";
import type { BridgeExecution, BridgeArgs } from "./bridge";
import { bridgeChainById, explorerTxUrl } from "./bridge-chains";
import { buildBridgePlan, type BridgeCall } from "./google-bridge";
import type { Eip1193Provider } from "./appkit";

function hexChainId(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}` as `0x${string}`;
}

async function resolveWalletAddress(
  provider: Eip1193Provider,
): Promise<`0x${string}`> {
  const accounts = (await provider.request({
    method: "eth_accounts",
  })) as unknown;
  const first = Array.isArray(accounts) ? accounts[0] : null;
  if (typeof first !== "string" || !first.startsWith("0x")) {
    throw new Error("Wallet did not return an account address.");
  }
  return first as `0x${string}`;
}

async function sendLegacyTransaction(
  provider: Eip1193Provider,
  from: `0x${string}`,
  call: BridgeCall,
  chainId: number,
): Promise<Hash> {
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: call.to,
        data: call.data,
        value: call.value.startsWith("0x") ? call.value : "0x0",
        chainId: hexChainId(chainId),
      },
    ],
  });
  if (typeof hash !== "string" || !hash.startsWith("0x")) {
    throw new Error("Wallet did not return a transaction hash.");
  }
  return hash as Hash;
}

async function waitForReceipt(rpcUrl: string, hash: Hash): Promise<void> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  await client.waitForTransactionReceipt({ hash, confirmations: 1 });
}

/**
 * Bridge via two explicit transactions. Used for OKX and any wallet that blocks
 * App Kit batch/permit flows.
 */
export async function executeBridgeViaSequentialTransactions(
  args: BridgeArgs,
): Promise<BridgeExecution> {
  const fromMeta = bridgeChainById(args.fromChain);
  const toMeta = bridgeChainById(args.toChain);
  if (!fromMeta || !toMeta) {
    throw new Error("Unsupported bridge route.");
  }
  if (toMeta.forwarderDestination !== true) {
    throw new Error(
      `${toMeta.label} does not support a forwarded destination mint for this path.`,
    );
  }

  const address = await resolveWalletAddress(args.provider);
  const plan = await buildBridgePlan({
    walletAddress: address,
    fromChain: args.fromChain,
    toChain: args.toChain,
    amount: args.amount,
    recipientAddress: address,
  });

  const sourceDefRpc = await resolveSourceRpc(fromMeta.appKitChain);
  const chainId = fromMeta.chainId;

  let approveHash: Hash | null = null;
  try {
    approveHash = await sendLegacyTransaction(
      args.provider,
      address,
      plan.approve,
      chainId,
    );
    await waitForReceipt(sourceDefRpc, approveHash);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/reject|denied|cancel|risky|blocked/i.test(msg)) {
      throw err;
    }
    // Allowance may already be sufficient — continue to burn on benign reverts.
    if (!/allowance|already|execution reverted/i.test(msg)) {
      throw err;
    }
  }

  const burnHash = await sendLegacyTransaction(
    args.provider,
    address,
    plan.burn,
    chainId,
  );

  return {
    txHash: burnHash,
    explorerUrl: explorerTxUrl(args.fromChain, burnHash),
    state: "pending",
    failureDetail: null,
    raw: { path: "sequential-eth_sendTransaction", approveHash, burnHash },
  };
}

async function resolveSourceRpc(appKitChain: string): Promise<string> {
  const adapterMod = (await import("@circle-fin/adapter-viem-v2")) as Record<
    string,
    unknown
  >;
  const resolveChainIdentifier = adapterMod.resolveChainIdentifier as (
    id: string,
  ) => { rpcEndpoints?: readonly string[] };
  const def = resolveChainIdentifier(appKitChain);
  const rpc = def?.rpcEndpoints?.[0];
  if (typeof rpc !== "string" || !rpc) {
    throw new Error("Could not resolve RPC for the source chain.");
  }
  return rpc;
}
