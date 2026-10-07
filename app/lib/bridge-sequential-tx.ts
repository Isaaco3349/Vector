"use client";

/**
 * OKX-safe CCTP execution: approve → burn as plain `eth_sendTransaction` calls.
 *
 * Circle App Kit may use EIP-5792 batching or typed-data paths that OKX blocks as
 * "risky signature" with no Confirm. This module encodes with Circle's CCTP
 * provider (same bytes as Arc Portal) and submits only legacy transactions.
 */
import {
  createPublicClient,
  decodeFunctionData,
  erc20Abi,
  http,
  type Hash,
  type Hex,
} from "viem";
import type { BridgeExecution, BridgeArgs } from "./bridge";
import { bridgeChainById, explorerTxUrl } from "./bridge-chains";
import { buildBridgePlan, type BridgeCall } from "./google-bridge";
import type { Eip1193Provider } from "./appkit";

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
  publicClient: ReturnType<typeof createPublicClient>,
): Promise<Hash> {
  const to = call.to as `0x${string}`;
  const data = call.data as Hex;
  const value =
    call.value.startsWith("0x") && call.value.length > 2
      ? BigInt(call.value)
      : BigInt(call.value || "0");

  const tx: Record<string, string> = {
    from,
    to,
    data,
    value: value === BigInt(0) ? "0x0" : `0x${value.toString(16)}`,
  };

  try {
    const gas = await publicClient.estimateGas({
      account: from,
      to,
      data,
      value,
    });
    tx.gas = `0x${((gas * BigInt(120)) / BigInt(100)).toString(16)}`;
  } catch {
    /* wallet may estimate gas */
  }

  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [tx],
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

  if (typeof console !== "undefined") {
    console.info("[Vector] bridge: OKX-safe sequential path (eth_sendTransaction only)");
  }

  const publicClient = createPublicClient({ transport: http(sourceDefRpc) });
  const sendTx = (call: BridgeCall) =>
    sendLegacyTransaction(args.provider, address, call, publicClient);

  const needsApprove = await usdcAllowanceInsufficient(
    publicClient,
    plan.approve.to as `0x${string}`,
    address,
    plan.approve.data as Hex,
    BigInt(plan.approvalAmountMinor),
  );

  let approveHash: Hash | null = null;
  if (needsApprove) {
    try {
      approveHash = await sendTx(plan.approve);
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
  } else if (typeof console !== "undefined") {
    console.info("[Vector] bridge: skipping approve — USDC allowance already sufficient");
  }

  const burnHash = await sendTx(plan.burn);

  return {
    txHash: burnHash,
    explorerUrl: explorerTxUrl(args.fromChain, burnHash),
    state: "pending",
    failureDetail: null,
    raw: { path: "sequential-eth_sendTransaction", approveHash, burnHash },
  };
}

function decodeAllowanceSpender(approveData: Hex): `0x${string}` | null {
  const candidates = [
    {
      name: "approve",
      type: "function",
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ type: "bool" }],
      stateMutability: "nonpayable",
    },
    {
      name: "increaseAllowance",
      type: "function",
      inputs: [
        { name: "spender", type: "address" },
        { name: "increment", type: "uint256" },
      ],
      outputs: [{ type: "bool" }],
      stateMutability: "nonpayable",
    },
  ] as const;
  for (const abi of candidates) {
    try {
      const decoded = decodeFunctionData({ abi: [abi], data: approveData });
      const spender = decoded.args[0];
      if (typeof spender === "string" && spender.startsWith("0x")) {
        return spender as `0x${string}`;
      }
    } catch {
      /* try next shape */
    }
  }
  return null;
}

async function usdcAllowanceInsufficient(
  client: ReturnType<typeof createPublicClient>,
  token: `0x${string}`,
  owner: `0x${string}`,
  approveData: Hex,
  required: bigint,
): Promise<boolean> {
  const spender = decodeAllowanceSpender(approveData);
  if (!spender) return true;
  try {
    const allowance = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    });
    return allowance < required;
  } catch {
    return true;
  }
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
