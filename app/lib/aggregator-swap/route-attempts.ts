import type { ClientSwapRoutesResult } from "./fetch-routes-client";
import { isMainnet } from "../network";
import {
  pairIncludesCirBtc,
  swapProviderExecutable,
} from "./routing-policy";
import type { SwapRouteExecution, SwapRouteProvider } from "./types";

export { pairIncludesCirBtc } from "./routing-policy";

export function pickSwapExecution(
  routes: Pick<ClientSwapRoutesResult, "best" | "executions" | "lifiExecution">,
  preferred: SwapRouteProvider | null,
  tokenIn: string,
  tokenOut: string,
): SwapRouteExecution | null {
  const raw =
    routes.executions && routes.executions.length > 0
      ? routes.executions
      : routes.best
        ? [routes.best]
        : [];
  const list = raw.filter((e) =>
    swapProviderExecutable(e.provider, tokenIn, tokenOut, isMainnet),
  );
  if (preferred) {
    const picked = list.find((e) => e.provider === preferred);
    if (picked) return picked;
  }
  if (list.length > 0) {
    if (pairIncludesCirBtc(tokenIn, tokenOut)) {
      const circle = list.find((e) => e.provider === "circle");
      if (circle) return circle;
    }
    return list.reduce((a, b) =>
      BigInt(b.offer.amountOut) > BigInt(a.offer.amountOut) ? b : a,
    );
  }
  const lifi = routes.lifiExecution;
  if (
    lifi &&
    swapProviderExecutable("lifi", tokenIn, tokenOut, isMainnet)
  ) {
    return lifi;
  }
  return null;
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
    if (!swapProviderExecutable(route.provider, tokenIn, tokenOut, isMainnet)) {
      return;
    }
    const key = route.provider;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push(route);
  };

  const cirBtcPair = pairIncludesCirBtc(tokenIn, tokenOut);

  if (stable && !cirBtcPair) {
    const circleOffer = routes.offers.find((o) => o.provider === "circle");
    if (circleOffer) {
      push({ provider: "circle", offer: circleOffer });
    }
  }

  push(routes.best);

  if (!cirBtcPair) {
    const circleOffer = routes.offers.find((o) => o.provider === "circle");
    if (circleOffer && routes.best?.provider !== "circle") {
      push({ provider: "circle", offer: circleOffer });
    }
  }

  if (routes.lifiExecution && routes.best?.provider !== "lifi") {
    push(routes.lifiExecution);
  }

  if (cirBtcPair) {
    const ordered: SwapRouteExecution[] = [];
    const circleExec =
      routes.executions?.find((e) => e.provider === "circle") ??
      (() => {
        const offer = routes.offers.find((o) => o.provider === "circle");
        return offer ? ({ provider: "circle" as const, offer }) : null;
      })();
    const lifi =
      routes.lifiExecution ??
      routes.executions?.find((e) => e.provider === "lifi");
    if (circleExec) ordered.push(circleExec);
    if (lifi) ordered.push(lifi);
    if (ordered.length > 0) return ordered;
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

  if (pairIncludesCirBtc(tokenIn, tokenOut)) {
    return buildSwapRouteAttempts(
      { ...routes, lifiExecution: routes.lifiExecution ?? null },
      tokenIn,
      tokenOut,
    );
  }

  if (routes.best && swapProviderExecutable(routes.best.provider, tokenIn, tokenOut, isMainnet)) {
    return [routes.best];
  }
  const lifi = routes.lifiExecution ?? routes.executions?.find((e) => e.provider === "lifi");
  if (lifi && swapProviderExecutable("lifi", tokenIn, tokenOut, isMainnet)) {
    return [lifi];
  }
  return [];
}
