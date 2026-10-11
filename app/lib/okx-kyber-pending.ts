"use client";

const STORAGE_KEY = "vector_okx_kyber_swap_pending";
const MAX_AGE_MS = 20 * 60 * 1000;

export type OkxKyberPendingSwap = {
  wallet: string;
  /** Swap symbols (USDC, EURC, cirBTC) — stable across Kyber address fields. */
  tokenInSymbol: string;
  tokenOutSymbol: string;
  /** Human amount from the swap form (matches handleSwap). */
  amountInHuman: string;
  swapAmountInMinor: string;
  routerAddress: string;
  data: string;
  transactionValue: string;
  approveTxHash: string;
  savedAt: number;
};

function swapKey(
  wallet: string,
  tokenInSymbol: string,
  tokenOutSymbol: string,
  amountInHuman: string,
): string {
  return `${wallet.toLowerCase()}:${tokenInSymbol}:${tokenOutSymbol}:${amountInHuman}`;
}

export function saveOkxKyberPendingSwap(pending: OkxKyberPendingSwap): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        key: swapKey(
          pending.wallet,
          pending.tokenInSymbol,
          pending.tokenOutSymbol,
          pending.amountInHuman,
        ),
        pending,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function loadOkxKyberPendingSwap(
  wallet: string,
  tokenInSymbol: string,
  tokenOutSymbol: string,
  amountInHuman: string,
): OkxKyberPendingSwap | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      key?: string;
      pending?: OkxKyberPendingSwap;
    };
    const want = swapKey(wallet, tokenInSymbol, tokenOutSymbol, amountInHuman);
    if (parsed.key !== want || !parsed.pending) return null;
    if (Date.now() - parsed.pending.savedAt > MAX_AGE_MS) {
      clearOkxKyberPendingSwap();
      return null;
    }
    return parsed.pending;
  } catch {
    return null;
  }
}

export function clearOkxKyberPendingSwap(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
