import type { ClientSwapRoutesResult } from "./fetch-routes-client";
import type { SwapRouteExecution } from "./types";

/** Circle kit cannot execute cirBTC on Arc mainnet — Kyber / LI.FI only. */
export function pairIncludesCirBtc(tokenIn: string, tokenOut: string): boolean {
  return tokenIn === "cirBTC" || tokenOut === "cirBTC";
}

/**
 * Ordered execution attempts after quotes: best route, then mobile-safe fallbacks.
 */
export function buildSwapRouteAttempts(
  routes: ClientSwapRoutesResult,
  tokenIn: string,
  tokenOut: string,
): SwapRouteExecution[] {
  const attempts: SwapRouteExecution[] = [];
  const seen = new Set<string>();

  const push = (route: SwapRouteExecution | null | undefined) => {
    if (!route) return;
    const key = route.provider;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push(route);
  };

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

/** OKX mobile: execute only the quoted best route — no Circle/LI.FI retry wall after wallet steps. */
export function buildOkxMobileSwapRouteAttempts(
  routes: ClientSwapRoutesResult,
): SwapRouteExecution[] {
  return routes.best ? [routes.best] : [];
}
