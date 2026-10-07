"use client";

import type { Eip1193Provider } from "./appkit";
import {
  isOkxWallet,
  okxInAppBrowser,
  providerIsOkx,
} from "./wallet-brand";

/** OKX Wallet EIP-6963 reverse-DNS id (current extension). */
export const OKX_WALLET_RDNS = "com.okx.wallet";

type WagmiConnectorLike = {
  id: string;
  name?: string;
  getProvider?: () => Promise<unknown>;
};

const OKX_BLOCKED_RPC = new Set([
  "eth_sign",
  "eth_signTransaction",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "wallet_sendCalls",
  "wallet_sendTransaction",
]);

function isEip1193Provider(value: unknown): value is Eip1193Provider {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Eip1193Provider).request === "function"
  );
}

/** Legacy + current OKX injection globals. */
export function okxInjectedEip1193Provider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const okx = w.okxwallet as { ethereum?: unknown } | undefined;
  if (isEip1193Provider(okx?.ethereum)) return okx.ethereum;
  if (isEip1193Provider(w.okexchain)) return w.okexchain;
  return null;
}

/**
 * Discover OKX via EIP-6963 when wagmi did not bind the right provider
 * (common with multiple extensions fighting over `window.ethereum`).
 */
function eip6963DiscoveryTimeoutMs(): number {
  if (typeof navigator === "undefined") return 400;
  return /android|iphone|ipad|mobile/i.test(navigator.userAgent) ? 900 : 400;
}

export async function discoverEip6963Provider(
  rdns: string,
  timeoutMs?: number,
): Promise<Eip1193Provider | null> {
  const wait = timeoutMs ?? eip6963DiscoveryTimeoutMs();
  if (typeof window === "undefined") return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (p: Eip1193Provider | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve(p);
    };

    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { info?: { rdns?: string }; provider?: unknown }
        | undefined;
      if (detail?.info?.rdns === rdns && isEip1193Provider(detail.provider)) {
        finish(detail.provider);
      }
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => finish(null), wait);
  });
}

/**
 * Resolve the EIP-1193 provider that will actually sign for this connection.
 * Prefers wagmi's connector provider, then OKX-specific globals / EIP-6963,
 * then `window.ethereum` only as a last resort.
 */
export async function resolveWalletEip1193Provider(
  connector: WagmiConnectorLike | undefined,
): Promise<Eip1193Provider | null> {
  try {
    if (connector?.getProvider) {
      const p = await connector.getProvider();
      if (isEip1193Provider(p)) {
        return p;
      }
    }
  } catch (err) {
    console.warn("[Vector] connector.getProvider failed:", err);
  }

  const okxDirect = okxInjectedEip1193Provider();
  if (okxDirect) return okxDirect;

  const okx6963 = await discoverEip6963Provider(OKX_WALLET_RDNS);
  if (okx6963) return okx6963;

  if (typeof window !== "undefined") {
    const eth = (window as unknown as { ethereum?: unknown }).ethereum;
    if (isEip1193Provider(eth)) return eth;
  }

  return null;
}

/**
 * Wrap an OKX provider so Circle / viem never hit signature styles OKX blocks
 * (typed data, batch sendCalls). Those calls fail fast with a clear error;
 * Vector routes OKX to sequential `eth_sendTransaction` flows instead.
 */
export function createOkxSafeEip1193Provider(
  inner: Eip1193Provider,
  opts?: { force?: boolean },
): Eip1193Provider {
  const force = opts?.force === true;
  if (!force && !providerIsOkx(inner)) return inner;

  const wrapped = {
    isOkxWallet: true as const,
    request: async (args: { method: string; params?: unknown[] | object }) => {
      const method = args.method;
      if (OKX_BLOCKED_RPC.has(method)) {
        // OKX mobile in-app browser submits some confirms via wallet_sendTransaction.
        if (method === "wallet_sendTransaction" && okxInAppBrowser()) {
          return inner.request(args);
        }
        throw new Error(
          `[Vector] Blocked ${method} for OKX — use standard transaction confirms only.`,
        );
      }
      if (method === "wallet_getCapabilities") {
        const chainId = await inner.request({ method: "eth_chainId" });
        const id =
          typeof chainId === "string" && chainId.startsWith("0x")
            ? chainId
            : "0x0";
        return { [id]: {} };
      }
      return inner.request(args);
    },
  };
  return wrapped as Eip1193Provider;
}

function accountListIncludes(
  accounts: unknown,
  connectedAddress: string,
): boolean {
  if (!Array.isArray(accounts)) return false;
  const want = connectedAddress.toLowerCase();
  return accounts.some(
    (a) => typeof a === "string" && a.toLowerCase() === want,
  );
}

async function okxOwnsConnectedAddress(
  connectedAddress: string,
): Promise<Eip1193Provider | null> {
  const okx = okxInjectedEip1193Provider();
  if (!okx) return null;
  try {
    let accounts = (await okx.request({ method: "eth_accounts" })) as unknown;
    if (!accountListIncludes(accounts, connectedAddress)) {
      accounts = (await okx.request({
        method: "eth_requestAccounts",
      })) as unknown;
    }
    if (accountListIncludes(accounts, connectedAddress)) {
      return okx;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Resolve + OKX-safe wrap when the signing provider is OKX. */
export async function resolveSigningProvider(
  connector: WagmiConnectorLike | undefined,
  connectedAddress?: string | null,
): Promise<Eip1193Provider | null> {
  const inOkxApp = okxInAppBrowser();

  if (connectedAddress) {
    const okxForAccount = await okxOwnsConnectedAddress(connectedAddress);
    if (okxForAccount) {
      return createOkxSafeEip1193Provider(okxForAccount, { force: true });
    }
  }

  if (
    connectedAddress &&
    inOkxApp &&
    (isOkxWallet(connector) || connector?.id === "injected")
  ) {
    const okx = okxInjectedEip1193Provider();
    if (okx) {
      return createOkxSafeEip1193Provider(okx, { force: true });
    }
  }

  const raw = await resolveWalletEip1193Provider(connector);
  if (!raw) return null;
  return createOkxSafeEip1193Provider(raw, {
    force: inOkxApp || providerIsOkx(raw),
  });
}
