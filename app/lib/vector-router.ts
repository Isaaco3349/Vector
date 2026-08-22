"use client";

/**
 * Vector's own send-router on Arc — the single source of truth for its address,
 * ABI, and calldata encoding, shared by BOTH send paths.
 *
 * ── WHY THE ROUTER EXISTS ─────────────────────────────────────────────────────
 * On Arc, USDC is the NATIVE gas asset, so a normal send is a bare value
 * transfer: no contract is touched and no event is emitted, which means nothing
 * on-chain identifies the transfer as Vector activity. Routing the same send
 * through `VectorRouter.send(to, amount)` makes it a genuine contract call that
 * emits an indexable `VectorSend` log. The recipient still gets 100% of the
 * funds — the router's fee is deployed at ZERO (see contracts/VectorRouter.sol).
 *
 * ── CONFIG-GATED, NEVER A DEAD BUTTON ─────────────────────────────────────────
 * The address comes from NEXT_PUBLIC_VECTOR_ROUTER_ARC and is validated with
 * viem's `isAddress`. If it is unset or malformed, `vectorRouterAddress()`
 * returns null and BOTH send panels fall back to the transfer path that already
 * works in production today. So a missing/typo'd env var degrades to the current
 * behaviour rather than shipping a Send button that can only fail.
 *
 * ── UNITS ─────────────────────────────────────────────────────────────────────
 * `amount` is in Arc's NATIVE units (18 decimals — Arc's nativeCurrency.decimals),
 * NOT the 6 decimals used for the ERC-20 USDC representation at 0x3600…0000 and
 * for CCTP. That is because the router is payable and moves `msg.value`, which is
 * always denominated in the chain's native currency. The external path derives
 * this from the decimals wagmi reports for the chain, so it is never hardcoded.
 */

import { encodeFunctionData, isAddress, type Abi } from "viem";

/**
 * Arc's native-currency decimals, for converting a human amount into `msg.value`.
 *
 * VERIFIED VERBATIM from node_modules/@circle-fin/app-kit/chains.d.mts, the
 * `ArcTestnet` declaration (@112):
 *     readonly nativeCurrency: {
 *         readonly name: "USDC";
 *         readonly symbol: "USDC";
 *         readonly decimals: 18;
 *     };
 * Note this is DELIBERATELY different from the 6 decimals used by the ERC-20 USDC
 * representation at `usdcAddress: "0x3600…0000"` and by CCTP. The router is
 * payable, so it moves native value and must use the native scale.
 *
 * The external send path reads decimals from wagmi instead of using this, and the
 * router's own `msg.value == amount` check would revert on any mismatch — so this
 * constant being wrong could not silently move an unintended amount.
 */
export const ARC_NATIVE_DECIMALS = 18;


/**
 * Minimal ABI — only what Vector calls. Copied from contracts/VectorRouter.sol
 * in this repo (not a third-party address, so there is nothing to guess here).
 */
export const VECTOR_ROUTER_ABI = [
  {
    type: "function",
    name: "send",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [
      { name: "fee", type: "uint256" },
      { name: "payout", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "feeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
] as const satisfies Abi;

/**
 * The deployed router on Arc Testnet, or null when not configured.
 * Validated rather than trusted: a malformed env var must not become a `to`.
 */
export function vectorRouterAddress(): `0x${string}` | null {
  const raw = process.env.NEXT_PUBLIC_VECTOR_ROUTER_ARC;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!isAddress(trimmed)) {
    // Loud in the console, silent in the UI: we fall back to a plain transfer
    // rather than surfacing a config error to an end user mid-send.
    if (typeof console !== "undefined") {
      console.error(
        "[Vector] NEXT_PUBLIC_VECTOR_ROUTER_ARC is not a valid address — " +
          "falling back to a plain transfer for Send.",
      );
    }
    return null;
  }
  return trimmed as `0x${string}`;
}

/**
 * ABI-encode `send(to, amount)`. Used by the Google/W3S path, which must hand
 * Circle raw calldata; the external path lets wagmi encode from the ABI instead.
 *
 * `amount` is passed twice on purpose — as calldata here and as the native value
 * alongside it. The contract reverts unless they match exactly, so a units
 * disagreement fails loudly instead of moving an unintended amount.
 */
export function encodeVectorSend(
  to: `0x${string}`,
  amountNative: bigint,
): `0x${string}` {
  return encodeFunctionData({
    abi: VECTOR_ROUTER_ABI,
    functionName: "send",
    args: [to, amountNative],
  });
}
