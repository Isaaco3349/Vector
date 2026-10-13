"use client";

import type { Eip1193Provider } from "./appkit";
import { ensureArcNetwork } from "./arc-wallet";
import { chainId as ARC_CHAIN_ID } from "./network";
import { withWalletRequestTimeout } from "./wallet-request-timeout";

const SWITCH_TIMEOUT_MS = 55_000;

/**
 * One network switch path for the signing provider (Binance/OKX/MetaMask).
 * Avoid calling wagmi switch and wallet_switch back-to-back — that doubles prompts
 * and can hang for a minute while extensions fight each other.
 */
export async function switchConnectedWalletToArc(
  provider: Eip1193Provider,
): Promise<void> {
  await withWalletRequestTimeout(
    ensureArcNetwork(provider),
    SWITCH_TIMEOUT_MS,
    "Switching to Arc took too long. Confirm the network change in your wallet, or switch to Arc manually, then tap Refresh.",
  );
}

export function walletReportsArc(chainId: number | null | undefined): boolean {
  return chainId === ARC_CHAIN_ID;
}
