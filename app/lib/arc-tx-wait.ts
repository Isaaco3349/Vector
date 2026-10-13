"use client";

import type { Hash } from "viem";
import type { Eip1193Provider } from "./appkit";
import { arcPublicReadClient } from "./arc-erc20-read";
import { okxInAppBrowser } from "./wallet-brand";

/**
 * Wait for Arc confirmation via public RPC — not the wallet extension.
 * OKX/MetaMask often hang or rate-limit `eth_getTransactionReceipt` while a
 * confirm dialog is open, which made the whole page feel frozen on "Swapping…".
 */
export async function waitArcTransactionReceipt(
  _provider: Eip1193Provider,
  hash: string,
): Promise<void> {
  const client = arcPublicReadClient();
  const txHash = hash as Hash;
  const inOkx = okxInAppBrowser();
  const pollMs = inOkx ? 400 : 800;
  const timeoutMs = inOkx ? 75_000 : 120_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (receipt) {
      if (receipt.status === "success") return;
      if (receipt.status === "reverted") {
        throw new Error(`Transaction reverted on-chain (${hash}).`);
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(
    `Transaction ${hash} has not confirmed yet. Check your wallet activity or the Arc explorer before sending again.`,
  );
}
