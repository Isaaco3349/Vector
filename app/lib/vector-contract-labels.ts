import { AppKit } from "@circle-fin/app-kit";
import { getAddress, isAddress } from "viem";

type ContractRole = "adapter" | "bridge" | "tokenMessenger" | "router";

type ContractIndex = Map<string, ContractRole>;

function norm(addr: string): string {
  return getAddress(addr).toLowerCase();
}

function addContract(
  index: ContractIndex,
  addr: string | null | undefined,
  role: ContractRole,
): void {
  if (typeof addr === "string" && isAddress(addr)) {
    index.set(norm(addr), role);
  }
}

function roleLabel(role: ContractRole): string {
  switch (role) {
    case "adapter":
      return "Swap / Earn";
    case "bridge":
    case "tokenMessenger":
      return "Bridge";
    case "router":
      return "Sent";
    default:
      return "Transaction";
  }
}

let cachedIndex: ContractIndex | null = null;

function contractIndex(): ContractIndex {
  if (cachedIndex) return cachedIndex;
  const index: ContractIndex = new Map();
  try {
    const kit = new AppKit();
    const bridge = kit.getSupportedChains("bridge") as Array<{
      kitContracts?: { bridge?: string; adapter?: string };
      cctp?: { contracts?: { v2?: { tokenMessenger?: string } } };
    }>;
    for (const row of bridge) {
      addContract(index, row.kitContracts?.bridge, "bridge");
      addContract(index, row.kitContracts?.adapter, "adapter");
      addContract(index, row.cctp?.contracts?.v2?.tokenMessenger, "tokenMessenger");
    }
    const swap = kit.getSupportedChains("swap") as Array<{
      kitContracts?: { adapter?: string };
    }>;
    for (const row of swap) {
      addContract(index, row.kitContracts?.adapter, "adapter");
    }
  } catch {
    // Non-fatal.
  }
  const router = process.env.NEXT_PUBLIC_VECTOR_ROUTER_ARC?.trim();
  if (router && isAddress(router)) {
    addContract(index, router, "router");
  }
  cachedIndex = index;
  return index;
}

export function w3sContractActivityLabel(
  contractAddress: string | null,
): string | null {
  if (!contractAddress || !isAddress(contractAddress)) return null;
  const role = contractIndex().get(norm(contractAddress));
  return role ? roleLabel(role) : null;
}

export function classifyContractToLabel(to: string | undefined): string {
  if (!to || !isAddress(to)) return "Transaction";
  const role = contractIndex().get(norm(to));
  return role ? roleLabel(role) : "Transaction";
}
