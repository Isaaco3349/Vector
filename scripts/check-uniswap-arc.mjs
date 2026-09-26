#!/usr/bin/env node
/**
 * Uniswap on Arc mainnet (5042) — READ-ONLY on-chain probe.
 * Uses existing project dependency `viem` only.
 *
 *   node scripts/check-uniswap-arc.mjs
 *
 * Sources for deployment addresses (official Uniswap docs / subgraph):
 *   v4: https://developers.uniswap.org/docs/protocols/v4/deployments (Arc: 5042)
 *   v3 factory: Uniswap v3-subgraph config/arc-mainnet (PR #300)
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  zeroAddress,
} from "viem";

const CHAIN_ID = 5042;
const RPC = "https://rpc.mainnet.arc.io";

/** App Kit Arc mainnet */
const USDC = getAddress("0x3600000000000000000000000000000000000000");
const EURC = getAddress("0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1");

/** Uniswap v3-subgraph arc-mainnet + deployments.json (developers.uniswap.org) */
const V3_FACTORY = getAddress("0xf0db7b58379503491d857db50ac9ece64c653918");
const V3_QUOTER_V2 = getAddress("0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468");
const V3_SWAP_ROUTER_02 = getAddress("0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77");

/** Uniswap official v4 deployments — Arc 5042 */
const V4_POOL_MANAGER = getAddress(
  "0x8366a39CC670B4001A1121B8F6A443A643e40951",
);
const V4_QUOTER = getAddress("0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94");
const V4_UNIVERSAL_ROUTER = getAddress(
  "0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1",
);

const AMOUNT_IN = 5_000_000n; // 5 USDC @ 6 decimals

const V3_FEE_TIERS = [100, 500, 3000, 10000];

const __dirname = dirname(fileURLToPath(import.meta.url));
const report = { probedAt: new Date().toISOString(), chainId: CHAIN_ID, steps: {} };

const arcChain = {
  id: CHAIN_ID,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};

const client = createPublicClient({ chain: arcChain, transport: http(RPC) });

function hr(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

async function bytecodeCheck(label, address) {
  const code = await client.getBytecode({ address });
  const deployed = Boolean(code && code !== "0x");
  const entry = {
    address,
    deployed,
    bytecodeBytes: deployed ? (code.length - 2) / 2 : 0,
  };
  console.log(`${label}: ${address} → deployed=${deployed}, bytes=${entry.bytecodeBytes}`);
  report.steps[label] = entry;
  return entry;
}

const factoryAbi = [
  {
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    name: "getPool",
    outputs: [{ name: "pool", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

const poolAbi = [
  {
    inputs: [],
    name: "liquidity",
    outputs: [{ name: "", type: "uint128" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token0",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

const quoterV2Abi = [
  {
    inputs: [
      {
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "quoteExactInputSingle",
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
];

/** v4 periphery Quoter — quoteExactInputSingle(QuoteExactSingleParams) */
const v4QuoterAbi = [
  {
    inputs: [
      {
        components: [
          {
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
            name: "poolKey",
            type: "tuple",
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "quoteExactInputSingle",
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
];

const V3_QUOTER_CANDIDATES = [V3_QUOTER_V2];

async function tryV3Quote(quoterAddress, fee, pool) {
  try {
    const result = await client.simulateContract({
      address: quoterAddress,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: USDC,
          tokenOut: EURC,
          amountIn: AMOUNT_IN,
          fee,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    return {
      ok: true,
      quoterAddress,
      fee,
      pool,
      amountOut: result.result[0].toString(),
      amountOutFormatted: formatUnits(result.result[0], 6),
      gasEstimate: result.result[3].toString(),
      raw: result.result,
    };
  } catch (err) {
    return {
      ok: false,
      quoterAddress,
      fee,
      pool,
      error: err.shortMessage || err.message || String(err),
    };
  }
}

async function tryV4Quote(fee, tickSpacing) {
  const [currency0, currency1] =
    USDC.toLowerCase() < EURC.toLowerCase() ? [USDC, EURC] : [EURC, USDC];
  const zeroForOne = USDC === currency0;

  try {
    const result = await client.simulateContract({
      address: V4_QUOTER,
      abi: v4QuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey: {
            currency0,
            currency1,
            fee,
            tickSpacing,
            hooks: zeroAddress,
          },
          zeroForOne,
          exactAmount: AMOUNT_IN,
          hookData: "0x",
        },
      ],
    });
    return {
      ok: true,
      fee,
      tickSpacing,
      amountOut: result.result[0].toString(),
      amountOutFormatted: formatUnits(result.result[0], 6),
      gasEstimate: result.result[1].toString(),
    };
  } catch (err) {
    return {
      ok: false,
      fee,
      tickSpacing,
      error: err.shortMessage || err.message || String(err),
    };
  }
}

hr("Official deployment addresses (documented)");
console.log(`
v3 Factory / QuoterV2 / SwapRouter02 (Uniswap deployments.json, Arc 5042):
  Factory: ${V3_FACTORY}
  QuoterV2: ${V3_QUOTER_V2}
  SwapRouter02: ${V3_SWAP_ROUTER_02}
v4 PoolManager / Quoter / Universal Router (developers.uniswap.org v4 deployments, Arc 5042):
  PoolManager: ${V4_POOL_MANAGER}
  Quoter:      ${V4_QUOTER}
  UR:          ${V4_UNIVERSAL_ROUTER}
Tokens: USDC ${USDC}, EURC ${EURC} (Circle App Kit Arc mainnet)
`);

hr("On-chain: contracts deployed? (bytecode)");
await bytecodeCheck("v3_factory", V3_FACTORY);
await bytecodeCheck("v3_quoter_v2", V3_QUOTER_V2);
await bytecodeCheck("v3_swap_router_02", V3_SWAP_ROUTER_02);
await bytecodeCheck("v4_pool_manager", V4_POOL_MANAGER);
await bytecodeCheck("v4_quoter", V4_QUOTER);
await bytecodeCheck("v4_universal_router", V4_UNIVERSAL_ROUTER);

hr("v3: USDC/EURC pools via factory.getPool");
const poolScan = [];
for (const fee of V3_FEE_TIERS) {
  const pool = await client.readContract({
    address: V3_FACTORY,
    abi: factoryAbi,
    functionName: "getPool",
    args: [USDC, EURC, fee],
  });
  const entry = { fee, pool };
  if (pool === zeroAddress) {
    entry.exists = false;
    console.log(`fee ${fee}: no pool`);
  } else {
    entry.exists = true;
    const [liquidity, slot0, token0, token1] = await Promise.all([
      client.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "token1" }),
    ]);
    entry.liquidity = liquidity.toString();
    entry.sqrtPriceX96 = slot0[0].toString();
    entry.tick = slot0[1];
    entry.token0 = token0;
    entry.token1 = token1;
    console.log(
      `fee ${fee}: pool ${pool} liquidity=${liquidity} tick=${slot0[1]}`,
    );
  }
  poolScan.push(entry);
}
report.steps.v3_pools = poolScan;

hr("v3: QuoterV2 quote (requires known quoter address)");
const v3Quotes = [];
const existingPools = poolScan.filter((p) => p.exists && p.liquidity !== "0");

// Try to locate QuoterV2: read SwapRouter02 from on-chain event is heavy; probe Robinhood doc pattern — same as Tempo deploy script output in some chains uses quoter next to factory.
// Probe: if any pool has liquidity, attempt quotes via simulate on addresses that have QuoterV2-style bytecode (function selector present).
if (existingPools.length === 0) {
  console.log("No v3 pools with non-zero liquidity found — skipping v3 quoter calls.");
  report.steps.v3_quotes = { skipped: "no_pools" };
} else {
  for (const cand of V3_QUOTER_CANDIDATES) {
    for (const p of existingPools) {
      v3Quotes.push(await tryV3Quote(cand, p.fee, p.pool));
    }
  }
  report.steps.v3_quotes = v3Quotes;
  console.log(JSON.stringify(v3Quotes, replacerBigInt, 2));
}

function replacerBigInt(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

hr("v4: quoteExactInputSingle USDC→EURC (fee/tickSpacing sweep)");
const v4FeeTickPairs = [
  [500, 10],
  [3000, 60],
  [10000, 200],
  [100, 1],
];
const v4Quotes = [];
for (const [fee, tickSpacing] of v4FeeTickPairs) {
  const q = await tryV4Quote(fee, tickSpacing);
  v4Quotes.push(q);
  console.log(
    q.ok
      ? `fee=${fee} tickSpacing=${tickSpacing} → ${q.amountOutFormatted} EURC (gasEst ${q.gasEstimate})`
      : `fee=${fee} tickSpacing=${tickSpacing} → ERROR: ${q.error}`,
  );
}
report.steps.v4_quotes = v4Quotes;

const outPath = join(__dirname, "check-uniswap-arc-output.json");
writeFileSync(outPath, JSON.stringify(report, replacerBigInt, 2));
console.log(`\nWrote ${outPath}`);
