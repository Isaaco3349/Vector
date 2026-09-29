/**
 * Server-side allowlist for W3S `contractExecution` targets on Arc.
 * Blocks arbitrary contract calls if a session token is ever abused from XSS.
 */
import { AppKit } from "@circle-fin/app-kit";
import { getAddress, isAddress, isHex } from "viem";
import { isMainnet } from "./network";
import { ARC_TOKENS } from "./swap-tokens";

function vectorRouterFromEnv(): string | null {
  const raw = process.env.NEXT_PUBLIC_VECTOR_ROUTER_ARC?.trim();
  if (!raw || !isAddress(raw)) return null;
  return getAddress(raw);
}

type KitChainLike = {
  chain?: string;
  usdcAddress?: string | null;
  eurcAddress?: string | null;
  kitContracts?: { bridge?: string; adapter?: string } | null;
  cctp?: {
    contracts?: { v2?: { tokenMessenger?: string; messageTransmitter?: string } };
  };
};

let cachedAllowlist: Set<string> | null = null;

function norm(addr: string): string {
  return getAddress(addr).toLowerCase();
}

function add(set: Set<string>, addr: string | null | undefined): void {
  if (typeof addr === "string" && isAddress(addr)) {
    set.add(norm(addr));
  }
}

function arcChainIdFromKit(): string {
  return isMainnet ? "Arc" : "Arc_Testnet";
}

function buildStaticAllowlist(): Set<string> {
  const set = new Set<string>();
  try {
    const kit = new AppKit();
    const bridgeChains = kit.getSupportedChains("bridge") as KitChainLike[];
    const arc = bridgeChains.find((c) => c.chain === arcChainIdFromKit());
    if (arc) {
      add(set, arc.usdcAddress);
      add(set, arc.eurcAddress);
      add(set, arc.kitContracts?.bridge);
      add(set, arc.kitContracts?.adapter);
      add(set, arc.cctp?.contracts?.v2?.tokenMessenger);
      add(set, arc.cctp?.contracts?.v2?.messageTransmitter);
    }
    const swapChains = kit.getSupportedChains("swap") as KitChainLike[];
    const arcSwap = swapChains.find((c) => c.chain === arcChainIdFromKit());
    if (arcSwap?.kitContracts?.adapter) {
      add(set, arcSwap.kitContracts.adapter);
    }
  } catch {
    // App Kit unavailable at runtime — fall through to token/router env set.
  }

  for (const token of ARC_TOKENS) {
    if (token.kind === "erc20" && token.address) {
      add(set, token.address);
    }
  }

  add(set, vectorRouterFromEnv());

  const extra = process.env.W3S_ALLOWED_CONTRACTS?.trim();
  if (extra) {
    for (const part of extra.split(",")) {
      add(set, part.trim());
    }
  }

  return set;
}

export function w3sAllowedContractAddresses(): ReadonlySet<string> {
  if (!cachedAllowlist) {
    cachedAllowlist = buildStaticAllowlist();
  }
  return cachedAllowlist;
}

export type W3sContractExecutionGuard = {
  contractAddress: string;
  callData?: string;
  /** Morpho vault share token — allowed for earn withdraw approvals only. */
  earnVaultAddress?: string;
};

export function validateW3sContractExecution(
  input: W3sContractExecutionGuard,
): { ok: true } | { ok: false; message: string } {
  if (!isAddress(input.contractAddress)) {
    return { ok: false, message: "Invalid contract address." };
  }
  const target = norm(input.contractAddress);
  const allowed = w3sAllowedContractAddresses();

  if (allowed.has(target)) {
    return validateCallData(input.callData);
  }

  if (
    input.earnVaultAddress &&
    isAddress(input.earnVaultAddress) &&
    target === norm(input.earnVaultAddress)
  ) {
    return validateCallData(input.callData);
  }

  return {
    ok: false,
    message:
      "This contract is not on Vector's allowlist for Google-wallet transactions. No challenge was created.",
  };
}

function validateCallData(callData: string | undefined): { ok: true } | { ok: false; message: string } {
  if (callData === undefined) {
    return { ok: true };
  }
  if (typeof callData !== "string" || !isHex(callData) || callData.length < 10) {
    return { ok: false, message: "Invalid call data for contract execution." };
  }
  return { ok: true };
}
