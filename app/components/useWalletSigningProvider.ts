"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Connector } from "wagmi";
import type { Eip1193Provider } from "../lib/appkit";
import { okxSafeTransactionPath } from "../lib/wallet-brand";
import { resolveSigningProvider } from "../lib/wallet-provider";

/** Ref-based signing provider; `ready` flips when resolution completes. */
export function useWalletSigningProviderRef(connector: Connector | undefined): {
  providerRef: RefObject<Eip1193Provider | null>;
  okxSafePath: boolean;
  ready: boolean;
} {
  const providerRef = useRef<Eip1193Provider | null>(null);
  const [ready, setReady] = useState(false);
  const [okxSafePath, setOkxSafePath] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    providerRef.current = null;
    setOkxSafePath(false);

    void (async () => {
      const p = await resolveSigningProvider(connector);
      if (cancelled) return;
      providerRef.current = p;
      setOkxSafePath(okxSafeTransactionPath(connector, p ?? undefined));
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [connector]);

  return { providerRef, okxSafePath, ready };
}
