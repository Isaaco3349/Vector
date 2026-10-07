/**
 * Offline: compare burn calldata Arc→Base vs Base→Arc (inbound Arc fix).
 * Run: node scripts/debug-bridge-plan.mjs
 */
import { parseUnits } from "viem";

const USDC_DECIMALS = 6;
const DUMMY = "0x1111111111111111111111111111111111111111";

/** Legacy (removed): stripping kit bridge forced TokenMessenger 0x779b432d — OKX rejects. */
function sourceChainDefForInboundArc(sourceDef) {
  return sourceDef;
}

function selector(data) {
  return typeof data === "string" && data.length >= 10 ? data.slice(0, 10) : "?";
}

async function planFor(fromAppKit, toAppKit, amount = "10") {
  const adapterMod = await import("@circle-fin/adapter-viem-v2");
  const providerMod = await import("@circle-fin/provider-cctp-v2");
  const resolveChainIdentifier = adapterMod.resolveChainIdentifier;
  const sourceDefRaw = resolveChainIdentifier(fromAppKit);
  const destDef = resolveChainIdentifier(toAppKit);
  const sourceDef = sourceChainDefForInboundArc(sourceDefRaw);

  const rpcList = sourceDef?.rpcEndpoints;
  const rpcUrl = Array.isArray(rpcList) ? rpcList[0] : "https://rpc.testnet.arc.network/";
  const chainIdHex =
    "0x" + Number(sourceDef.chainId).toString(16);

  const provider = {
    on: () => {},
    removeListener: () => {},
    request: async (args) => {
      const { method } = args;
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return [DUMMY];
      if (method === "eth_chainId") return chainIdHex;
      if (method === "net_version") return String(parseInt(chainIdHex, 16));
      if (method === "wallet_getCapabilities") return {};
      if (
        [
          "eth_sendTransaction",
          "eth_signTypedData_v4",
          "wallet_sendCalls",
        ].includes(method)
      ) {
        throw new Error("read-only");
      }
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: args.params ?? [],
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.result;
    },
  };

  const factory =
    adapterMod.createViemAdapterFromProvider ??
    adapterMod.createAdapterFromProvider;
  const adapter = await factory({ provider });
  const cctp = new providerMod.CCTPV2BridgingProvider();

  const amountMinor = parseUnits(amount, USDC_DECIMALS).toString();
  const source = { chain: sourceDef, adapter, address: DUMMY };
  const destination = {
    chain: destDef,
    adapter,
    address: DUMMY,
    useForwarder: true,
  };
  const config = { transferSpeed: "FAST" };

  const approvePrepared = await cctp.approve(source, amountMinor);
  const burnPrepared = await cctp.burn({
    source,
    destination,
    amount: amountMinor,
    token: "USDC",
    config,
  });
  const approve = approvePrepared.getCallData();
  const burn = burnPrepared.getCallData();
  return {
    fromAppKit,
    toAppKit,
    sourceKitBridge: sourceDefRaw?.kitContracts?.bridge ?? null,
    strippedBridge: sourceDef?.kitContracts?.bridge ?? null,
    approve: { to: approve.to, sel: selector(approve.data) },
    burn: { to: burn.to, sel: selector(burn.data) },
  };
}

const routes = [
  ["Arc", "Base"],
  ["Base", "Arc"],
  ["Ethereum", "Arc"],
  ["Arc", "Ethereum"],
];

console.log("Bridge plan calldata (mainnet ids, no Vector customFee)\n");
for (const [from, to] of routes) {
  try {
    const p = await planFor(from, to);
    console.log(JSON.stringify(p, null, 2));
  } catch (e) {
    console.log({ from, to, error: e.message });
  }
}
