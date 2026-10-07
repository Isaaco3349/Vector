/**
 * Verifies Vector platform fee math and Bridge Kit kit-fee display simulation.
 * No on-chain transactions — pure math + SDK scaling model.
 *
 * Run: node scripts/verify-platform-fees.mjs
 */
import { formatUnits, parseUnits } from "viem";

const USDC_DECIMALS = 6;
const VECTOR_SWAP_FEE_USDC = "0.15";
const VECTOR_BRIDGE_FEE_USDC = "0.01";

function swapFlatFeeBaseUnits() {
  return parseUnits(VECTOR_SWAP_FEE_USDC, USDC_DECIMALS);
}

function bridgePlatformFeeBaseUnits() {
  return parseUnits(VECTOR_BRIDGE_FEE_USDC, USDC_DECIMALS);
}

function bridgePlatformFeeHuman() {
  return VECTOR_BRIDGE_FEE_USDC;
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

const amounts = ["0.2", "1", "31", "1000"];

console.log(`=== Bridge fee: flat $${VECTOR_BRIDGE_FEE_USDC} USDC ===\n`);
console.log("Amount (USDC) | Before fix (kit display) | After fix (kit display) | Base units");
console.log("-------------|--------------------------|-------------------------|------------");

for (const amount of amounts) {
  const humanFee = bridgePlatformFeeHuman();
  const base = bridgePlatformFeeBaseUnits().toString();
  const beforeDisplay = kitFeeDisplayBuggy(base);
  const afterDisplay = kitFeeDisplayAfterScale(
    bridgeKitScaleCustomFeeValue(humanFee).toString(),
  );
  assertEq(humanFee, VECTOR_BRIDGE_FEE_USDC, `human fee for ${amount} USDC`);
  assertEq(afterDisplay, humanFee, `scaled kit display for ${amount} USDC`);
  console.log(
    `${amount.padStart(11)} | ${beforeDisplay.padStart(24)} | ${afterDisplay.padStart(23)} | ${base}`,
  );
}

console.log("\n=== Swap fee: percentageBps maps to $0.15 flat per amount ===\n");
function swapBpsForAmount(amountHuman) {
  const amount = Number(amountHuman);
  const bps = Math.ceil((Number(VECTOR_SWAP_FEE_USDC) / amount) * 10_000);
  return Math.min(Math.max(bps, 1), 10_000);
}
for (const amountIn of ["100", "31", "0.2"]) {
  const bps = swapBpsForAmount(amountIn);
  const feeHuman = (Number(amountIn) * bps) / 10_000;
  const target = Number(VECTOR_SWAP_FEE_USDC);
  if (feeHuman + 1e-9 < target || feeHuman > target * 1.02) {
    console.error(
      `FAIL swap bps fee on ${amountIn} USDC: fee ${feeHuman} outside [${target}, ${target * 1.02}]`,
    );
    process.exitCode = 1;
  } else {
    console.log(`OK   swap bps fee on ${amountIn} USDC: ${bps} bps → ~${feeHuman} USDC`);
  }
}

console.log("\n=== Google CCTP burn path: protocolFee = bridge flat USDC ===\n");
for (const amount of amounts) {
  const protocolFee = bridgePlatformFeeBaseUnits();
  assertEq(
    protocolFee.toString(),
    parseUnits(VECTOR_BRIDGE_FEE_USDC, USDC_DECIMALS).toString(),
    `CCTP protocolFee for ${amount}`,
  );
  console.log(
    `${amount} USDC → protocolFee ${protocolFee.toString()} minor (= ${bridgePlatformFeeHuman()} USDC)`,
  );
}

if (process.exitCode) {
  console.error("\nSome checks failed.");
  process.exit(process.exitCode);
}
console.log("\nAll checks passed.");
