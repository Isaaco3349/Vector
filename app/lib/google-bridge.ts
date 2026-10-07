"use client";

/**
 * Google-wallet (Circle user-controlled / W3S) BRIDGE encoder.
 *
 * ── WHY THIS FILE IS DIFFERENT FROM app/lib/bridge.ts ─────────────────────────
 * app/lib/bridge.ts drives an EXTERNAL wallet: it hands App Kit a live provider
 * and App Kit signs + broadcasts every step itself. A Google-login wallet has NO
 * provider to sign with — it can only move funds through Circle's challenge flow
 * (server creates the tx over REST → challengeId → browser PIN → Circle signs).
 *
 * So here we use Circle's CCTP v2 provider purely as an OFFLINE ENCODER: we call
 * its own `approve()` and `burn()` to get the exact `{to, data, value}` for each
 * step, then the panel routes that calldata through the verified
 * `createContractExecutionChallenge` server action. We NEVER execute here.
 *
 * ── NOTHING IS HAND-ENCODED (the money-safety guarantee) ──────────────────────
 * Every safety-critical byte is produced by Circle's installed SDK, not by us:
 *   • approve() target + selector + delegate  ← provider.approve().getCallData()
 *   • burn()   target + selector + args       ← provider.burn().getCallData()
 *   • the bridge/token addresses, mintRecipient(bytes32), maxFee, finality,
 *     and forwarder hookData are all computed inside Circle's code.
 * We supply only inputs (chain ids, amount, recipient) and read back calldata.
 *
 * ── VERIFIED AGAINST INSTALLED SOURCE ─────────────────────────────────────────
 * node_modules/@circle-fin/provider-cctp-v2@1.10.2/index.cjs:
 *   • approve(source, amount) @14278 → prepareAction('usdc.increaseAllowance',
 *       {amount, delegate: resolveCCTPV2ContractAddress(chain,'tokenMessenger'),
 *        chain}) → getCallData().to = USDC token, delegate = Arc bridge 0xC556…
 *   • burn({source,destination,amount,config}) @14703 → on Arc,
 *       hasCustomContractSupport(chain,'bridge') is true and useForwarder→
 *       prepareAction('cctp.v2.customBurnWithHook',…) → getCallData().to = bridge.
 *       Reads params.config.customFee WITHOUT optional chaining (@14727), so
 *       `config` MUST be a present object. maxFee is fetched LIVE (getMaxFee
 *       @14628 hits Circle's fee API) — correct in the browser; we do NOT pass a
 *       dummy maxFee, so the real on-chain fee is used.
 *   • Circle's own executeBatchedApproveAndBurn (@12951) approves
 *       amount + customFee and reads both getCallData()s — we mirror that exactly.
 * node_modules/@circle-fin/app-kit/chains.d.mts (ArcTestnet @112):
 *   • usdcAddress 0x3600…0000, kitContracts.bridge 0xC5567a5E…363d,
 *     cctp.forwarderSupported {source:false, destination:true}, chainId 5042002,
 *     rpcEndpoints[0] "https://rpc.testnet.arc.network/".
 * node_modules/@circle-fin/adapter-viem-v2@1.15.0: exports
 *   resolveChainIdentifier(id) → ChainDefinition, and a provider-adapter factory
 *   (createViemAdapterFromProvider).
 *
 * ── DECIMALS ──────────────────────────────────────────────────────────────────
 * CCTP amounts are USDC MINOR units at 6 decimals (Arc's nativeCurrency.decimals
 * 18 is gas-only). We use viem parseUnits(amount, 6) for both approve and burn.
 *
 * ── FORWARDER / ARC ORIGIN ────────────────────────────────────────────────────
 * Arc is forwarderSupported.source:false but destination:true on the other side.
 * Circle's assertForwarderRouteSupport only checks the DESTINATION, so
 * useForwarder:true from Arc passes — and it's the ONLY model compatible with an
 * Arc-scoped wallet: the W3S wallet signs just the burn on Arc, and Circle's
 * relayer performs the mint on the destination (no chain switch, no second
 * signer). Whether Circle's relayer honors an Arc-origin forwarded burn, and
 * whether Arc's 0x3600 predeploy implements approve/transferFrom for the bridge,
 * are on-chain facts that can only be confirmed by a small live testnet bridge.
 */

import { parseUnits } from "viem";
import {
  arcBridgeChainId,
  bridgeChainById,
  type BridgeChainId,
} from "./bridge-chains";
import {
  chainIdHex as ARC_CHAIN_ID_HEX,
  displayName as ARC_DISPLAY_NAME,
  rpcUrl as ARC_RPC_FALLBACK,
} from "./network";
import {
  bridgeCustomFeeBaseForCctpBurn,
  bridgePlatformFeeBaseUnits,
} from "./fees";

/** A single contract call for the W3S contractExecution challenge. */
export type BridgeCall = {
  /** Target contract address (msg.to). From Circle's getCallData().to. */
  to: string;
  /** ABI-encoded calldata hex. From Circle's getCallData().data. */
  data: string;
  /** Native msg.value as a decimal string. "0" for approve + burn (non-payable). */
  value: string;
};

/**
 * A fully-encoded bridge plan: run `approve` first (contractExecution challenge),
 * then `burn`. Both calls carry Circle-produced calldata verbatim.
 */
export type BridgePlan = {
  approve: BridgeCall;
  burn: BridgeCall;
  /** USDC minor units Circle approves (amount + platform fee). */
  approvalAmountMinor: string;
  /** Human amount echoed back for display, and its 6-decimal minor-unit form. */
  amount: string;
  amountMinor: string;
  /** Always true for this path (Arc-origin, relayer mint on destination). */
  useForwarder: true;
  /** The destination chain id, for the panel's success/explorer messaging. */
  toChain: BridgeChainId;
};

export type BuildBridgePlanArgs = {
  /** The W3S wallet's EVM address (source + default mint recipient). */
  walletAddress: string;
  /** Source chain (defaults to Arc — the Google wallet path). */
  fromChain?: BridgeChainId;
  /** Destination chain. Source is always Arc for the Google wallet. */
  toChain: BridgeChainId;
  /** Human-readable USDC amount, e.g. "1.5". Converted to 6-decimal minor units. */
  amount: string;
  /**
   * Optional explicit recipient on the destination chain. Defaults to the same
   * wallet address (self-bridge) when omitted — the common case.
   */
  recipientAddress?: string;
  /**
   * ERC-20 `approve` (0x095ea7b3) instead of Circle's USDC `increaseAllowance`
   * on the source chain. OKX accepts this on swap/earn; inbound bridges from
   * Base/Ethereum should use it (Arc-native outbound keeps increaseAllowance).
   */
  usdcApprovalStyle?: "increaseAllowance" | "erc20Approve";
  /** Drop Vector customFee from CCTP burn calldata (smaller / fewer OKX flags). */
  omitPlatformFee?: boolean;
};

/** USDC is 6 decimals for CCTP everywhere (Arc's native 18 is gas-only). */
const USDC_DECIMALS = 6;

/**
 * Minimal read-only EIP-1193 provider for the W3S wallet.
 *
 * The Circle viem adapter expects a provider so it can (a) learn the wallet
 * address via eth_accounts and (b) read chain state. A W3S wallet exposes no
 * such provider, so we synthesise the smallest honest one:
 *   • identity/chain methods answered locally from the known address + Arc id;
 *   • all other READS forwarded to Arc's public RPC (from the SDK chain def);
 *   • every SIGN / SEND method THROWS. We only ever call getCallData(), never
 *     execute — if the adapter ever tried to broadcast, we want a loud failure,
 *     not a silent unexpected signature request.
 */
function createReadOnlyArcProvider(params: {
  address: string;
  chainIdHex: string;
  rpcUrl: string;
}) {
  const { address, chainIdHex, rpcUrl } = params;
  let nextId = 1;

  return {
    // Some adapter wrappers subscribe to provider events; no-ops are safe here
    // because this provider's state never changes (fixed address + Arc chain).
    on: () => {},
    removeListener: () => {},
    request: async (args: { method: string; params?: unknown[] }) => {
      const { method } = args;
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return [address];
        case "eth_chainId":
          return chainIdHex;
        case "net_version":
          return String(parseInt(chainIdHex, 16));
        // No EIP-5792 batch capabilities — we encode calldata, never execute,
        // so report none rather than forwarding this probe to a JSON-RPC that
        // doesn't implement it.
        case "wallet_getCapabilities":
          return {};
        // Methods that would move funds or produce a signature must never be
        // reachable on this path — we encode calldata only.
        case "eth_sendTransaction":
        case "eth_sendRawTransaction":
        case "eth_sign":
        case "personal_sign":
        case "eth_signTransaction":
        case "eth_signTypedData":
        case "eth_signTypedData_v3":
        case "eth_signTypedData_v4":
        case "wallet_sendCalls":
        case "wallet_addEthereumChain":
        case "wallet_switchEthereumChain":
          throw new Error(
            `google-bridge read-only provider: refusing "${method}" — this ` +
              "wallet signs only through Circle's challenge flow, not a provider.",
          );
        default: {
          // Forward any other JSON-RPC read (eth_call, eth_getBalance, …) to
          // Arc's public RPC so the adapter can resolve chain state honestly.
          const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: nextId++,
              method,
              params: args.params ?? [],
            }),
          });
          const json = await res.json();
          if (json?.error) {
            throw new Error(
              typeof json.error?.message === "string"
                ? json.error.message
                : `RPC error for ${method}`,
            );
          }
          return json?.result;
        }
      }
    },
  };
}

/** Resolve the viem provider-adapter factory across SDK export-name drift. */
function resolveProviderAdapterFactory(
  mod: Record<string, unknown>,
): (arg: { provider: unknown }) => unknown | Promise<unknown> {
  const candidates = [
    "createViemAdapterFromProvider",
    "createAdapterFromProvider",
  ];
  for (const name of candidates) {
    const fn = mod[name];
    if (typeof fn === "function") {
      return fn as (arg: { provider: unknown }) => unknown | Promise<unknown>;
    }
  }
  throw new Error(
    "Circle viem adapter: no provider-adapter factory found (looked for " +
      `${candidates.join(", ")}). Check your @circle-fin/adapter-viem-v2 version.`,
  );
}

/** Pull {to,data,value} out of a prepared request's getCallData(), normalising value→"0". */
function readCallData(prepared: unknown, label: string): BridgeCall {
  if (
    !prepared ||
    typeof prepared !== "object" ||
    typeof (prepared as { getCallData?: unknown }).getCallData !== "function"
  ) {
    throw new Error(
      `Circle CCTP ${label}: prepared request has no getCallData() — can't ` +
        "encode this call safely, so nothing will be sent.",
    );
  }
  const cd = (prepared as { getCallData: () => unknown }).getCallData();
  const rec =
    cd && typeof cd === "object" ? (cd as Record<string, unknown>) : null;
  const to = typeof rec?.to === "string" ? rec.to : null;
  const data = typeof rec?.data === "string" ? rec.data : null;
  if (!to || !data) {
    throw new Error(
      `Circle CCTP ${label}: getCallData() returned no {to,data} — refusing to ` +
        "build an incomplete transaction.",
    );
  }
  // approve + burn are non-payable, so value is undefined; contractExecution
  // wants a decimal string. Preserve any real value verbatim if ever present.
  const rawValue = rec?.value;
  const value =
    typeof rawValue === "bigint"
      ? rawValue.toString()
      : typeof rawValue === "number"
        ? String(rawValue)
        : typeof rawValue === "string" && rawValue.length > 0
          ? // getCallData may hand back hex ("0x..") or decimal; contractExecution
            // expects decimal minor units. Convert hex defensively.
            rawValue.startsWith("0x")
            ? BigInt(rawValue).toString()
            : rawValue
          : "0";

  return { to, data, value };
}

function kitBridgeSpender(sourceDef: Record<string, unknown>): string {
  const kit =
    sourceDef.kitContracts && typeof sourceDef.kitContracts === "object"
      ? (sourceDef.kitContracts as { bridge?: string })
      : null;
  const bridge = kit?.bridge;
  if (typeof bridge !== "string" || !bridge.startsWith("0x")) {
    throw new Error(
      "Circle kit bridge contract is not configured on the source chain.",
    );
  }
  return bridge;
}

/**
 * Build the two-call bridge plan (approve → burn) for the Google wallet, using
 * Circle's own CCTP v2 encoder. Loaded via dynamic import so these packages only
 * enter the bundle when a user actually opens Bridge.
 */
export async function buildBridgePlan(
  args: BuildBridgePlanArgs,
): Promise<BridgePlan> {
  const fromChain = args.fromChain ?? arcBridgeChainId();
  const from = bridgeChainById(fromChain);
  const to = bridgeChainById(args.toChain);
  if (!from) throw new Error(`Bridge source chain is not configured.`);
  if (!to) throw new Error(`Unsupported destination chain: ${args.toChain}`);
  if (to.appKitChain === from.appKitChain) {
    throw new Error("Pick a destination chain other than Arc.");
  }
  if (to.forwarderDestination !== true) {
    // Our whole Google-wallet model relies on the relayer minting on the
    // destination. If a destination ever lacked forwarder support, a W3S wallet
    // couldn't complete the mint — so we stop rather than half-bridge funds.
    throw new Error(
      `${to.label} can't be a forwarded bridge destination, so a Google ` +
        "wallet can't complete this route. No funds moved.",
    );
  }

  const amountTrimmed = args.amount.trim();
  const amountMinorBig = parseUnits(amountTrimmed, USDC_DECIMALS);
  if (amountMinorBig <= BigInt(0)) {
    throw new Error("Enter an amount greater than zero.");
  }
  const amountMinor = amountMinorBig.toString();

  const recipient = (args.recipientAddress ?? args.walletAddress).trim();

  // Dynamic imports — mirrors app/lib/bridge.ts and appkit.ts.
  const adapterMod = (await import("@circle-fin/adapter-viem-v2")) as Record<
    string,
    unknown
  >;
  const providerMod = (await import(
    "@circle-fin/provider-cctp-v2"
  )) as Record<string, unknown>;

  const resolveChainIdentifier = adapterMod.resolveChainIdentifier as (
    id: string,
  ) => unknown;
  if (typeof resolveChainIdentifier !== "function") {
    throw new Error(
      "@circle-fin/adapter-viem-v2 did not export resolveChainIdentifier.",
    );
  }

  // Resolve the SDK's own chain DEFINITIONS (objects, not strings). approve()
  // computes the spender from source.chain before resolving, so it must be the
  // resolved def — passing the string id would break address resolution.
  // Use Circle's kit bridge contract on the source chain whenever the SDK
  // exposes it — same `0xB3FA…` + burn selector as Arc→outbound, which OKX accepts.
  // Routing inbound-to-Arc burns through TokenMessenger (0x779b432d) was rejected
  // by OKX as a risky signature; do not strip kitContracts.bridge for those routes.
  const sourceDef = resolveChainIdentifier(from.appKitChain) as Record<
    string,
    unknown
  >;
  const destDef = resolveChainIdentifier(to.appKitChain) as Record<
    string,
    unknown
  >;

  // Arc RPC + chain id straight from the resolved def (no hardcoding).
  const rpcList = (sourceDef as { rpcEndpoints?: unknown }).rpcEndpoints;
  const rpcUrl =
    Array.isArray(rpcList) && typeof rpcList[0] === "string"
      ? (rpcList[0] as string)
      : ARC_RPC_FALLBACK;
  const numericChainId = (sourceDef as { chainId?: unknown }).chainId;
  const chainIdHex =
    typeof numericChainId === "number"
      ? "0x" + numericChainId.toString(16)
      : ARC_CHAIN_ID_HEX;

  const provider = createReadOnlyArcProvider({
    address: args.walletAddress,
    chainIdHex,
    rpcUrl,
  });

  const makeAdapter = resolveProviderAdapterFactory(adapterMod);
  const adapter = await makeAdapter({ provider });

  const CCTPProvider = providerMod.CCTPV2BridgingProvider as
    | (new () => {
        approve: (source: unknown, amount: string) => Promise<unknown>;
        burn: (params: unknown) => Promise<unknown>;
      })
    | undefined;
  if (typeof CCTPProvider !== "function") {
    throw new Error(
      "@circle-fin/provider-cctp-v2 did not export CCTPV2BridgingProvider.",
    );
  }
  const cctp = new CCTPProvider();

  // The wallet context Circle's approve/burn expect: resolved chain def, our
  // read-only adapter, and the wallet address.
  const source = { chain: sourceDef, adapter, address: args.walletAddress };
  const destination = {
    chain: destDef,
    adapter,
    address: recipient,
    useForwarder: true as const,
  };

  // config MUST be a present object (burn reads params.config.customFee without
  // optional chaining). We set FAST and OMIT maxFee, so Circle fetches the true
  // fee live in the browser — we don't fake a fee.
  const platformFeeMinor = args.omitPlatformFee
    ? BigInt(0)
    : bridgePlatformFeeBaseUnits(amountTrimmed);
  const config = {
    transferSpeed: "FAST" as const,
    ...(args.omitPlatformFee
      ? {}
      : bridgeCustomFeeBaseForCctpBurn(amountTrimmed)),
  };
  const approvalAmount = (amountMinorBig + platformFeeMinor).toString();

  const useErc20Approve = args.usdcApprovalStyle !== "increaseAllowance";

  // 1) APPROVE — Arc native USDC uses Circle increaseAllowance (outbound OKX path).
  //    Other chains: standard ERC-20 approve to kit bridge (matches OKX swap/earn).
  let approve: BridgeCall;
  if (useErc20Approve) {
    if (!from.usdcAddress) {
      throw new Error(`USDC address missing for ${from.label}.`);
    }
    const adapterWithPrepare = adapter as {
      prepareAction: (
        action: string,
        params: unknown,
        ctx: unknown,
      ) => Promise<unknown>;
    };
    if (typeof adapterWithPrepare.prepareAction !== "function") {
      throw new Error(
        "Circle viem adapter has no prepareAction() — can't encode ERC-20 approve.",
      );
    }
    const approvePrepared = await adapterWithPrepare.prepareAction(
      "token.approve",
      {
        tokenAddress: from.usdcAddress,
        delegate: kitBridgeSpender(sourceDef),
        amount: BigInt(approvalAmount),
      },
      { chain: sourceDef },
    );
    approve = readCallData(approvePrepared, "approve");
  } else {
    const approvePrepared = await cctp.approve(source, approvalAmount);
    approve = readCallData(approvePrepared, "approve");
  }

  // 2) BURN (Arc → destination, forwarded). Target resolves to the Arc bridge;
  //    mintRecipient(bytes32), maxFee, finality + forwarder hookData all computed
  //    inside burn().
  const burnPrepared = await cctp.burn({
    source,
    destination,
    amount: amountMinor,
    token: "USDC",
    config,
  });
  const burn = readCallData(burnPrepared, "burn");

  return {
    approve,
    burn,
    approvalAmountMinor: approvalAmount,
    amount: amountTrimmed,
    amountMinor,
    useForwarder: true,
    toChain: args.toChain,
  };
}
