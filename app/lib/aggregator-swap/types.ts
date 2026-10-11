import type { SwapPlan } from "../google-swap";

export type SwapRouteProvider = "circle" | "kyber" | "lifi";

export type SwapRouteOffer = {
  provider: SwapRouteProvider;
  /** Output amount in token base units (decimal string). */
  amountOut: string;
  /** Pre-formatted output for UI (same decimals as tokenOut). */
  amountOutHuman: string;
  tokenOutAddress: string;
  tokenInAddress: string;
  amountIn: string;
  /** Human-readable label for UI. */
  label: string;
};

/** Serializable payload returned from /api/swap-routes for client execution. */
export type SwapRouteExecution =
  | {
      provider: "circle";
      offer: SwapRouteOffer;
    }
  | {
      provider: "kyber";
      offer: SwapRouteOffer;
      routeSummary: unknown;
    }
  | {
      provider: "lifi";
      offer: SwapRouteOffer;
      quote: unknown;
    };

export type SwapRoutesResponse = {
  offers: SwapRouteOffer[];
  best: SwapRouteExecution | null;
  /** LI.FI quote payload when LI.FI quoted (for OKX fallback execution). */
  lifiExecution?: SwapRouteExecution | null;
  /** When Circle plan is best, client builds locally; optional estimate only here. */
  circlePlan?: SwapPlan;
};
