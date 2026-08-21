/**
 * Arc Testnet faucet link.
 *
 * Arc uses USDC as its NATIVE gas token, so a brand-new wallet with a 0 USDC
 * balance can't do anything — not even receive, swap, or bridge — until it's
 * funded. The faucet is therefore the on-ramp for every new user, which is why
 * Vector surfaces it right on the wallet card (and nudges toward it when the
 * balance is empty).
 *
 * This is a plain outbound link: no funds move through Vector and no contract
 * is called from here, so there is nothing address-critical to verify — unlike
 * a swap/bridge/transfer, a wrong link can't misdirect money. The exact faucet
 * URL is environment-configurable so it can be pointed at the correct Arc faucet
 * WITHOUT a code change:
 *
 *   NEXT_PUBLIC_ARC_FAUCET_URL=https://<the-official-arc-faucet>
 *
 * The default below is Circle's testnet faucet (Circle operates Arc). If Arc
 * ships a dedicated faucet page, set the env var above to it — no redeploy of
 * code logic required.
 */
export const ARC_FAUCET_URL =
  process.env.NEXT_PUBLIC_ARC_FAUCET_URL?.trim() || "https://faucet.circle.com";
