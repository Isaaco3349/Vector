import type { SwapRouteProvider } from "./types";

export function pairIncludesCirBtc(tokenIn: string, tokenOut: string): boolean {
  return tokenIn === "cirBTC" || tokenOut === "cirBTC";
}

/**
 * Arc Portal ([portal.arc.io/swap](https://portal.arc.io/swap)) routes cirBTC through
 * Circle's Adapter + LI.FI (see `execute` on the Adapter in explorer), not raw Kyber.
 */
export function swapProviderExecutable(
  provider: SwapRouteProvider,
  tokenIn: string,
  tokenOut: string,
  mainnet: boolean,
): boolean {
  if (!mainnet) return provider !== "kyber";

  if (provider === "kyber") return false;

  if (pairIncludesCirBtc(tokenIn, tokenOut)) {
    return provider === "circle" || provider === "lifi";
  }

  return true;
}

/** Circle is never quote-only on Arc when it is the executable Adapter path. */
export function swapProviderQuoteOnly(
  _provider: SwapRouteProvider,
  _tokenIn: string,
  _tokenOut: string,
  _mainnet: boolean,
): boolean {
  return false;
}
