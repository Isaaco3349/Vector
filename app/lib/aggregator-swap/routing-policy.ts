import type { SwapRouteProvider } from "./types";

export function pairIncludesCirBtc(tokenIn: string, tokenOut: string): boolean {
  return tokenIn === "cirBTC" || tokenOut === "cirBTC";
}

/**
 * Which providers may be executed (not quote-only) for this pair on Arc mainnet.
 * Kyber on Arc has been unreliable (hangs / browser RPC errors); cirBTC uses LI.FI.
 */
export function swapProviderExecutable(
  provider: SwapRouteProvider,
  tokenIn: string,
  tokenOut: string,
  mainnet: boolean,
): boolean {
  if (!mainnet) return provider !== "kyber";

  if (pairIncludesCirBtc(tokenIn, tokenOut)) {
    if (provider === "kyber") return false;
    if (provider === "circle") return false;
    return provider === "lifi";
  }

  if (provider === "kyber") return false;
  return true;
}

export function swapProviderQuoteOnly(
  provider: SwapRouteProvider,
  tokenIn: string,
  tokenOut: string,
  mainnet: boolean,
): boolean {
  if (!mainnet) return false;
  if (!pairIncludesCirBtc(tokenIn, tokenOut)) return false;
  return provider === "circle";
}
