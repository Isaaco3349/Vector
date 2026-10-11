"use client";

import type { Eip1193Provider } from "./appkit";
import { okxInAppBrowser } from "./wallet-brand";

/** Arc confirms quickly — OKX mobile should not sit on 2s receipt polls. */
export async function waitArcTransactionReceipt(
  provider: Eip1193Provider,
  hash: string,
): Promise<void> {
  const inOkx = okxInAppBrowser();
  const pollMs = inOkx ? 400 : 1_000;
  const timeoutMs = inOkx ? 75_000 : 180_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string | number } | null;

    if (receipt && typeof receipt === "object") {
      const s = receipt.status;
      const norm =
        typeof s === "number" ? `0x${s.toString(16)}` : String(s).toLowerCase();
      if (norm === "0x1" || norm === "success") return;
      if (norm === "0x0" || norm === "reverted") {
        throw new Error(`Transaction reverted on-chain (${hash}).`);
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(
    `Transaction ${hash} has not confirmed yet. Check OKX Activity or the Arc explorer before sending again.`,
  );
}
