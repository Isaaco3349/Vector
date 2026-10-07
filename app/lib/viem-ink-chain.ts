import { defineChain } from "viem";
import { isMainnet } from "./network";

export const inkMainnet = defineChain({
  id: 57073,
  name: "Ink",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc-gel.inkonchain.com"] },
  },
  blockExplorers: {
    default: {
      name: "Ink Explorer",
      url: "https://explorer.inkonchain.com",
    },
  },
});

export const inkSepolia = defineChain({
  id: 763373,
  name: "Ink Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc-gel-sepolia.inkonchain.com"] },
  },
  blockExplorers: {
    default: {
      name: "Ink Sepolia Explorer",
      url: "https://explorer-sepolia.inkonchain.com",
    },
  },
});

export const inkViemChain = isMainnet ? inkMainnet : inkSepolia;
