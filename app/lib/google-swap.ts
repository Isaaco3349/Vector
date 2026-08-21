"use client";

/**
 * Google-wallet (Circle user-controlled / W3S) SWAP encoder.
 *
 * ── WHY THIS FILE IS DIFFERENT FROM app/lib/appkit.ts ─────────────────────────
 * appkit.ts drives an EXTERNAL wallet: it hands App Kit a live provider and App
 * Kit's `.swap()` signs + broadcasts the whole swap itself. A Google-login wallet
 * has NO provider to sign with — it can only move funds through Circle's
 * challenge flow (server creates the tx over REST → challengeId → browser PIN →
 * Circle signs + broadcasts).
 *
 * The swap provider gives us no non-executing primitive to reuse (its `.approve()`
 * is private, `.swap()` executes end-to-end, `.estimate()` is quote-only). So we
 * reproduce the three moving pieces of a stablecoin swap, but every money-critical
 * byte is still produced by Circle's OWN installed SDK — nothing is hand-encoded:
 *   1. createSwap SERVICE call  → Circle returns the Adapter-Contract
 *      `executionParams` + a Circle proxy-signed EIP-712 `signature`. (Server
 *      proxy: app/api/endpoints action "createSwapTransaction".)
 *   2. APPROVE calldata          ← adapter.prepareAction('usdc.increaseAllowance'
 *      | 'token.approve', …).getCallData()
 *   3. EXECUTE calldata          ← adapter.prepareAction('swap.execute', …).getCallData()
 * The panel then routes (2) and (3) through the verified
 * createContractExecutionChallenge flow (PIN #1, PIN #2). We NEVER execute here.
 *
 * ── W3S-COMPATIBLE (no user off-chain signature) ──────────────────────────────
 * Our read-only Arc adapter has no signTypedData, so the only viable token-input
 * is the pre-approval PermitType.NONE path (an on-chain approve + a literal
 * fallback token input). The `signature` in executeParams is Circle's proxy
 * attestation (verified on-chain by the Adapter Contract), NOT a user signature.
 *
 * ── VERIFIED AGAINST INSTALLED SOURCE (2026-08-20) ────────────────────────────
 * provider-stablecoin-service-swap@1.4.1/index.cjs:
 *   • createSwap request body (createSwapRequestBaseSchema @10205):
 *     {tokenInAddress, tokenInChain, tokenOutAddress, tokenOutChain?, fromAddress,
 *      toAddress, amount(base-units string), slippageBps?}. tokenInChain/
 *      tokenOutChain = chain.chain = the Blockchain enum "Arc_Testnet" (underscore)
 *      — NOT chain.name 'Arc Testnet' (@12283). amount is base units (@9712 /^\d+$/).
 *   • response transaction (@10375): {signature, executionParams:{execId, deadline,
 *      metadata, tokens:[{token,beneficiary}], instructions:[{target, data, value,
 *      tokenIn, amountToApprove, tokenOut, minTokenOut}]}}.
 *   • prepareEvmSwapAction transform (@13329) copied verbatim: value/amountToApprove/
 *      minTokenOut/execId/deadline → BigInt; metadata passthrough; inputAmount =
 *      BigInt(response.amount); tokenInAddress = response.tokenInAddress (echoed).
 *   • createFallbackTokenInput (@13081): {permitType: PermitType.NONE(0), token,
 *      amount, permitCalldata:'0x'}.
 * adapter-viem-v2@1.15.0/index.cjs:
 *   • prepareAction(action, params, ctx) resolves address itself for user-controlled
 *      adapters via adapter.getAddress() (@6594) — so ctx = {chain: def}, NO address
 *      (address is forbidden for user-controlled adapters).
 *   • 'usdc.increaseAllowance' (@17626) → increaseAllowance(delegate, amount) on
 *      chain.usdcAddress. 'token.approve' (@17518) → ERC-20 approve(delegate, amount)
 *      on tokenAddress; REQUIRES amount to be a bigint (throws otherwise).
 *   • 'swap.execute' (@17251) → adapter contract chain.kitContracts.adapter,
 *      execute(executeParams, tokenInputs, signature); value = Σ instruction.value
 *      (0 for non-native USDC↔cirBTC — NATIVE_TOKEN 0xEeee… ≠ Arc USDC 0x3600).
 *   • Arc def (@2389): usdcAddress 0x3600…, eurcAddress 0x89B5…D72a,
 *      kitContracts.adapter 0xBBD70b01… (@2331), chainId 5042002,
 *      rpcEndpoints[0] "https://rpc.testnet.arc.network/". ALL read from the def,
 *      nothing hardcoded here.
 *
 * ── DECIMALS ──────────────────────────────────────────────────────────────────
 * Arc USDC is a 6-decimal ERC-20; EURC is 6-decimal; cirBTC is 8-decimal (Arc's
 * native 18 is gas-only). Amounts are therefore scaled PER TOKEN — parseUnits by
 * the INPUT token's decimals, formatUnits the estimate by the OUTPUT token's
 * decimals — never a single shared constant. Values are copied verbatim from
 * Circle's SDK token registry (its docs state CIRBTC.decimals = 8, EURC.decimals = 6).
 *
 * ── ON-CHAIN RISK ─────────────────────────────────────────────────────────────
 * The approve step is already live-proven (the bridge used usdc.increaseAllowance
 * on Arc's 0x3600 predeploy 2026-08-20). The one new unproven piece is
 * swap.execute against Arc adapter 0xBBD7… + whether Circle's swap SERVICE
 * actually routes Arc-Testnet USDC↔cirBTC — the same risk the external Swap
 * carries. A missing route returns "no route" (no funds move); confirm the happy
 * path with a small live swap on the deployed app.
 */

import { formatUnits, parseUnits } from "viem";

/** The Arc-Testnet swap tokens: USDC (6d), cirBTC (8d), EURC (6d). */
export type SwapSymbol = "USDC" | "cirBTC" | "EURC";

/** A single contract call for the W3S contractExecution challenge. */
export type SwapCall = {
  /** Target contract address (msg.to). From Circle's getCallData().to. */
  to: string;
  /** ABI-encoded calldata hex. From Circle's getCallData().data. */
  data: string;
  /** Native msg.value as a decimal string. "0" for USDC↔cirBTC (no native value sent). */
  value: string;
};

/**
 * A fully-encoded swap plan: run `approve` first (contractExecution challenge),
 * then `execute`. Both calls carry Circle-produced calldata verbatim.
 */
export type SwapPlan = {
  approve: SwapCall;
  execute: SwapCall;
  /** Human input amount echoed for display, and its minor-unit form (input token decimals). */
  amount: string;
  amountMinor: string;
  /** Best-effort human estimated output (scaled by the output token's decimals), or null. */
  estimatedAmount: string | null;
  fromSymbol: SwapSymbol;
  toSymbol: SwapSymbol;
};

export type BuildSwapPlanArgs = {
  /** The W3S wallet's EVM address (from + to for a self-swap). */
  walletAddress: string;
  /** Input token symbol. */
  fromSymbol: SwapSymbol;
  /** Output token symbol. Must differ from fromSymbol. */
  toSymbol: SwapSymbol;
  /** Human-readable input amount, e.g. "1.5". Converted to the input token's minor units. */
  amount: string;
  /** Optional slippage in basis points; omitted → Circle's service default. */
  slippageBps?: number;
};

/** The Google wallet only ever swaps on Arc. Blockchain enum value (underscore). */
const ARC_CHAIN_ENUM = "Arc_Testnet";

/**
 * Per-symbol decimals on Arc Testnet, copied verbatim from Circle's SDK token
 * registry (USDC = 6; cirBTC = 8; EURC = 6 — the SDK's token defs state
 * CIRBTC.decimals = 8 and EURC.decimals = 6). Amounts are scaled by the RELEVANT
 * token's decimals (input for the amount, output for the estimate); this is
 * deliberately NOT one shared constant, since a wrong scale would mis-size a
 * real transfer.
 */
const TOKEN_DECIMALS: Record<SwapSymbol, number> = { USDC: 6, cirBTC: 8, EURC: 6 };

/**
 * cirBTC's Arc address. It lives ONLY in the SDK token registry (the Arc chain
 * def has no cirBTC field), so it's pinned here from the SDK's documented value —
 * CIRBTC.locators[Blockchain.Arc_Testnet] — verified in both the swap-kit and
 * app-kit bundles. USDC's address is still read from the resolved chain def.
 */
const CIRBTC_ARC_ADDRESS = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";

/**
 * Minimal read-only EIP-1193 provider for the W3S wallet — identical intent to
 * the one in google-bridge.ts. The Circle viem adapter needs a provider to learn
 * the wallet address (eth_accounts) and read chain state; a W3S wallet exposes
 * none, so we synthesise the smallest honest one:
 *   • identity/chain methods answered locally;
 *   • other READS forwarded to Arc's public RPC;
 *   • every SIGN / SEND method THROWS. We only ever call getCallData(), never
 *     execute — a stray broadcast attempt should fail loudly, not sign silently.
 */
function createReadOnlyArcProvider(params: {
  address: string;
  chainIdHex: string;
  rpcUrl: string;
}) {
  const { address, chainIdHex, rpcUrl } = params;
  let nextId = 1;

  return {
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
        case "wallet_getCapabilities":
          return {};
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
            `google-swap read-only provider: refusing "${method}" — this ` +
              "wallet signs only through Circle's challenge flow, not a provider.",
          );
        default: {
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
function readCallData(prepared: unknown, label: string): SwapCall {
  if (
    !prepared ||
    typeof prepared !== "object" ||
    typeof (prepared as { getCallData?: unknown }).getCallData !== "function"
  ) {
    throw new Error(
      `Circle swap ${label}: prepared request has no getCallData() — can't ` +
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
      `Circle swap ${label}: getCallData() returned no {to,data} — refusing to ` +
        "build an incomplete transaction.",
    );
  }
  const rawValue = rec?.value;
  const value =
    typeof rawValue === "bigint"
      ? rawValue.toString()
      : typeof rawValue === "number"
        ? String(rawValue)
        : typeof rawValue === "string" && rawValue.length > 0
          ? rawValue.startsWith("0x")
            ? BigInt(rawValue).toString()
            : rawValue
          : "0";

  return { to, data, value };
}

/** Read a required string field off an unknown object, or throw. */
function requireString(
  obj: Record<string, unknown> | null,
  key: string,
  label: string,
): string {
  const v = obj?.[key];
  if (typeof v === "string" && v.length > 0) return v;
  throw new Error(
    `Circle swap response is missing "${label}". No funds moved — please try again.`,
  );
}

/**
 * The verbatim shape of the createSwap response's `transaction.executionParams`
 * (all numeric fields arrive as base-10 strings; we convert to bigint exactly as
 * the provider's prepareEvmSwapAction does).
 */
type ServiceInstruction = {
  target: string;
  data: string;
  value: string;
  tokenIn: string;
  amountToApprove: string;
  tokenOut: string;
  minTokenOut: string;
};

/**
 * Build the two-call swap plan (approve → execute) for the Google wallet.
 *
 * Flow: (1) POST our createSwapTransaction proxy to get Circle's executionParams
 * + proxy signature; (2) transform it verbatim into adapter params; (3) encode
 * approve + execute calldata with Circle's OWN adapter. Loaded via dynamic import
 * so these packages only enter the bundle when a user actually opens Swap.
 */
export async function buildSwapPlan(args: BuildSwapPlanArgs): Promise<SwapPlan> {
  const { walletAddress, fromSymbol, toSymbol } = args;
  if (fromSymbol === toSymbol) {
    throw new Error("Pick two different tokens to swap.");
  }

  const amountTrimmed = args.amount.trim();
  const amountMinorBig = parseUnits(amountTrimmed, TOKEN_DECIMALS[fromSymbol]);
  if (amountMinorBig <= BigInt(0)) {
    throw new Error("Enter an amount greater than zero.");
  }
  const amountMinor = amountMinorBig.toString();

  // Dynamic imports — mirrors app/lib/google-bridge.ts and appkit.ts.
  const adapterMod = (await import("@circle-fin/adapter-viem-v2")) as Record<
    string,
    unknown
  >;

  const resolveChainIdentifier = adapterMod.resolveChainIdentifier as (
    id: string,
  ) => unknown;
  if (typeof resolveChainIdentifier !== "function") {
    throw new Error(
      "@circle-fin/adapter-viem-v2 did not export resolveChainIdentifier.",
    );
  }

  // Resolve Arc's own chain DEFINITION (object, not string). Every
  // money-critical address is read from here — nothing hardcoded in this file.
  const sourceDef = resolveChainIdentifier(ARC_CHAIN_ENUM) as Record<
    string,
    unknown
  >;

  const usdcAddress = requireString(sourceDef, "usdcAddress", "USDC address");
  const kitContracts =
    sourceDef.kitContracts && typeof sourceDef.kitContracts === "object"
      ? (sourceDef.kitContracts as Record<string, unknown>)
      : null;
  const adapterContract = requireString(
    kitContracts,
    "adapter",
    "swap adapter contract",
  );

  // EURC's address rides on the SAME resolved chain def as USDC (verified: the
  // Arc def carries `eurcAddress` in swap-kit + adapter-viem-v2). Read it
  // defensively so a USDC↔cirBTC swap never depends on it — it's only required
  // when EURC is actually one of the legs.
  const eurcAddress =
    typeof sourceDef.eurcAddress === "string" && sourceDef.eurcAddress
      ? (sourceDef.eurcAddress as string)
      : null;

  // Symbol → resolved token ADDRESS (the service takes addresses, not aliases).
  // USDC + EURC come from the resolved chain def; cirBTC from the SDK registry
  // (pinned above, since the chain def carries no cirBTC address).
  const symbolToAddress = (s: SwapSymbol): string => {
    if (s === "USDC") return usdcAddress;
    if (s === "cirBTC") return CIRBTC_ARC_ADDRESS;
    // EURC
    if (!eurcAddress) {
      throw new Error(
        "EURC isn't available on Arc right now (no address on the chain " +
          "definition). No funds moved — please try another pair.",
      );
    }
    return eurcAddress;
  };
  const tokenInAddressReq = symbolToAddress(fromSymbol);
  const tokenOutAddressReq = symbolToAddress(toSymbol);

  // Arc RPC + chain id straight from the resolved def (no hardcoding).
  const rpcList = (sourceDef as { rpcEndpoints?: unknown }).rpcEndpoints;
  const rpcUrl =
    Array.isArray(rpcList) && typeof rpcList[0] === "string"
      ? (rpcList[0] as string)
      : "https://rpc.testnet.arc.network/";
  const numericChainId = (sourceDef as { chainId?: unknown }).chainId;
  const chainIdHex =
    typeof numericChainId === "number"
      ? "0x" + numericChainId.toString(16)
      : "0x" + (5042002).toString(16);

  // 1) createSwap via our same-origin server proxy (permissionless testnet).
  //    Returns Circle's executionParams + proxy-signed signature.
  const swapResponse = await fetch("/api/endpoints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "createSwapTransaction",
      tokenInAddress: tokenInAddressReq,
      tokenInChain: ARC_CHAIN_ENUM,
      tokenOutAddress: tokenOutAddressReq,
      tokenOutChain: ARC_CHAIN_ENUM,
      fromAddress: walletAddress,
      toAddress: walletAddress,
      amount: amountMinor,
      ...(args.slippageBps != null && Number.isFinite(args.slippageBps)
        ? { slippageBps: args.slippageBps }
        : {}),
    }),
  });
  const swapData = await swapResponse.json();
  if (!swapResponse.ok) {
    throw new Error(
      swapData?.code === "TIMEOUT"
        ? "That's taking longer than expected reaching Circle. Please try again."
        : typeof swapData?.message === "string" && swapData.message
          ? swapData.message
          : typeof swapData?.error === "string" && swapData.error
            ? swapData.error
            : "Couldn't get a swap quote. This pair may have no route yet.",
    );
  }

  // 2) Transform the service response EXACTLY as provider prepareEvmSwapAction
  //    does (string → bigint via BigInt(); metadata passthrough).
  const transaction =
    swapData?.transaction && typeof swapData.transaction === "object"
      ? (swapData.transaction as Record<string, unknown>)
      : null;
  const executionParams =
    transaction?.executionParams &&
    typeof transaction.executionParams === "object"
      ? (transaction.executionParams as Record<string, unknown>)
      : null;
  const signature = requireString(transaction, "signature", "swap signature");
  if (!executionParams) {
    throw new Error(
      "Circle swap response is missing executionParams. No funds moved — please try again.",
    );
  }

  const rawInstructions = executionParams.instructions;
  const rawTokens = executionParams.tokens;
  if (!Array.isArray(rawInstructions) || !Array.isArray(rawTokens)) {
    throw new Error(
      "Circle swap response has malformed execution params. No funds moved — please try again.",
    );
  }

  const instructions = (rawInstructions as ServiceInstruction[]).map((i) => ({
    target: i.target,
    data: i.data,
    value: BigInt(i.value),
    tokenIn: i.tokenIn,
    amountToApprove: BigInt(i.amountToApprove),
    tokenOut: i.tokenOut,
    minTokenOut: BigInt(i.minTokenOut),
  }));
  const tokens = (rawTokens as { token: string; beneficiary: string }[]).map(
    (t) => ({ token: t.token, beneficiary: t.beneficiary }),
  );
  const executeParams = {
    instructions,
    tokens,
    execId: BigInt(requireString(executionParams, "execId", "execId")),
    deadline: BigInt(requireString(executionParams, "deadline", "deadline")),
    metadata: executionParams.metadata,
  };

  // Use the ECHOED input token/amount from the response, exactly like the
  // provider does (serviceResponse.tokenInAddress / serviceResponse.amount).
  const tokenInAddress = requireString(
    swapData,
    "tokenInAddress",
    "tokenInAddress",
  );
  const inputAmount = BigInt(requireString(swapData, "amount", "amount"));

  // tokenInputs — the W3S-compatible PermitType.NONE path (our read-only adapter
  // has no signTypedData, so pre-approval is the only route). Literal matches
  // createFallbackTokenInput: {permitType:0, token, amount, permitCalldata:'0x'}.
  const tokenInputs = [
    {
      permitType: 0,
      token: tokenInAddress,
      amount: inputAmount,
      permitCalldata: "0x",
    },
  ];

  // 3) Build the read-only Arc provider + Circle viem adapter (encode-only).
  const provider = createReadOnlyArcProvider({
    address: walletAddress,
    chainIdHex,
    rpcUrl,
  });
  const makeAdapter = resolveProviderAdapterFactory(adapterMod);
  const adapter = (await makeAdapter({ provider })) as {
    prepareAction: (
      action: string,
      params: unknown,
      ctx: unknown,
    ) => Promise<unknown>;
  };
  if (typeof adapter?.prepareAction !== "function") {
    throw new Error(
      "Circle viem adapter has no prepareAction() — can't encode the swap safely.",
    );
  }

  // ctx = {chain: def} with NO address: user-controlled adapters resolve the
  // address themselves via adapter.getAddress() (verified @6594); passing an
  // address is forbidden for them.
  const ctx = { chain: sourceDef };

  // APPROVE — let the Adapter Contract pull the input token. USDC uses
  // increaseAllowance (its canonical predeploy method); cirBTC uses the standard
  // ERC-20 approve. Both target the input token; delegate = adapter contract.
  // amount is a bigint (token.approve REQUIRES bigint; increaseAllowance accepts it).
  const isUsdcIn = tokenInAddress.toLowerCase() === usdcAddress.toLowerCase();
  const approvePrepared = isUsdcIn
    ? await adapter.prepareAction(
        "usdc.increaseAllowance",
        { delegate: adapterContract, amount: inputAmount },
        ctx,
      )
    : await adapter.prepareAction(
        "token.approve",
        {
          tokenAddress: tokenInAddress,
          delegate: adapterContract,
          amount: inputAmount,
        },
        ctx,
      );
  const approve = readCallData(approvePrepared, "approve");

  // EXECUTE — AdapterContract.execute(executeParams, tokenInputs, signature).
  // Target (adapter contract) and value (Σ instruction.value, 0 here) are
  // resolved inside the handler from ctx.chain — we don't set them.
  const executePrepared = await adapter.prepareAction(
    "swap.execute",
    { executeParams, tokenInputs, signature, inputAmount, tokenInAddress },
    ctx,
  );
  const execute = readCallData(executePrepared, "execute");

  // Best-effort human estimate for display, scaled by the OUTPUT token's decimals.
  const rawEstimate = swapData?.estimatedAmount;
  const estimatedAmount =
    typeof rawEstimate === "string" && /^\d+$/.test(rawEstimate)
      ? formatUnits(BigInt(rawEstimate), TOKEN_DECIMALS[toSymbol])
      : null;

  return {
    approve,
    execute,
    amount: amountTrimmed,
    amountMinor,
    estimatedAmount,
    fromSymbol,
    toSymbol,
  };
}
