/**
 * Cached read-only view of App Kit bridge chain definitions.
 * Used by network.ts and bridge-chains.ts — not for swap/earn business logic.
 */
import { AppKit } from "@circle-fin/app-kit";

export type KitBridgeChainDef = {
  type?: string;
  chain: string;
  name: string;
  title?: string;
  chainId: number;
  isTestnet: boolean;
  explorerUrl?: string;
  rpcEndpoints?: string[];
  usdcAddress?: string | null;
  eurcAddress?: string | null;
  [key: string]: unknown;
};

let cached: KitBridgeChainDef[] | null = null;
let loadFailed = false;

function warn(message: string): void {
  if (typeof console !== "undefined") {
    console.warn(`[vector/kit-bridge-chains] ${message}`);
  }
}

/** Synchronous load — `getSupportedChains` is sync in App Kit 1.15+. */
export function getKitBridgeChainDefs(): KitBridgeChainDef[] {
  if (cached) return cached;
  if (loadFailed) return [];
  try {
    const kit = new AppKit();
    cached = kit.getSupportedChains("bridge") as unknown as KitBridgeChainDef[];
    return cached;
  } catch (err) {
    loadFailed = true;
    warn(
      `Failed to load bridge chains from App Kit: ${
        err instanceof Error ? err.message : String(err)
      }. Static fallbacks will be used where configured.`,
    );
    return [];
  }
}

export function getKitBridgeChainByAppKitId(
  appKitChain: string,
): KitBridgeChainDef | undefined {
  return getKitBridgeChainDefs().find((c) => c.chain === appKitChain);
}

export function getArcMainnetKitBridgeChain(): KitBridgeChainDef | undefined {
  return getKitBridgeChainDefs().find(
    (c) => c.chain === "Arc" && c.isTestnet === false,
  );
}

/** e.g. `https://explorer.arc.io/tx/{hash}` → `https://explorer.arc.io` */
export function explorerBaseFromKitExplorerUrl(
  explorerUrl: string | undefined,
): string | undefined {
  if (!explorerUrl) return undefined;
  return explorerUrl
    .replace(/\/tx\/\{hash\}$/i, "")
    .replace(/\/address\/\{address\}$/i, "")
    .replace(/\/$/, "");
}
