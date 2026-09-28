/**
 * Verifies Vector platform fee math and Bridge Kit kit-fee display simulation.
 * No on-chain transactions — pure math + SDK scaling model.
 *
 * Run: node scripts/verify-platform-fees.mjs
 */
import { formatUnits, parseUnits } from "viem";

const USDC_DECIMALS = 6;
const BRIDGE_FEE_BPS = 10;
const SWAP_FEE_BPS = 25;

function bridgePlatformFeeBaseUnits(amountHuman) {
  const amountBase = parseUnits(amountHuman, USDC_DECIMALS);
  return (amountBase * BigInt(BRIDGE_FEE_BPS)) / BigInt(10_000n);
}

function bridgePlatformFeeHuman(amountHuman) {
  return formatUnits(bridgePlatformFeeBaseUnits(amountHuman), USDC_DECIMALS);
}

/** Bridge Kit: scale human customFee.value to base units (USDC 6 dp). */
function bridgeKitScaleCustomFeeValue(humanValue) {
  return parseUnits(humanValue, USDC_DECIMALS);
}

/** CCTP provider addKitFeeEstimate: formatUnits(BigInt(value), 6) on scaled value. */
function kitFeeDisplayAfterScale(scaledValueString) {
  return formatUnits(BigInt(scaledValueString), USDC_DECIMALS);
}

/** Wrong path: treat base-unit string as human, then scale (production bug). */
function kitFeeDisplayBuggy(baseUnitsPassedAsHuman) {
  const wronglyScaled = parseUnits(baseUnitsPassedAsHuman, USDC_DECIMALS);
  return formatUnits(wronglyScaled, USDC_DECIMALS);
}

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${label}: ${actual}`);
}

function expectedHumanFee(amountHuman) {
  const n = Number(amountHuman);
  const fee = (n * BRIDGE_FEE_BPS) / 10_000;
  return fee.toString();
}

const amounts = ["0.2", "1", "31", "1000"];

console.log("=== Bridge fee: amount × 10 / 10_000 (human USDC) ===\n");
console.log("Amount (USDC) | Before fix (kit display) | After fix (kit display) | Base units");
console.log("-------------|--------------------------|-------------------------|------------");

for (const amount of amounts) {
  const humanFee = bridgePlatformFeeHuman(amount);
  const base = bridgePlatformFeeBaseUnits(amount).toString();
  const beforeDisplay = kitFeeDisplayBuggy(base);
  const afterDisplay = kitFeeDisplayAfterScale(
    bridgeKitScaleCustomFeeValue(humanFee).toString(),
  );
  assertEq(humanFee, expectedHumanFee(amount), `human fee for ${amount} USDC`);
  assertEq(afterDisplay, humanFee, `scaled kit display for ${amount} USDC`);
  console.log(
    `${amount.padStart(11)} | ${beforeDisplay.padStart(24)} | ${afterDisplay.padStart(23)} | ${base}`,
  );
}

console.log("\n=== Swap fee: percentageBps only (no amount scaling) ===\n");
for (const amountIn of ["100", "31", "0.2"]) {
  const inBase = parseUnits(amountIn, USDC_DECIMALS);
  const feeBase = (inBase * BigInt(SWAP_FEE_BPS)) / BigInt(10_000n);
  const feeHuman = formatUnits(feeBase, USDC_DECIMALS);
  const pct = (Number(amountIn) * SWAP_FEE_BPS) / 10_000;
  assertEq(
    feeHuman,
    formatUnits(parseUnits(String(pct), USDC_DECIMALS), USDC_DECIMALS),
    `swap 25 bps on ${amountIn} USDC`,
  );
  console.log(
    `Input ${amountIn} USDC → kit fee ~${feeHuman} USDC (${SWAP_FEE_BPS} bps = 0.25%)`,
  );
}

console.log("\n=== Google CCTP burn path: protocolFee base units = 0.10% of amount ===\n");
for (const amount of amounts) {
  const amountMinor = parseUnits(amount, USDC_DECIMALS);
  const protocolFee = bridgePlatformFeeBaseUnits(amount);
  const recomputed = (amountMinor * BigInt(BRIDGE_FEE_BPS)) / BigInt(10_000n);
  assertEq(protocolFee.toString(), recomputed.toString(), `CCTP protocolFee for ${amount}`);
  console.log(
    `${amount} USDC → protocolFee ${protocolFee.toString()} minor (= ${bridgePlatformFeeHuman(amount)} USDC)`,
  );
}

if (process.exitCode) {
  console.error("\nSome checks failed.");
  process.exit(process.exitCode);
}
console.log("\nAll checks passed.");
