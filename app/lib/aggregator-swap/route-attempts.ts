import type { ClientSwapRoutesResult } from "./fetch-routes-client";
import type { SwapRouteExecution } from "./types";

/** Circle kit cannot execute cirBTC on Arc mainnet — Kyber / LI.FI only. */
export function pairIncludesCirBtc(tokenIn: string, tokenOut: string): boolean {
  return tokenIn === "cirBTC" || tokenOut === "cirBTC";
}

export function isStableUsdcEurcPair(tokenIn: string, tokenOut: string): boolean {
  return (
    (tokenIn === "USDC" && tokenOut === "EURC") ||
    (tokenIn === "EURC" && tokenOut === "USDC")
  );
}

/** OKX + stables: skip Kyber/LI.FI compare — Circle only (fast, one wallet flow). */
export function okxPrefersCircleOnlySwap(
  tokenIn: string,
  tokenOut: string,
  useOkxSequential: boolean,
): boolean {
  return useOkxSequential && isStableUsdcEurcPair(tokenIn, tokenOut);
}

/**
 * Ordered execution attempts after quotes: best route, then mobile-safe fallbacks.
 */
export function buildSwapRouteAttempts(
  routes: ClientSwapRoutesResult,
  tokenIn: string,
  tokenOut: string,
): SwapRouteExecution[] {
  const stable = isStableUsdcEurcPair(tokenIn, tokenOut);

  const attempts: SwapRouteExecution[] = [];
  const seen = new Set<string>();

  const push = (route: SwapRouteExecution | null | undefined) => {
    if (!route) return;
    const key = route.provider;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push(route);
  };

  if (stable) {
    const circleOffer = routes.offers.find((o) => o.provider === "circle");
    if (circleOffer) {
      push({ provider: "circle", offer: circleOffer });
    }
  }

  push(routes.best);

  const cirBtcPair = pairIncludesCirBtc(tokenIn, tokenOut);

  if (!cirBtcPair) {
    const circleOffer = routes.offers.find((o) => o.provider === "circle");
    if (circleOffer && routes.best?.provider !== "circle") {
      push({ provider: "circle", offer: circleOffer });
    }
  }

  if (routes.lifiExecution && routes.best?.provider !== "lifi") {
    push(routes.lifiExecution);
  }

  return attempts;
}

/** @deprecated Use buildOkxSwapRouteAttempts with token symbols. */
export function buildOkxMobileSwapRouteAttempts(
  routes: ClientSwapRoutesResult,
  tokenIn = "",
  tokenOut = "",
): SwapRouteExecution[] {
  return buildOkxSwapRouteAttempts(routes, tokenIn, tokenOut);
}

/**
 * OKX (extension + in-app): one wallet-facing attempt per tap.
 * USDC ↔ EURC prefers Circle execution — fewer Kyber round-trips that stall
 * before any confirm dialog appears.
 */
export function buildOkxSwapRouteAttempts(
  routes: ClientSwapRoutesResult,
  tokenIn: string,
  tokenOut: string,
): SwapRouteExecution[] {
  if (isStableUsdcEurcPair(tokenIn, tokenOut)) {
    const circleOffer = routes.offers.find((o) => o.provider === "circle");
    if (circleOffer) {
      return [{ provider: "circle", offer: circleOffer }];
    }
  }

  if (routes.best) return [routes.best];
  return [];
}
