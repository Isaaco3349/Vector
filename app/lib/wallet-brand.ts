type WagmiConnectorLike = { id: string; name?: string } | undefined;

/** OKX exposes these globals in extension and in-app browser. */
function okxInjectedProvider(): unknown {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as Record<string, unknown>;
  const okx = w.okxwallet as { ethereum?: unknown } | undefined;
  if (okx?.ethereum) return okx.ethereum;
  return w.okexchain;
}

/** True when the active wagmi connector is OKX (name/id), not generic "Injected". */
export function isOkxWallet(connector: WagmiConnectorLike): boolean {
  if (!connector) return false;
  const id = connector.id.toLowerCase();
  const name = (connector.name ?? "").toLowerCase();
  return (
    id.includes("okx") ||
    name.includes("okx") ||
    id === "com.okex.wallet" ||
    id === "okexwallet"
  );
}

/** True when the EIP-1193 provider instance is OKX (works when wagmi reports `injected`). */
export function providerIsOkx(provider: unknown): boolean {
  if (!provider || typeof provider !== "object") return false;
  const p = provider as Record<string, unknown>;
  if (p.isOkxWallet === true) return true;
  const okx = okxInjectedProvider();
  return okx !== undefined && provider === okx;
}

/** Bridge/swap should use plain `eth_sendTransaction` paths for OKX. */
export function okxSafeTransactionPath(
  connector: WagmiConnectorLike,
  provider?: unknown,
): boolean {
  if (process.env.NEXT_PUBLIC_FORCE_SEQUENTIAL_BRIDGE === "true") return true;
  if (isOkxWallet(connector) || providerIsOkx(provider)) return true;
  if (typeof window !== "undefined") {
    const w = window as unknown as Record<string, unknown>;
    const okx = w.okxwallet as { ethereum?: unknown } | undefined;
    if (okx?.ethereum && connector?.id === "injected") return true;
  }
  return false;
}
