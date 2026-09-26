import { arcEurcAddress, isMainnet } from "./network";

/**
 * First-party tokens on Arc (testnet or mainnet — addresses differ).
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
 * On Arc Testnet all three assets (USDC/EURC/cirBTC) can be swappable; on Arc
 * mainnet cirBTC is withheld when App Kit exposes no mainnet locator (see
 * `cirBtcArcToken`). Keep the ARC_TOKENS vs ARC_SWAP_TOKENS split so a token
 * that cannot route is never offered as a swap button.
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
/** EURC contract on Arc — testnet literal; mainnet from App Kit via network.ts. */
const EURC_ADDRESS: `0x${string}` = isMainnet
  ? (arcEurcAddress ??
    ("0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as `0x${string}`))
  : "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

/** Testnet locator only — Arc mainnet swap chain def has no cirBTC field in App Kit. */
const CIRBTC_ARC_TESTNET_ADDRESS =
  "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF" as const;

function cirBtcArcToken(): SwapToken {
  if (isMainnet) {
    return {
      symbol: "cirBTC",
      name: "Circle Bitcoin",
      kind: "unknown",
      swappable: false,
    };
  }
  return {
    symbol: "cirBTC",
    name: "Circle Bitcoin",
    kind: "erc20",
    address: CIRBTC_ARC_TESTNET_ADDRESS,
    // Testnet: re-enabled 2026-08-27 after 1003/FATAL was misread as “no route”.
    swappable: true,
  };
}

export const ARC_TOKENS: SwapToken[] = [
  { symbol: "USDC", name: "USD Coin", kind: "native", swappable: true },
  cirBtcArcToken(),
  {
    symbol: "EURC",
    name: "Euro Coin",
    kind: "erc20",
    // Verified from the installed Circle SDK: the Arc chain def's `eurcAddress`
    // (swap-kit + adapter-viem-v2). EURC is 6-decimal; useTokenBalance reads
    // decimals() on-chain regardless.
    address: EURC_ADDRESS,
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
