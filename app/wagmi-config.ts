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
import { injected } from "wagmi/connectors";
import { isMainnet, rpcUrl as arcRpcUrl } from "./lib/network";
import { arcViemChain } from "./lib/viem-arc-chain";

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
] as const;

const chains = isMainnet ? mainnetChains : testnetChains;

function transportMap(
  entries: readonly { id: number }[],
): Record<number, ReturnType<typeof http>> {
  return Object.fromEntries(entries.map((c) => [c.id, http()]));
}

const transports = transportMap(chains);
transports[arcViemChain.id] = http(arcRpcUrl);

export const wagmiConfig = createConfig({
  chains,
  connectors: [injected()],
  transports,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
