/**
 * Swap tokens available on Arc Testnet via Circle's App Kit.
 *
 * The `symbol` is what App Kit's `tokenIn`/`tokenOut` expect (symbolic
 * identifiers — the SDK resolves routing itself). The `address` is only used
 * locally to read the wallet's ERC-20 balance for display; it is NOT passed to
 * the swap call.
 *
 * Every address/kind below is copied VERBATIM from the installed Circle SDK's
 * first-party token registry (not guessed):
 *  - USDC: the NATIVE gas asset on Arc (read via native balance, no address).
 *          An optional ERC-20 interface also exists at 0x3600…0000, but the
 *          spendable balance users care about is the native one.
 *  - cirBTC: ERC-20 at 0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF (8 decimals).
 *          Verified from the SDK registry — its own docs state
 *          `CIRBTC.locators[Blockchain.Arc_Testnet]` = that address and
 *          `CIRBTC.decimals` = 8 (@circle-fin/swap-kit + app-kit bundles).
 *  - EURC: ERC-20 at 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a (6 decimals).
 *          Verified from the installed SDK: the Arc chain def carries
 *          `eurcAddress: '0x89B5…D72a'` (swap-kit + adapter-viem-v2 bundles) and
 *          the token registry states `EURC.decimals` = 6. EURC is one of exactly
 *          three assets Circle's official Arc faucet funds (USDC/EURC/cirBTC), so
 *          it belongs in the canonical Arc set.
 *
 * NOT offered here, on purpose:
 *  - USDT: Circle's installed SDK has NO Arc_Testnet USDT locator (the Arc chain
 *          def carries `usdtAddress: null`). We will not guess an address with
 *          real test funds at stake — add it here only once a first-party Arc
 *          USDT address is verified.
 *
 * Decimals are intentionally NOT hardcoded here — the balance hook reads
 * decimals() on-chain so a wrong constant can't misreport a balance.
 *
 * If a pair has no liquidity/route yet, App Kit surfaces that at estimate time
 * — we show that error rather than pretending a quote exists. So listing a token
 * that lacks a route can't move funds; the swap simply reports "no route".
 */
export type SwapToken = {
  symbol: string;
  name: string;
  /**
   * How to read this token's balance:
   *  - "native": Arc's native asset (USDC) — via wagmi useBalance, no address.
   *  - "erc20": standard ERC-20 at `address` (decimals read on-chain).
   *  - "unknown": address not yet verified — balance is not displayed.
   */
  kind: "native" | "erc20" | "unknown";
  /** ERC-20 contract address (only for kind === "erc20"). */
  address?: `0x${string}`;
};

export const ARC_SWAP_TOKENS: SwapToken[] = [
  { symbol: "USDC", name: "USD Coin", kind: "native" },
  {
    symbol: "cirBTC",
    name: "Circle Bitcoin",
    kind: "erc20",
    // Verified from Circle SDK token registry: CIRBTC.locators[Arc_Testnet].
    // cirBTC is 8-decimal; useTokenBalance reads decimals() on-chain regardless.
    address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    kind: "erc20",
    // Verified from the installed Circle SDK: the Arc chain def's `eurcAddress`
    // (swap-kit + adapter-viem-v2). EURC is 6-decimal; useTokenBalance reads
    // decimals() on-chain regardless.
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  },
];

export function tokenBySymbol(symbol: string): SwapToken | undefined {
  return ARC_SWAP_TOKENS.find((t) => t.symbol === symbol);
}
