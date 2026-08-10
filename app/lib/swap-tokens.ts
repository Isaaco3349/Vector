/**
 * Swap tokens available on Arc Testnet via Circle's App Kit.
 *
 * The `symbol` is what App Kit's `tokenIn`/`tokenOut` expect (symbolic
 * identifiers — the SDK resolves routing itself). The `address` is only used
 * locally to read the wallet's ERC-20 balance for display; it is NOT passed to
 * the swap call.
 *
 * Addresses/kind are from Arc's official docs (docs.arc.io/references/
 * contract-addresses), corroborated across multiple sources:
 *  - USDC: the NATIVE gas asset on Arc (read via native balance, no address).
 *          An optional ERC-20 interface also exists at 0x3600…0000, but the
 *          spendable balance users care about is the native one.
 *  - EURC: ERC-20 at 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a.
 *
 * cirBTC was tried and removed: App Kit returns "No route available" for it in
 * any direction on Arc Testnet, and no first-party contract address is
 * published. Rather than offer a token that always errors, we list only what
 * actually swaps. Re-add it here (with a verified address) if/when Circle
 * enables a route.
 *
 * Decimals are intentionally NOT hardcoded — the balance hook reads decimals()
 * on-chain so a wrong constant can't misreport a balance.
 *
 * If a pair has no liquidity/route yet, App Kit surfaces that at estimate time
 * — we show that error rather than pretending a quote exists.
 */
export type SwapToken = {
  symbol: string;
  name: string;
  /**
   * How to read this token's balance:
   *  - "native": Arc's native asset (USDC) — via wagmi useBalance, no address.
   *  - "erc20": standard ERC-20 at `address`.
   *  - "unknown": address not yet verified — balance is not displayed.
   */
  kind: "native" | "erc20" | "unknown";
  /** ERC-20 contract address (only for kind === "erc20"). */
  address?: `0x${string}`;
};

export const ARC_SWAP_TOKENS: SwapToken[] = [
  { symbol: "USDC", name: "USD Coin", kind: "native" },
  {
    symbol: "EURC",
    name: "Euro Coin",
    kind: "erc20",
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  },
];

export function tokenBySymbol(symbol: string): SwapToken | undefined {
  return ARC_SWAP_TOKENS.find((t) => t.symbol === symbol);
}
