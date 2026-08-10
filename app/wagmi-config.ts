import { http, createConfig } from "wagmi";
import { arcTestnet, baseSepolia, sepolia } from "viem/chains";
import { injected } from "wagmi/connectors";

// Arc Testnet — Circle's stablecoin-native L1.
// Chain ID 5042002, USDC as native gas. Full details:
// https://docs.arc.network/arc/references/connect-to-arc
//
// NOTE: the previous hardcoded RPC (https://rpc.testnet.arc.io) points at the
// old `arc.io` domain. viem's own canonical arcTestnet definition uses
// `rpc.testnet.arc.network` (with QuickNode/Blockdaemon fallbacks). Passing
// http() with no URL makes wagmi use that canonical, multi-endpoint default —
// more robust than a single hardcoded host, and no stale domain to rot.
//
// Base Sepolia (84532) and Ethereum Sepolia (11155111) are registered ONLY to
// support the CCTP Bridge feature: Circle's App Kit handles the actual burn/mint
// routing itself, but wagmi needs each chain registered so we can read the
// wallet's USDC balance ON the source chain (per-call `chainId` reads) and so
// the injected connector can switch to it for the burn. Swap remains
// Arc-only — adding these chains doesn't change any swap code path.
export const wagmiConfig = createConfig({
  chains: [arcTestnet, baseSepolia, sepolia],
  connectors: [
    injected(), // Picks up MetaMask, Rabby, Coinbase Wallet, Rainbow, etc.
  ],
  transports: {
    [arcTestnet.id]: http(),
    [baseSepolia.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
