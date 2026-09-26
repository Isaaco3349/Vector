import { defineChain } from "viem";
import { arcTestnet } from "viem/chains";
import {
  chainId,
  displayName,
  explorerBaseUrl,
  isMainnet,
  rpcUrl,
} from "./network";

/**
 * viem `Chain` for the configured Arc network.
 * viem ships `arcTestnet` only — mainnet is defined locally with id 5042.
 */
export const arcViemChain = isMainnet
  ? defineChain({
      id: chainId,
      name: displayName,
      nativeCurrency: {
        name: "USDC",
        symbol: "USDC",
        decimals: 18,
      },
      rpcUrls: {
        default: { http: [rpcUrl] },
      },
      blockExplorers: {
        default: {
          name: "Arcscan",
          url: explorerBaseUrl,
        },
      },
      testnet: false,
    })
  : arcTestnet;
