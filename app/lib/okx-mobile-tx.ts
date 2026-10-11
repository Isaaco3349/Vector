"use client";

import type { Eip1193Provider } from "./appkit";
import { errorTextBlob } from "./wallet-errors";
import { okxInAppBrowser } from "./wallet-brand";

type LegacyTx = {
  from: string;
  to: string;
  data?: string;
  value?: string;
  chainId?: string;
  gas?: string;
};

function firstTxParam(params: unknown[] | object | undefined): LegacyTx | null {
  if (!params) return null;
  const raw = Array.isArray(params) ? params[0] : null;
  if (!raw || typeof raw !== "object") return null;
  const tx = raw as Record<string, unknown>;
  const from = tx.from;
  const to = tx.to;
  if (typeof from !== "string" || typeof to !== "string") return null;
  return {
    from,
    to,
    data: typeof tx.data === "string" ? tx.data : "0x",
    value:
      typeof tx.value === "string"
        ? tx.value
        : tx.value === undefined
          ? "0x0"
          : "0x0",
    chainId:
      typeof tx.chainId === "string"
        ? tx.chainId
        : typeof tx.chainId === "number"
          ? `0x${tx.chainId.toString(16)}`
          : undefined,
    gas: typeof tx.gas === "string" ? tx.gas : undefined,
  };
}

export function extractWalletTransactionHash(result: unknown): string {
  if (typeof result === "string" && result.startsWith("0x")) return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    for (const key of ["transactionHash", "txHash", "hash", "id"]) {
      const v = r[key];
      if (typeof v === "string" && v.startsWith("0x")) return v;
    }
  }
  throw new Error("Wallet did not return a transaction hash.");
}

/**
 * OKX mobile in-app browser often ignores `eth_sendTransaction` but accepts
 * EIP-5792 `wallet_sendTransaction` (single-call batch).
 */
export async function sendTransactionOkxMobileAware(
  inner: Eip1193Provider,
  args: { method: string; params?: unknown[] | object },
): Promise<unknown> {
  if (args.method !== "eth_sendTransaction" || !okxInAppBrowser()) {
    return inner.request(args);
  }

  const tx = firstTxParam(
    args.params as unknown[] | object | undefined,
  );
  if (!tx) {
    return inner.request(args);
  }

  const chainId =
    tx.chainId ??
    ((await inner.request({ method: "eth_chainId" })) as string);

  const call = {
    to: tx.to,
    data: tx.data ?? "0x",
    value: tx.value ?? "0x0",
  };

  const walletSend5792 = {
    version: "1.0",
    chainId,
    from: tx.from,
    calls: [call],
  };

  const attempts: Array<{ label: string; run: () => Promise<unknown> }> = [
    {
      label: "wallet_sendTransaction (EIP-5792)",
      run: () =>
        inner.request({
          method: "wallet_sendTransaction",
          params: [walletSend5792],
        }),
    },
    {
      label: "wallet_sendTransaction (legacy tx object)",
      run: () =>
        inner.request({
          method: "wallet_sendTransaction",
          params: [{ ...tx, chainId }],
        }),
    },
    {
      label: "eth_sendTransaction",
      run: () => inner.request(args),
    },
  ];

  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt.run();
      return extractWalletTransactionHash(result);
    } catch (err) {
      const blob = errorTextBlob(err);
      failures.push(
        blob ? `${attempt.label}: ${blob}` : `${attempt.label}: failed`,
      );
    }
  }

  throw new Error(
    failures.length > 0
      ? failures.join(" · ")
      : "OKX did not submit the transaction. Confirm Arc network and try again.",
  );
}
