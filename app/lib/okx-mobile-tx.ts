"use client";

import type { Eip1193Provider } from "./appkit";

/**
 * OKX mobile: use standard `eth_sendTransaction` only.
 * `wallet_sendTransaction` and wallet-side `eth_call` often return JSON-RPC -32603.
 */
export async function sendTransactionOkxMobileAware(
  inner: Eip1193Provider,
  args: { method: string; params?: unknown[] | object },
): Promise<unknown> {
  return inner.request(args);
}
