/**
 * First-party tokens on Arc Testnet.
 *
 * Two lists come out of this file, and the distinction matters:
 *  - `ARC_TOKENS` — everything the wallet can HOLD and Vector can display.
 *  - `ARC_SWAP_TOKENS` — the subset Circle's swap service will actually route.
 *
 * They are not the same set. A token can be a real, faucet-funded Arc asset with
 * a verified address and still have no swap route, which is exactly the case for
 * cirBTC (see below). Conflating the two is what previously put a token in the
 * Swap selector that could only ever produce an error.
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
  /**
   * Whether Circle's swap service routes this token on Arc Testnet.
   *
   * This is an OBSERVED fact, not an assumption: it may only be set false on
   * the strength of Circle's own FATAL verdict for the pair (KitError
   * `INPUT_UNSUPPORTED_ROUTE` / 1003), never because a swap merely failed or
   * looked unlikely. Slippage failures, thin liquidity and timeouts all clear
   * on their own and must NOT flip this flag.
   *
   * Tokens with `swappable: false` still appear in the portfolio with a live
   * balance — they just aren't offered in the Swap selector, because a token
   * that cannot route is a button that can only ever return an error.
   */
  swappable: boolean;
};

/**
 * Every Arc Testnet asset Vector can hold and display. This is the list the
 * balance lookup uses, so a token stays visible in the portfolio whether or not
 * it can be swapped.
 */
export const ARC_TOKENS: SwapToken[] = [
  { symbol: "USDC", name: "USD Coin", kind: "native", swappable: true },
  {
    symbol: "cirBTC",
    name: "Circle Bitcoin",
    kind: "erc20",
    // Verified from Circle SDK token registry: CIRBTC.locators[Arc_Testnet].
    // cirBTC is 8-decimal; useTokenBalance reads decimals() on-chain regardless.
    address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
    // Confirmed unroutable 2026-08-22, from Circle's own structured error on the
    // deployed app: USDC → cirBTC returns INPUT_UNSUPPORTED_ROUTE (1003), which
    // the SDK marks FATAL — not a liquidity dip, not a slippage constraint, but
    // "this pair does not route". cirBTC remains a genuine Arc asset that
    // Circle's faucet funds, so it keeps its place in the portfolio; it is only
    // withheld from Swap. Flip this back to true if Circle enables the route.
    swappable: false,
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    kind: "erc20",
    // Verified from the installed Circle SDK: the Arc chain def's `eurcAddress`
    // (swap-kit + adapter-viem-v2). EURC is 6-decimal; useTokenBalance reads
    // decimals() on-chain regardless.
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    swappable: true,
  },
];

/**
 * The tokens offered in the Swap selector — derived from `ARC_TOKENS` rather
 * than written out again, so there is one place to change a token's status and
 * no chance of the two lists disagreeing.
 */
export const ARC_SWAP_TOKENS: SwapToken[] = ARC_TOKENS.filter(
  (t) => t.swappable,
);

/** Look up any holdable Arc token — swappable or not — by symbol. */
export function tokenBySymbol(symbol: string): SwapToken | undefined {
  return ARC_TOKENS.find((t) => t.symbol === symbol);
}
