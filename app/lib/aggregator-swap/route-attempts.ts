import type { ClientSwapRoutesResult } from "./fetch-routes-client";
import type { SwapRouteExecution, SwapRouteProvider } from "./types";

export function pickSwapExecution(
  routes: Pick<ClientSwapRoutesResult, "best" | "executions">,
  preferred: SwapRouteProvider | null,
): SwapRouteExecution | null {
  const list =
    routes.executions && routes.executions.length > 0
      ? routes.executions
      : routes.best
        ? [routes.best]
        : [];
  if (preferred) {
    return list.find((e) => e.provider === preferred) ?? routes.best;
  }
  return routes.best;
}

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

/**
 * External-wallet SwapPanel: USDC ↔ EURC skips Kyber/LI.FI compare on Arc mainnet.
 * Aggregator quotes were freezing browsers and delaying wallet popups; Circle
 * executes this pair reliably via approve → swap.
 */
export function externalStableCircleFastPath(
  mainnet: boolean,
  tokenIn: string,
  tokenOut: string,
): boolean {
  return mainnet && isStableUsdcEurcPair(tokenIn, tokenOut);
}

/** @deprecated Use externalStableCircleFastPath — OKX-only gate missed Binance/MetaMask. */
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
