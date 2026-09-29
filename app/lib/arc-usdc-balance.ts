/**
 * Arc USDC: one underlying balance, two interfaces (Arc docs).
 * @see https://docs.arc.io/arc/references/evm-differences
 * Native = 18 decimals (gas, eth_getBalance). ERC-20 at 0x3600… = 6 decimals.
 * Convert with 10^12 at boundaries — never treat as two separate tokens.
 */

export const ARC_USDC_SCALE = BigInt(1_000_000_000_000);

/** ERC-20 minor units (6 dp) from native wei (18 dp). */
export function arcUsdcNativeToErc20Minor(nativeWei: bigint): bigint {
  return nativeWei / ARC_USDC_SCALE;
}

/** Human-readable USDC from native wei (18 dp on Arc). */
export function arcUsdcHumanFromNativeWei(nativeWei: bigint): string {
  const whole = nativeWei / BigInt(10 ** 18);
  const frac = nativeWei % BigInt(10 ** 18);
  const frac6 = frac / ARC_USDC_SCALE;
  if (frac6 === BigInt(0)) return whole.toString();
  const fracStr = frac6.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
