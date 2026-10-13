import { isOkxWallet, okxInAppBrowser } from "./wallet-brand";

type ConnectorLike = { id: string; name?: string } | undefined;

/** OKX must never use Circle App Kit `.swap()` — sequential txs only. */
export function requiresOkxSequentialSwap(
  connector: ConnectorLike,
  okxSafePath: boolean,
): boolean {
  return okxSafePath || okxInAppBrowser() || isOkxWallet(connector);
}

/** Reuse quoted routes on swap tap (skip a second /api/swap-routes round-trip). */
export function okxReuseQuotedRoutesOnExecute(): boolean {
  return true;
}
