import { http, createConfig } from "wagmi";
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  linea,
  lineaSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
  unichain,
  unichainSepolia,
} from "viem/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { isMainnet, rpcUrl as arcRpcUrl } from "./lib/network";
import { arcViemChain } from "./lib/viem-arc-chain";
import { inkViemChain } from "./lib/viem-ink-chain";

const testnetChains = [
  arcViemChain,
  baseSepolia,
  sepolia,
  arbitrumSepolia,
  avalancheFuji,
  optimismSepolia,
  polygonAmoy,
  unichainSepolia,
  lineaSepolia,
  inkViemChain,
] as const;

const mainnetChains = [
  arcViemChain,
  mainnet,
  base,
  arbitrum,
  avalanche,
  optimism,
  polygon,
  unichain,
  linea,
  inkViemChain,
] as const;

const chains = isMainnet ? mainnetChains : testnetChains;

function transportMap(
  entries: readonly { id: number }[],
): Record<number, ReturnType<typeof http>> {
  return Object.fromEntries(entries.map((c) => [c.id, http()]));
}

const transports = transportMap(chains);
transports[arcViemChain.id] = http(arcRpcUrl);

const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim();

const connectors = [
  injected(),
  ...(wcProjectId
    ? [
        walletConnect({
          projectId: wcProjectId,
          showQrModal: true,
          metadata: {
            name: "Vector Protocol",
            description: "USDC-native DeFi on Arc — swap, bridge, earn",
            url: "https://vectorprotocol.pro",
            icons: ["https://vectorprotocol.pro/icon.svg"],
          },
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
