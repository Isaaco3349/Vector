"use client";

import type { Eip1193Provider } from "./appkit";
import { errorTextBlob, isWalletUserRejection } from "./wallet-errors";
import { okxInAppBrowser } from "./wallet-brand";

export function isRetryableOkxRpcError(err: unknown): boolean {
  if (isWalletUserRejection(errorTextBlob(err))) return false;
  const blob = errorTextBlob(err);
  if (/-32603|internal error/i.test(blob)) return true;
  if (err && typeof err === "object" && "code" in err) {
    const code = Number((err as { code: unknown }).code);
    if (code === -32603) return true;
  }
  return false;
}

const OKX_TX_RETRY_DELAYS_MS = [600, 1200, 2200, 3500, 5000] as const;

const OKX_MOBILE_RETRY_METHODS = new Set([
  "eth_sendTransaction",
  "wallet_sendTransaction",
]);

/**
 * OKX mobile WebView: Arc RPC often returns -32603 once, then succeeds on retry.
 */
export async function okxMobileProviderRequest(
  inner: Eip1193Provider,
  args: { method: string; params?: unknown[] | object },
): Promise<unknown> {
  const retry =
    okxInAppBrowser() && OKX_MOBILE_RETRY_METHODS.has(args.method);
  const maxAttempts = retry ? OKX_TX_RETRY_DELAYS_MS.length : 1;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await inner.request(args);
    } catch (err) {
      lastErr = err;
      if (!retry || !isRetryableOkxRpcError(err) || attempt === maxAttempts - 1) {
        throw err;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, OKX_TX_RETRY_DELAYS_MS[attempt]),
      );
    }
  }
  throw lastErr;
}

/** @deprecated use okxMobileProviderRequest */
export async function sendTransactionOkxMobileAware(
  inner: Eip1193Provider,
  args: { method: string; params?: unknown[] | object },
): Promise<unknown> {
  return okxMobileProviderRequest(inner, args);
}
