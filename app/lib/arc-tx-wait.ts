"use client";

import type { Eip1193Provider } from "./appkit";
import { arcExplorerTxUrl } from "./network";
import { fetchVectorApi } from "./okx-mobile-fetch";
import { okxInAppBrowser } from "./wallet-brand";

type ReceiptPoll = {
  status?: "pending" | "success" | "reverted" | "error";
  error?: string;
};

/**
 * Wait for Arc confirmation via Vector's server + Arc RPC — not the browser.
 * Client-side viem → rpc.arc.network often hits CORS / "Failed to fetch" after
 * Binance/OKX already approved the tx.
 */
export async function waitArcTransactionReceipt(
  _provider: Eip1193Provider,
  hash: string,
): Promise<void> {
  const inOkx = okxInAppBrowser();
  const pollMs = inOkx ? 400 : 800;
  const timeoutMs = inOkx ? 75_000 : 120_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let data: ReceiptPoll;
    try {
      const res = await fetchVectorApi("/api/arc-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: hash }),
      });
      data = (await res.json()) as ReceiptPoll;
      if (!res.ok && data.status !== "pending") {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Arc receipt check failed.",
        );
      }
    } catch {
      /* one failed poll — keep trying until timeout */
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }

    if (data.status === "success") return;
    if (data.status === "reverted") {
      throw new Error(
        `Transaction reverted on Arc (${hash.slice(0, 10)}…). See ${arcExplorerTxUrl(hash)}`,
      );
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(
    `Still waiting for Arc to confirm ${hash.slice(0, 10)}… Check ${arcExplorerTxUrl(hash)} — if the approval succeeded, tap Swap again for the swap step only.`,
  );
}
