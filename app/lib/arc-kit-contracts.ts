/**
 * Read-only Arc mainnet Circle kit contract locators (from App Kit chain defs).
 * Bridge (CCTP) and swap/earn (Adapter) use different contracts — OKX often
 * treats them differently in its risk UI.
 */
import { AppKit } from "@circle-fin/app-kit";
import { isMainnet } from "./network";

export type ArcKitContracts = {
  bridge: string | null;
  adapter: string | null;
  usdc: string | null;
};

let cached: ArcKitContracts | null = null;

export function getArcKitContracts(): ArcKitContracts {
  if (cached) return cached;
  const empty: ArcKitContracts = { bridge: null, adapter: null, usdc: null };
  if (!isMainnet) {
    cached = empty;
    return empty;
  }
  try {
    const kit = new AppKit();
    const row = kit
      .getSupportedChains("swap")
      .find((c) => c.chain === "Arc" && c.isTestnet === false) as
      | {
          usdcAddress?: string;
          kitContracts?: {
            bridge?: string;
            adapter?: string;
          };
        }
      | undefined;
    cached = {
      bridge: row?.kitContracts?.bridge ?? null,
      adapter: row?.kitContracts?.adapter ?? null,
      usdc: row?.usdcAddress ?? null,
    };
    return cached;
  } catch {
    cached = empty;
    return empty;
  }
}
