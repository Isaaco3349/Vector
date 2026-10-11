"use client";

import type { Hash } from "viem";
import { arcPublicReadClient } from "./arc-erc20-read";

/**
 * OKX Android/iOS WebView: never use the wallet for Arc reads — only for signing.
 * Desktop OKX extension keeps using the wallet RPC (works reliably there).
 */
export async function okxMobileArcPublicRpcRequest(args: {
  method: string;
  params?: unknown[] | object;
}): Promise<unknown> {
  const method = args.method;
  const params = Array.isArray(args.params) ? args.params : [];
  const client = arcPublicReadClient();

  if (method === "eth_chainId") {
    const id = await client.getChainId();
    return `0x${id.toString(16)}`;
  }

  if (method === "eth_call") {
    const tx = params[0] as { to?: string; data?: string } | undefined;
    const block = (params[1] as string | undefined) ?? "latest";
    if (!tx?.to || !tx.data) {
      throw new Error("eth_call missing to/data");
    }
    const result = await client.call({
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      blockTag: block === "pending" ? "pending" : "latest",
    });
    return result.data ?? "0x";
  }

  if (method === "eth_getBalance") {
    const address = params[0] as `0x${string}` | undefined;
    if (!address) throw new Error("eth_getBalance missing address");
    const wei = await client.getBalance({ address });
    return `0x${wei.toString(16)}`;
  }

  if (method === "eth_getTransactionReceipt") {
    const hash = params[0] as Hash | undefined;
    if (!hash || typeof hash !== "string") {
      throw new Error("eth_getTransactionReceipt missing hash");
    }
    const receipt = await client.getTransactionReceipt({ hash });
    if (!receipt) return null;
    const statusHex =
      receipt.status === "success"
        ? "0x1"
        : receipt.status === "reverted"
          ? "0x0"
          : typeof receipt.status === "string"
            ? receipt.status
            : "0x1";
    return {
      transactionHash: receipt.transactionHash,
      blockNumber: `0x${receipt.blockNumber.toString(16)}`,
      status: statusHex,
    };
  }

  if (method === "eth_blockNumber") {
    const n = await client.getBlockNumber();
    return `0x${n.toString(16)}`;
  }

  throw new Error(`[Vector] OKX mobile: unsupported read RPC ${method}`);
}
