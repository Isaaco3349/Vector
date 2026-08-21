/**
 * Chains available for CCTP bridging in Vector.
 *
 * The bridge moves USDC cross-chain via Circle's CCTP v2 (burn on source,
 * mint on destination). App Kit dictates which chains are actually bridgeable
 * through its `BridgeChain` enum — this registry lists ONLY the testnet chains
 * that both (a) appear in that enum and (b) we've verified against the SDK's
 * own chain table, so no route here can send funds somewhere CCTP isn't
 * deployed.
 *
 * Every value below (chainId, USDC address, explorer URL, forwarder support)
 * is copied verbatim from the installed SDK's first-party chain definitions
 * (node_modules/@circle-fin/app-kit/chains.d.mts, each chain's `cctp` block) and
 * cross-checked against viem's chain ids + block explorers. Nothing is hardcoded
 * from memory — a wrong bridge address could burn real test funds into a dead
 * contract. Every destination below has `cctp.forwarderSupported.destination =
 * true`, so Circle's relayer mints on the destination and the wallet never has
 * to switch chains mid-flow.
 *
 * NOT included, on purpose:
 *  - Sonic Testnet: Circle's chainId (14601) does NOT match viem's `sonicTestnet`
 *    (64165) or `sonicBlazeTestnet` (57054). Registering it in wagmi under the
 *    wrong id would misroute balance reads / chain switches, so it's excluded
 *    until a manual viem chain def with id 14601 is verified.
 *  - Solana Devnet: non-EVM — incompatible with the wagmi / injected path.
 *  - BNB / BSC: absent from App Kit's BridgeChain enum (Circle hasn't deployed
 *    CCTP there). Adding it would be a guess that fails — or worse, misroutes.
 *  - USDT: Circle's SDK has no Arc_Testnet USDT locator, so USDT can't be a swap
 *    token on Arc (see swap-tokens.ts); bridging is USDC-only regardless.
 *  - Mainnets: this app is testnet-only for now.
 */

/** The exact string literals App Kit's `from.chain` / `to.chain` accept for bridging. */
export type BridgeChainId =
  | "Arc_Testnet"
  | "Base_Sepolia"
  | "Ethereum_Sepolia"
  | "Arbitrum_Sepolia"
  | "Avalanche_Fuji"
  | "Optimism_Sepolia"
  | "Polygon_Amoy_Testnet"
  | "Unichain_Sepolia"
  | "Linea_Sepolia";

/**
 * The numeric chain ids, as a literal union. These MUST match the chains
 * registered in app/wagmi-config.ts — wagmi's `chainId` read option is typed to
 * the registered set, so keeping this a literal union means a chain that isn't
 * actually registered can't slip into a balance read.
 */
export type BridgeChainNumericId =
  | 5042002
  | 84532
  | 11155111
  | 421614
  | 43113
  | 11155420
  | 80002
  | 1301
  | 59141;

export type BridgeChain = {
  /** App Kit chain identifier string (a BridgeChain enum literal). */
  appKitChain: BridgeChainId;
  /** viem/wagmi numeric chain id — used to scope balance reads to this chain. */
  chainId: BridgeChainNumericId;
  /** Short label for the UI. */
  label: string;
  /**
   * How to read the wallet's USDC balance on this chain:
   *  - "native": USDC is the native gas asset (Arc) → wagmi useBalance, no address.
   *  - "erc20": USDC is a standard ERC-20 at `usdcAddress`.
   */
  usdcKind: "native" | "erc20";
  /** ERC-20 USDC address (only when usdcKind === "erc20"). From SDK chains.d.mts. */
  usdcAddress?: `0x${string}`;
  /** Explorer tx URL template; replace `{hash}`. From SDK chains.d.mts. */
  explorerTx: string;
  /**
   * Explorer ADDRESS URL template; replace `{address}`. This is the account's
   * activity page on the same block explorer as `explorerTx` — every explorer
   * we use (arcscan, basescan, etherscan) exposes it at the standard
   * `/address/<addr>` path. It needs no API key or lookup, so it's the
   * always-correct fallback link when a specific tx hash isn't available (e.g.
   * a W3S CREATE_TRANSACTION challenge returns no hash) and the source of truth
   * for "view my full history".
   */
  explorerAddress: string;
  /**
   * Whether Circle's Forwarder supports this chain as a bridge DESTINATION.
   * Verified `true` for every chain here in chains.d.mts (`cctp.forwarderSupported`).
   * When true, we can pass `useForwarder: true` so the relayer mints on the
   * destination and the wallet never has to switch chains mid-flow.
   */
  forwarderDestination: boolean;
};

export const BRIDGE_CHAINS: BridgeChain[] = [
  {
    appKitChain: "Arc_Testnet",
    chainId: 5042002,
    label: "Arc Testnet",
    // On Arc, USDC IS the native gas asset (18 decimals) — read as native
    // balance. (An ERC-20 interface also exists at 0x3600…0000, but the
    // spendable balance users care about is the native one.)
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

export function bridgeChainById(id: BridgeChainId): BridgeChain | undefined {
  return BRIDGE_CHAINS.find((c) => c.appKitChain === id);
}

/**
 * Look up a chain by its numeric (viem/wagmi) id — used by the Send feature,
 * which operates on whatever network the wallet is currently connected to.
 * Returns undefined for any chain Vector doesn't support, so the UI can say
 * "switch to a supported network" instead of guessing how to move funds.
 */
export function bridgeChainByNumericId(
  chainId: number | undefined,
): BridgeChain | undefined {
  if (chainId === undefined) return undefined;
  return BRIDGE_CHAINS.find((c) => c.chainId === chainId);
}

/** Build an explorer tx URL for a given chain + hash, or null if unknown. */
export function explorerTxUrl(id: BridgeChainId, hash: string): string | null {
  const chain = bridgeChainById(id);
  if (!chain || !hash) return null;
  return chain.explorerTx.replace("{hash}", hash);
}

/**
 * Build an explorer ADDRESS (account activity) URL for a given chain + address.
 * Unlike a tx link, this needs no hash and can't be wrong — it's the fallback
 * we always show for W3S transactions (whose challenge result carries no hash)
 * and the "view full history" link. Returns null only if the chain is unknown.
 */
export function explorerAddressUrl(
  id: BridgeChainId,
  address: string,
): string | null {
  const chain = bridgeChainById(id);
  if (!chain || !address) return null;
  return chain.explorerAddress.replace("{address}", address);
}

/**
 * Same as explorerAddressUrl but keyed by the numeric (viem/wagmi) chain id —
 * used by the external-wallet history view, which only knows the connected
 * chain's numeric id. Returns null for any chain Vector doesn't support.
 */
export function explorerAddressUrlByNumericId(
  chainId: number | undefined,
  address: string,
): string | null {
  const chain = bridgeChainByNumericId(chainId);
  if (!chain || !address) return null;
  return chain.explorerAddress.replace("{address}", address);
}
