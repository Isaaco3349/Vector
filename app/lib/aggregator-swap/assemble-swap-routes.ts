import {
  pairIncludesCirBtc,
  swapProviderExecutable,
} from "./routing-policy";
import { isMainnet } from "../network";
import type { AggregatorPairSymbol } from "./tokens";
import type { SwapRouteExecution, SwapRouteOffer } from "./types";

function pickBest(offers: SwapRouteOffer[]): SwapRouteOffer | null {
  if (offers.length === 0) return null;
  return offers.reduce((best, cur) =>
    BigInt(cur.amountOut) > BigInt(best.amountOut) ? cur : best,
  );
}

export type AssembledSwapRoutes = {
  offers: SwapRouteOffer[];
  best: SwapRouteExecution | null;
  executions: SwapRouteExecution[];
  lifiExecution: SwapRouteExecution | null;
};

/** Pick best executable route — same rules as Arc Portal (Circle Adapter preferred for cirBTC). */
export function assembleSwapRoutes(args: {
  tokenIn: AggregatorPairSymbol;
  tokenOut: AggregatorPairSymbol;
  offers: SwapRouteOffer[];
  executions: SwapRouteExecution[];
  lifiExecution: SwapRouteExecution | null;
}): AssembledSwapRoutes {
  const { offers, executions, lifiExecution } = args;
  const cirBtcPair = pairIncludesCirBtc(args.tokenIn, args.tokenOut);

  const executableOffers = offers.filter((o) =>
    swapProviderExecutable(o.provider, args.tokenIn, args.tokenOut, isMainnet),
  );
  const bestOffer = (() => {
    if (executableOffers.length === 0) return null;
    if (cirBtcPair) {
      const circle = executableOffers.find((o) => o.provider === "circle");
      if (circle) return circle;
    }
    return pickBest(executableOffers);
  })();

  if (!bestOffer) {
    return { offers, best: null, executions, lifiExecution };
  }

  const best =
    executions.find((e) => e.offer.provider === bestOffer.provider) ??
    (bestOffer.provider === "lifi" ? lifiExecution : null);

  return { offers, best, executions, lifiExecution };
}
