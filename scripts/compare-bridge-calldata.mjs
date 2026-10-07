/**
 * Deep compare CCTP burn calldata: Arc→Base vs Base→Arc vs swap execute.
 * Run: node scripts/compare-bridge-calldata.mjs
 */
import { parseUnits, keccak256, toBytes, decodeFunctionData } from "viem";

const DUMMY = "0x1111111111111111111111111111111111111111";

async function makeCtx(fromAppKit) {
  const adapterMod = await import("@circle-fin/adapter-viem-v2");
  const providerMod = await import("@circle-fin/provider-cctp-v2");
  const resolve = adapterMod.resolveChainIdentifier;
  const sourceDef = resolve(fromAppKit);
  const rpc = sourceDef.rpcEndpoints[0];
  const chainIdHex = "0x" + sourceDef.chainId.toString(16);
  const provider = {
    on: () => {},
    removeListener: () => {},
    request: async (a) => {
      if (["eth_accounts", "eth_requestAccounts"].includes(a.method))
        return [DUMMY];
      if (a.method === "eth_chainId") return chainIdHex;
      if (a.method === "wallet_getCapabilities") return {};
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: a.method,
          params: a.params ?? [],
        }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    },
  };
  const factory =
    adapterMod.createViemAdapterFromProvider ??
    adapterMod.createAdapterFromProvider;
  const adapter = await factory({ provider });
  const cctp = new providerMod.CCTPV2BridgingProvider();
  return { sourceDef, adapter, cctp, chainIdHex, rpc };
}

async function bridgePlan(from, to, opts = {}) {
  const { sourceDef, adapter, cctp } = await makeCtx(from);
  const destDef = (await import("@circle-fin/adapter-viem-v2")).resolveChainIdentifier(
    to,
  );
  const amountMinor = parseUnits("25", 6).toString();
  const source = { chain: sourceDef, adapter, address: DUMMY };
  const destination = {
    chain: destDef,
    adapter,
    address: DUMMY,
    ...(opts.useForwarder !== false ? { useForwarder: true } : {}),
  };
  const config = {
    transferSpeed: "FAST",
    ...(opts.customFee
      ? {
          customFee: {
            value: parseUnits("0.01", 6).toString(),
            recipientAddress:
              "0xfa7356ee40fec13c748e190dc857c11c67c9ab6d",
          },
        }
      : {}),
  };
  const ap = await cctp.approve(source, amountMinor);
  const burn = await cctp.burn({
    source,
    destination,
    amount: amountMinor,
    token: "USDC",
    config,
  });
  const a = ap.getCallData();
  const b = burn.getCallData();
  return { approve: a, burn: b, from, to, opts };
}

function summarize(label, plan) {
  const b = plan.burn;
  return {
    label,
    approveTo: plan.approve.to,
    approveSel: plan.approve.data.slice(0, 10),
    approveLen: plan.approve.data.length,
    burnTo: b.to,
    burnSel: b.data.slice(0, 10),
    burnLen: b.data.length,
    burnTail: b.data.slice(-64),
  };
}

const routes = [
  ["Arc", "Base", { useForwarder: true, customFee: false }],
  ["Base", "Arc", { useForwarder: true, customFee: false }],
  ["Base", "Arc", { useForwarder: false, customFee: false }],
  ["Ethereum", "Arc", { useForwarder: true, customFee: false }],
  ["Base", "Arc", { useForwarder: true, customFee: true }],
];

console.log("=== Bridge route summary ===\n");
for (const [from, to, opts] of routes) {
  const p = await bridgePlan(from, to, opts);
  console.log(JSON.stringify(summarize(`${from}→${to} ${JSON.stringify(opts)}`, p), null, 2));
}

// Swap execute on Arc for comparison
const adapterMod = await import("@circle-fin/adapter-viem-v2");
const { buildSwapPlan } = await import("../app/lib/google-swap.ts").catch(
  () => ({ buildSwapPlan: null }),
);

console.log("\n=== Function selector lookup (common) ===");
const sigs = [
  "bridgeWithPreapprovalAndHook((uint256,uint256,uint256,bytes32,bytes32,uint256,uint256,bytes32,bytes),bytes)",
  "depositForBurnWithHook(uint256,uint32,bytes32,bytes32,bytes32,uint256,bytes)",
  "depositForBurn(uint256,uint32,bytes32,bytes32)",
  "execute((address,address,bytes,bytes,bytes))",
];
for (const s of sigs) {
  console.log(s.split("(")[0], keccak256(toBytes(s)).slice(0, 10));
}
