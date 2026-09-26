/**
 * Chains available for CCTP bridging in Vector (testnet vs mainnet registries).
 *
 * Arc row (chain id, appKit id, explorers) comes from app/lib/network.ts.
 * Testnet USDC addresses are SDK-verified literals. Mainnet USDC (and Arc EURC)
 * are merged from App Kit `getSupportedChains("bridge")` via kit-bridge-chains.ts.
 */

import {
  appKitChain as arcAppKitChain,
  arcEurcAddress,
  arcExplorerAddressUrl,
  arcExplorerTxUrl,
  arcUsdcAddress,
  chainId as arcChainId,
  displayName as arcDisplayName,
  isMainnet,
} from "./network";
import { getKitBridgeChainByAppKitId } from "./kit-bridge-chains";

/** App Kit bridge identifiers — testnet set. */
export type TestnetBridgeChainId =
  | "Arc_Testnet"
  | "Base_Sepolia"
  | "Ethereum_Sepolia"
  | "Arbitrum_Sepolia"
  | "Avalanche_Fuji"
  | "Optimism_Sepolia"
  | "Polygon_Amoy_Testnet"
  | "Unichain_Sepolia"
  | "Linea_Sepolia";

/** App Kit bridge identifiers — mainnet set (Arc uses `Arc` per product; not in SDK 1.12 enum). */
export type MainnetBridgeChainId =
  | "Arc"
  | "Ethereum"
  | "Base"
  | "Arbitrum"
  | "Avalanche"
  | "Optimism"
  | "Polygon"
  | "Unichain"
  | "Linea";

export type BridgeChainId = TestnetBridgeChainId | MainnetBridgeChainId;

export type BridgeChainNumericId =
  | 5042
  | 5042002
  | 1
  | 8453
  | 42161
  | 43114
  | 10
  | 137
  | 130
  | 59144
  | 84532
  | 11155111
  | 421614
  | 43113
  | 11155420
  | 80002
  | 1301
  | 59141;

export type BridgeChain = {
  appKitChain: BridgeChainId;
  chainId: BridgeChainNumericId;
  label: string;
  usdcKind: "native" | "erc20";
  usdcAddress?: `0x${string}`;
  /** Arc only — from SDK on mainnet when available. */
  eurcAddress?: `0x${string}`;
  explorerTx: string;
  explorerAddress: string;
  forwarderDestination: boolean;
};

const TESTNET_BRIDGE_CHAINS: BridgeChain[] = [
  {
    appKitChain: "Arc_Testnet",
    chainId: 5042002,
    label: "Arc Testnet",
    usdcKind: "native",
    explorerTx: "https://testnet.arcscan.app/tx/{hash}",
    explorerAddress: "https://testnet.arcscan.app/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Base_Sepolia",
    chainId: 84532,
    label: "Base Sepolia",
    usdcKind: "erc20",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorerTx: "https://sepolia.basescan.org/tx/{hash}",
    explorerAddress: "https://sepolia.basescan.org/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Ethereum_Sepolia",
    chainId: 11155111,
    label: "Ethereum Sepolia",
    usdcKind: "erc20",
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    explorerTx: "https://sepolia.etherscan.io/tx/{hash}",
    explorerAddress: "https://sepolia.etherscan.io/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Arbitrum_Sepolia",
    chainId: 421614,
    label: "Arbitrum Sepolia",
    usdcKind: "erc20",
    usdcAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    explorerTx: "https://sepolia.arbiscan.io/tx/{hash}",
    explorerAddress: "https://sepolia.arbiscan.io/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Avalanche_Fuji",
    chainId: 43113,
    label: "Avalanche Fuji",
    usdcKind: "erc20",
    usdcAddress: "0x5425890298aed601595a70ab815c96711a31bc65",
    explorerTx: "https://testnet.snowtrace.io/tx/{hash}",
    explorerAddress: "https://testnet.snowtrace.io/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Optimism_Sepolia",
    chainId: 11155420,
    label: "Optimism Sepolia",
    usdcKind: "erc20",
    usdcAddress: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    explorerTx: "https://optimism-sepolia.blockscout.com/tx/{hash}",
    explorerAddress: "https://optimism-sepolia.blockscout.com/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Polygon_Amoy_Testnet",
    chainId: 80002,
    label: "Polygon Amoy",
    usdcKind: "erc20",
    usdcAddress: "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582",
    explorerTx: "https://amoy.polygonscan.com/tx/{hash}",
    explorerAddress: "https://amoy.polygonscan.com/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Unichain_Sepolia",
    chainId: 1301,
    label: "Unichain Sepolia",
    usdcKind: "erc20",
    usdcAddress: "0x31d0220469e10c4E71834a79b1f276d740d3768F",
    explorerTx: "https://sepolia.uniscan.xyz/tx/{hash}",
    explorerAddress: "https://sepolia.uniscan.xyz/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Linea_Sepolia",
    chainId: 59141,
    label: "Linea Sepolia",
    usdcKind: "erc20",
    usdcAddress: "0xfece4462d57bd51a6a552365a011b95f0e16d9b7",
    explorerTx: "https://sepolia.lineascan.build/tx/{hash}",
    explorerAddress: "https://sepolia.lineascan.build/address/{address}",
    forwarderDestination: true,
  },
];

const MAINNET_BRIDGE_CHAINS: BridgeChain[] = [
  {
    appKitChain: "Arc",
    chainId: 5042,
    label: arcDisplayName,
    usdcKind: "native",
    explorerTx: arcExplorerTxUrl("{hash}"),
    explorerAddress: arcExplorerAddressUrl("{address}"),
    forwarderDestination: true,
  },
  {
    appKitChain: "Ethereum",
    chainId: 1,
    label: "Ethereum",
    usdcKind: "erc20",
    explorerTx: "https://etherscan.io/tx/{hash}",
    explorerAddress: "https://etherscan.io/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Base",
    chainId: 8453,
    label: "Base",
    usdcKind: "erc20",
    explorerTx: "https://basescan.org/tx/{hash}",
    explorerAddress: "https://basescan.org/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Arbitrum",
    chainId: 42161,
    label: "Arbitrum",
    usdcKind: "erc20",
    explorerTx: "https://arbiscan.io/tx/{hash}",
    explorerAddress: "https://arbiscan.io/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Avalanche",
    chainId: 43114,
    label: "Avalanche",
    usdcKind: "erc20",
    explorerTx: "https://snowtrace.io/tx/{hash}",
    explorerAddress: "https://snowtrace.io/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Optimism",
    chainId: 10,
    label: "Optimism",
    usdcKind: "erc20",
    explorerTx: "https://optimistic.etherscan.io/tx/{hash}",
    explorerAddress: "https://optimistic.etherscan.io/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Polygon",
    chainId: 137,
    label: "Polygon",
    usdcKind: "erc20",
    explorerTx: "https://polygonscan.com/tx/{hash}",
    explorerAddress: "https://polygonscan.com/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Unichain",
    chainId: 130,
    label: "Unichain",
    usdcKind: "erc20",
    explorerTx: "https://uniscan.xyz/tx/{hash}",
    explorerAddress: "https://uniscan.xyz/address/{address}",
    forwarderDestination: true,
  },
  {
    appKitChain: "Linea",
    chainId: 59144,
    label: "Linea",
    usdcKind: "erc20",
    explorerTx: "https://lineascan.build/tx/{hash}",
    explorerAddress: "https://lineascan.build/address/{address}",
    forwarderDestination: true,
  },
];

function asHexAddress(
  value: string | null | undefined,
): `0x${string}` | undefined {
  if (typeof value === "string" && value.startsWith("0x")) {
    return value as `0x${string}`;
  }
  return undefined;
}

/** Fill mainnet USDC (and Arc EURC) from App Kit bridge chain defs. */
function enrichMainnetFromKit(chains: BridgeChain[]): BridgeChain[] {
  if (!isMainnet) return chains;
  return chains.map((row) => {
    const kit = getKitBridgeChainByAppKitId(row.appKitChain);
    if (!kit) return row;
    const usdc = asHexAddress(kit.usdcAddress);
    const eurc = asHexAddress(kit.eurcAddress);
    return {
      ...row,
      ...(usdc ? { usdcAddress: usdc } : {}),
      ...(row.usdcKind === "native" && arcUsdcAddress
        ? { usdcAddress: arcUsdcAddress }
        : {}),
      ...(row.appKitChain === "Arc" && (eurc || arcEurcAddress)
        ? { eurcAddress: eurc ?? arcEurcAddress }
        : {}),
    };
  });
}

// Sync Arc row with network.ts (ids / explorers may differ from static testnet row).
function withNetworkArc(chains: BridgeChain[]): BridgeChain[] {
  return chains.map((c) =>
    c.appKitChain === arcAppKitChain ||
    c.chainId === arcChainId ||
    c.appKitChain === "Arc_Testnet" ||
    c.appKitChain === "Arc"
      ? {
          ...c,
          appKitChain: arcAppKitChain as BridgeChainId,
          chainId: arcChainId as BridgeChainNumericId,
          label: arcDisplayName,
          explorerTx: arcExplorerTxUrl("{hash}"),
          explorerAddress: arcExplorerAddressUrl("{address}"),
        }
      : c,
  );
}

export const BRIDGE_CHAINS: BridgeChain[] = enrichMainnetFromKit(
  withNetworkArc(
    isMainnet ? MAINNET_BRIDGE_CHAINS : TESTNET_BRIDGE_CHAINS,
  ),
);

export function arcBridgeChainId(): BridgeChainId {
  return arcAppKitChain as BridgeChainId;
}

export function defaultBridgeFromChain(): BridgeChainId {
  return arcBridgeChainId();
}

export function defaultBridgeToChain(): BridgeChainId {
  return isMainnet ? "Base" : "Base_Sepolia";
}

export function bridgeChainById(id: BridgeChainId): BridgeChain | undefined {
  return BRIDGE_CHAINS.find((c) => c.appKitChain === id);
}

export function bridgeChainByNumericId(
  chainId: number | undefined,
): BridgeChain | undefined {
  if (chainId === undefined) return undefined;
  return BRIDGE_CHAINS.find((c) => c.chainId === chainId);
}

export function explorerTxUrl(id: BridgeChainId, hash: string): string | null {
  const chain = bridgeChainById(id);
  if (!chain || !hash) return null;
  return chain.explorerTx.replace("{hash}", hash);
}

export function explorerAddressUrl(
  id: BridgeChainId,
  address: string,
): string | null {
  const chain = bridgeChainById(id);
  if (!chain || !address) return null;
  return chain.explorerAddress.replace("{address}", address);
}

export function explorerAddressUrlByNumericId(
  chainId: number | undefined,
  address: string,
): string | null {
  const chain = bridgeChainByNumericId(chainId);
  if (!chain || !address) return null;
  return chain.explorerAddress.replace("{address}", address);
}

