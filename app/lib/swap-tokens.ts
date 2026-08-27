/**
 * First-party tokens on Arc Testnet.
 *
 * Two lists come out of this file, and the distinction matters:
 *  - `ARC_TOKENS` — everything the wallet can HOLD and Vector can display.
 *  - `ARC_SWAP_TOKENS` — the subset Circle's swap service will actually route.
 *
 * They are not necessarily the same set — a token can be a real, faucet-funded
 * Arc asset with a verified address and still have no swap route — so the split
 * is worth keeping regardless of which tokens currently sit on either side of
 * it. It exists so that a token which cannot route is never offered as a button
 * that can only return an error.
 *
 * ⚠️ As of 2026-08-27 the two lists are IDENTICAL — all three Arc assets
 * (USDC/EURC/cirBTC) are swappable. Keep the split anyway: it is what stops a
 * token that cannot route from being offered as a button that can only ever
 * return an error, and the last token to sit on the unswappable side (cirBTC)
 * turned out to have been put there on unsound reasoning. Read the `swappable`
 * doc below before ever setting it false again.
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
   * 🔴 READ THIS BEFORE SETTING IT FALSE. The bar is an OBSERVED fact, and one
   * specific thing that looks like proof is NOT proof:
   *
   * A KitError of `INPUT_UNSUPPORTED_ROUTE` / 1003 with `recoverability:
   * 'FATAL'` DOES NOT MEAN THE PAIR HAS NO ROUTE. Read from the installed SDK
   * (`swap-kit/index.cjs`, `handleClientError`): 1003/FATAL is the blanket
   * mapping applied to ANY HTTP 404 from the swap service that isn't a slippage
   * failure, and the `FATAL` label is hardcoded client-side — it is the SDK's
   * default for "404 and I don't know why", not a verdict from Circle about
   * liquidity. An earlier version of this file cited exactly that error as
   * confirmation and was wrong. Always read the `detail` string it carries.
   *
   * So do NOT flip this flag on a 1003, a slippage failure, thin liquidity, a
   * timeout, or a single failed attempt — all of those clear on their own. Flip
   * it only on evidence that survives BOTH of the endpoints Circle exposes
   * (`GET /quote` and `POST /swap`, which SwapPanel now tries in turn), or on a
   * first-party statement that the pair is unsupported.
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
    // ✅ RE-ENABLED 2026-08-27 on third-party evidence.
    //
    // History, so this isn't re-litigated: set false on 2026-08-22 because the
    // deployed app returned INPUT_UNSUPPORTED_ROUTE (1003, FATAL) for
    // USDC → cirBTC, which was read at the time as Circle stating the pair
    // doesn't route. That reading was WRONG — 1003/FATAL is the SDK's blanket
    // mapping for any unexplained 404 (see the `swappable` doc above), not a
    // liquidity verdict. The comment left here said the way to settle it was a
    // real observation rather than a second guess.
    //
    // That observation now exists and it is external to this codebase: cirBTC
    // swaps work in a THIRD-PARTY app (ezwallet.cash) against the same Circle
    // swap service on the same chain. A pair that routes for another caller
    // routes for us; whatever produced our 404 was on our side of the call, not
    // Circle's liquidity. Since 1003 was never evidence, there is nothing left
    // holding this false.
    //
    // If cirBTC declines again, the thing to capture is the `detail` string from
    // BOTH endpoints (SwapPanel tries GET /quote then POST /swap) — not the
    // 1003 code, which carries no information.
    swappable: true,
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
