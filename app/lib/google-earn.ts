"use client";

/**
 * Google-wallet (Circle user-controlled / W3S) EARN encoder — deposit & withdraw.
 *
 * ── WHY THIS FILE IS DIFFERENT FROM app/lib/earn.ts ───────────────────────────
 * earn.ts drives an EXTERNAL wallet: it hands EarnKit a live provider and
 * `kit.deposit()/withdraw()` signs + broadcasts (approve then execute) itself. A
 * Google-login wallet has NO provider to sign with — it can only move funds
 * through Circle's challenge flow (server creates the tx over REST → challengeId
 * → browser PIN → Circle signs + broadcasts).
 *
 * So we reproduce the two moving pieces of an Earn action, but every
 * money-critical byte is still produced by Circle's OWN installed SDK — nothing
 * is hand-encoded. This mirrors app/lib/google-swap.ts exactly; Earn is actually
 * SIMPLER than swap (no BigInt transform — see below):
 *   1. deposit/withdraw SERVICE call → Circle returns the Adapter-Contract
 *      `executionParams` + a Circle proxy-signed `signature`. (Server proxy:
 *      app/api/endpoints actions "createEarnDeposit" / "createEarnWithdraw".)
 *   2. APPROVE calldata   ← adapter.prepareAction('usdc.increaseAllowance'
 *      | 'token.approve', …).getCallData()
 *   3. EXECUTE calldata   ← adapter.prepareAction('earn.deposit'|'earn.withdraw',
 *      …).getCallData()
 * The panel routes (2) and (3) through the verified
 * createContractExecutionChallenge flow (PIN #1, PIN #2). We NEVER execute here.
 *
 * ── W3S-COMPATIBLE (no user off-chain signature) ──────────────────────────────
 * Our read-only Arc adapter has no signTypedData, so the only viable token-input
 * is the pre-approval PermitType.NONE path (an on-chain approve + a literal
 * fallback token input). The `signature` in executionParams is Circle's proxy
 * attestation (verified on-chain by the Adapter Contract), NOT a user signature.
 *
 * ── executionParams PASSES THROUGH UNCHANGED (unlike swap) ────────────────────
 * Swap's provider ran a prepareEvmSwapAction transform (string → BigInt) before
 * handing params to the adapter. Earn does NOT: the adapter's earn handler
 * (`prepareEarnExecute`) validates executeParams as `z.object({}).passthrough()`
 * and forwards it verbatim to `encodeFunctionData` as
 * `execute(executeParams, tokenInputs, signature)`. Installed viem 2.55.11
 * accepts numeric STRINGS for uint256, so the RAW JSON executionParams
 * (execId/deadline/value/amountToApprove/minTokenOut as strings) encodes fine.
 * Only `tokenInputs[].amount` must be a real bigint (adapter schema: z.bigint()).
 * (Verified end-to-end with a real encodeFunctionData round-trip, 2026-08-20.)
 *
 * ── VERIFIED AGAINST INSTALLED SOURCE (2026-08-20) ────────────────────────────
 * provider-earn-service@1.4.0/index.mjs:
 *   • HTTP: base 'https://api.circle.com', prefix '/v1/earnKit'. Deposit
 *     POST /v1/earnKit/deposit, Withdraw POST /v1/earnKit/withdraw. Body
 *     {vaultAddress, amount, address, chain} (@14251/@14586). Response is
 *     `.data`-wrapped → {execId, executionParams, signature} (depositPayloadSchema
 *     @11490). Keyless/permissionless when no kitKey (buildConfig @12706 sends NO
 *     Authorization header; kitKey is server-only and forbidden in-browser).
 *   • chain = CHAIN_TO_API[Blockchain.Arc_Testnet] = "ARC-TESTNET" (@9131) —
 *     hyphen/upper, DIFFERS from swap's "Arc_Testnet".
 *   • amount is a human-readable decimal STRING; the service scales by decimals.
 *   • DEPOSIT tokenInputs (@15521): approvalToken = resolveEarnApprovalToken
 *     (first instruction with amountToApprove>0 → tokenIn); tokenInputs =
 *     buildEarnTokenInputs(executionParams, approvalToken). (@9699/@9728)
 *   • WITHDRAW tokenInputs (@15726): buildEarnTokenInputs(executionParams,
 *     vaultAddress) — approved token is the VAULT-SHARE token; approvalToken =
 *     tokenInputs[0]?.token.
 *   • buildEarnTokenInputs (@9699): for each instruction with
 *     BigInt(amountToApprove) > 0n, assert tokenIn === approvedToken (isSameAddress,
 *     case-insensitive), push {permitType: NONE(0), token: tokenIn,
 *     amount: BigInt(amountToApprove), permitCalldata:'0x'}.
 *   • requiredAllowance = Σ tokenInputs.amount (@15018).
 *   • APPROVE (prepareApprovalAction @9477): isUsdc = tokenAddress === chain.usdcAddress
 *     → prepareAction('usdc.increaseAllowance', {delegate, amount: required + 1n});
 *     else → prepareAction('token.approve', {tokenAddress, delegate,
 *     amount: required + 1n}). WARM_SLOT_RESIDUAL = 1n (@9446). delegate =
 *     chain.kitContracts.adapter (@15505 requireAdapterContract).
 *   • EXECUTE (executeEarnAction @10457): adapter.prepareAction('earn.deposit'
 *     |'earn.withdraw', {executeParams: executionParams, tokenInputs, signature},
 *     {chain, address}). (The 4th `authorization` arg is optional legacy-compat.)
 * adapter-viem-v2@1.15.0/index.mjs:
 *   • 'earn.deposit'/'earn.withdraw' → prepareEarnExecute (@18012/@18021).
 *   • prepareEarnExecute (@17117): target = chain.kitContracts.adapter; args =
 *     [executeParams, tokenInputs, signature]; NO value set → getCallData().value
 *     is undefined → "0" (correct for non-native USDC ERC-4626 vaults).
 *   • earnExecuteParamsSchema (@17049): executeParams passthrough; tokenInputs[].
 *     amount MUST be z.bigint().
 *   • Arc def: usdcAddress 0x3600…, kitContracts.adapter 0xBBD70b01… (SAME adapter
 *     as swap), chainId 5042002, rpcEndpoints[0]. ALL read from the def here.
 *
 * ── ON-CHAIN RISK ─────────────────────────────────────────────────────────────
 * The approve step is already live-proven (bridge/swap used usdc.increaseAllowance
 * on Arc's 0x3600 predeploy 2026-08-20). The unproven pieces are earn.deposit /
 * earn.withdraw against Arc adapter 0xBBD7… + whether Circle's Earn SERVICE
 * actually issues Arc-Testnet params and the vault contracts accept them — the
 * same class of risk Swap carries. Confirm with a small live deposit on the
 * deployed app.
 */

import type { Eip1193Provider } from "./appkit";
import type { EarnPosition } from "./earn";

/** The two Earn actions this module encodes. */
export type EarnAction = "deposit" | "withdraw";

/** A single contract call for the W3S contractExecution challenge. */
export type EarnCall = {
  /** Target contract address (msg.to). From Circle's getCallData().to. */
  to: string;
  /** ABI-encoded calldata hex. From Circle's getCallData().data. */
  data: string;
  /** Native msg.value as a decimal string. "0" for non-native USDC vaults. */
  value: string;
};

/**
 * A fully-encoded earn plan. Run `approve` first (contractExecution challenge)
 * when present, then `execute`. `approve` is null when the service reports no
 * token approval is required (matches the provider's `approvalNeeded` guard).
 */
export type EarnPlan = {
  approve: EarnCall | null;
  execute: EarnCall;
  action: EarnAction;
  /** Human amount echoed back for display. */
  amount: string;
  /** The vault this plan targets. */
  vaultAddress: string;
};

export type BuildEarnPlanArgs = {
  /** The W3S wallet's EVM address (from + beneficiary). */
  walletAddress: string;
  /** On-chain vault address (discovered via listArcVaults — never hardcoded). */
  vaultAddress: string;
  /** Human-readable amount, e.g. "100.5". Passed to the service as-is. */
  amount: string;
};

/** The Google wallet only ever earns on Arc. adapter def id (underscore). */
const ARC_CHAIN_ENUM = "Arc_Testnet";

/**
 * The chain string the EARN HTTP endpoints expect. This is
 * CHAIN_TO_API[Blockchain.Arc_Testnet] = "ARC-TESTNET" (hyphen/upper) — DIFFERENT
 * from the adapter def id "Arc_Testnet". Verified provider-earn-service @9131.
 */
const ARC_EARN_API_CHAIN = "ARC-TESTNET";

/** PermitType.NONE — no user off-chain permit; tokens pre-approved on-chain. */
const PERMIT_TYPE_NONE = 0;

/** Warm-slot residual the earn provider adds to every approval (@9446). */
const WARM_SLOT_RESIDUAL = BigInt(1);

/** A token input for the Adapter Contract, W3S-compatible (PermitType.NONE). */
type TokenInput = {
  permitType: number;
  token: string;
  amount: bigint;
  permitCalldata: string;
};

/** The service `executionParams.instructions[]` shape we read (uints as strings). */
type EarnInstruction = {
  tokenIn: string;
  amountToApprove: string;
};

/**
 * Minimal read-only EIP-1193 provider for the W3S wallet — copied verbatim from
 * google-swap.ts. The Circle viem adapter needs a provider to learn the wallet
 * address (eth_accounts) and read chain state; a W3S wallet exposes none, so we
 * synthesise the smallest honest one: identity/chain methods answered locally,
 * other READS forwarded to Arc's public RPC, every SIGN / SEND method THROWS
 * (we only ever call getCallData(), never execute — a stray broadcast attempt
 * should fail loudly, not sign silently).
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
            `google-earn read-only provider: refusing "${method}" — this ` +
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
function readCallData(prepared: unknown, label: string): EarnCall {
  if (
    !prepared ||
    typeof prepared !== "object" ||
    typeof (prepared as { getCallData?: unknown }).getCallData !== "function"
  ) {
    throw new Error(
      `Circle earn ${label}: prepared request has no getCallData() — can't ` +
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
      `Circle earn ${label}: getCallData() returned no {to,data} — refusing to ` +
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
    `Circle earn response is missing "${label}". No funds moved — please try again.`,
  );
}

/** Case-insensitive address compare — provider's isSameAddress (@9652). */
function isSameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Pull the instructions array out of the (loosely-typed) executionParams, or
 * throw. Each entry must expose tokenIn + amountToApprove (all we read).
 */
function readInstructions(executionParams: Record<string, unknown>): EarnInstruction[] {
  const raw = executionParams.instructions;
  if (!Array.isArray(raw)) {
    throw new Error(
      "Circle earn response has malformed execution params. No funds moved — please try again.",
    );
  }
  return raw as EarnInstruction[];
}

/**
 * Reimplements provider-earn-service `buildEarnTokenInputs` (@9699) VERBATIM.
 * For each instruction with a positive amountToApprove, assert its tokenIn
 * matches the single approved token (the Adapter Contract can only be granted
 * one token's allowance per action), then emit a PermitType.NONE fallback input.
 * amount is a real bigint (the adapter schema requires z.bigint()).
 */
function buildEarnTokenInputs(
  instructions: EarnInstruction[],
  approvedToken: string,
): TokenInput[] {
  const tokenInputs: TokenInput[] = [];
  instructions.forEach((instruction, index) => {
    const amount = BigInt(instruction.amountToApprove);
    if (amount <= BigInt(0)) return;
    const { tokenIn } = instruction;
    if (!isSameAddress(tokenIn, approvedToken)) {
      throw new Error(
        `Circle earn: executionParams.instructions[${index}].tokenIn (${tokenIn}) ` +
          "must match the token approved for adapter spending. No funds moved.",
      );
    }
    tokenInputs.push({
      permitType: PERMIT_TYPE_NONE,
      token: tokenIn,
      amount,
      permitCalldata: "0x",
    });
  });
  return tokenInputs;
}

/**
 * Reimplements provider-earn-service `resolveEarnApprovalToken` (@9728) VERBATIM.
 * Returns the single token requested by positive-approval instructions (deposit:
 * USDC), or undefined when none need approval. Throws if multiple tokens appear.
 */
function resolveEarnApprovalToken(
  instructions: EarnInstruction[],
): string | undefined {
  let approvedToken: string | undefined;
  instructions.forEach((instruction, index) => {
    const amount = BigInt(instruction.amountToApprove);
    if (amount <= BigInt(0)) return;
    const { tokenIn } = instruction;
    if (approvedToken === undefined) {
      approvedToken = tokenIn;
      return;
    }
    if (!isSameAddress(tokenIn, approvedToken)) {
      throw new Error(
        `Circle earn: executionParams.instructions[${index}].tokenIn (${tokenIn}) ` +
          "must match the token approved for adapter spending. No funds moved.",
      );
    }
  });
  return approvedToken;
}

/** Σ tokenInputs.amount — provider's sumTokenInputAmounts (@15018). */
function sumTokenInputAmounts(tokenInputs: TokenInput[]): bigint {
  return tokenInputs.reduce((sum, t) => sum + t.amount, BigInt(0));
}

/** Internal: everything the two public builders share. */
async function buildEarnPlan(
  action: EarnAction,
  args: BuildEarnPlanArgs,
): Promise<EarnPlan> {
  const { walletAddress, vaultAddress } = args;
  const amountTrimmed = args.amount.trim();
  if (amountTrimmed === "" || !(Number(amountTrimmed) > 0)) {
    throw new Error("Enter an amount greater than zero.");
  }

  // Dynamic import — mirrors google-swap.ts / google-bridge.ts.
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

  // Resolve Arc's own chain DEFINITION (object, not string). Every money-critical
  // address is read from here — nothing hardcoded in this file.
  const arcDef = resolveChainIdentifier(ARC_CHAIN_ENUM) as Record<
    string,
    unknown
  >;

  const usdcAddress = requireString(arcDef, "usdcAddress", "USDC address");
  const kitContracts =
    arcDef.kitContracts && typeof arcDef.kitContracts === "object"
      ? (arcDef.kitContracts as Record<string, unknown>)
      : null;
  const adapterContract = requireString(
    kitContracts,
    "adapter",
    "earn adapter contract",
  );

  // Arc RPC + chain id straight from the resolved def (no hardcoding).
  const rpcList = (arcDef as { rpcEndpoints?: unknown }).rpcEndpoints;
  const rpcUrl =
    Array.isArray(rpcList) && typeof rpcList[0] === "string"
      ? (rpcList[0] as string)
      : "https://rpc.testnet.arc.network/";
  const numericChainId = (arcDef as { chainId?: unknown }).chainId;
  const chainIdHex =
    typeof numericChainId === "number"
      ? "0x" + numericChainId.toString(16)
      : "0x" + (5042002).toString(16);

  // 1) deposit/withdraw via our same-origin server proxy (permissionless testnet).
  //    Returns Circle's executionParams + proxy-signed signature (`.data`-wrapped
  //    by the endpoint; our proxy already unwraps to the payload).
  const action_name =
    action === "deposit" ? "createEarnDeposit" : "createEarnWithdraw";
  const serviceResponse = await fetch("/api/endpoints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: action_name,
      vaultAddress,
      amount: amountTrimmed,
      address: walletAddress,
      chain: ARC_EARN_API_CHAIN,
    }),
  });
  const payload = await serviceResponse.json();
  if (!serviceResponse.ok) {
    throw new Error(
      payload?.code === "TIMEOUT"
        ? "That's taking longer than expected reaching Circle. Please try again."
        : typeof payload?.message === "string" && payload.message
          ? payload.message
          : typeof payload?.error === "string" && payload.error
            ? payload.error
            : action === "deposit"
              ? "Couldn't prepare the deposit. This vault may not be available."
              : "Couldn't prepare the withdrawal. Please try again.",
    );
  }

  // 2) Read the service payload. executionParams passes through to the adapter
  //    UNCHANGED (raw string uints) — only signature is a plain string and
  //    tokenInputs.amount must be bigint (built below).
  const executionParams =
    payload?.executionParams && typeof payload.executionParams === "object"
      ? (payload.executionParams as Record<string, unknown>)
      : null;
  if (!executionParams) {
    throw new Error(
      "Circle earn response is missing executionParams. No funds moved — please try again.",
    );
  }
  const signature = requireString(payload, "signature", "earn signature");
  const instructions = readInstructions(executionParams);

  // tokenInputs + the single token to approve, following the provider's flow:
  //  - deposit: approvedToken = first positive instruction's tokenIn (USDC).
  //  - withdraw: approvedToken = the vault-share token (== vaultAddress).
  let tokenInputs: TokenInput[];
  let approvalToken: string | undefined;
  if (action === "deposit") {
    approvalToken = resolveEarnApprovalToken(instructions);
    tokenInputs =
      approvalToken === undefined
        ? []
        : buildEarnTokenInputs(instructions, approvalToken);
  } else {
    tokenInputs = buildEarnTokenInputs(instructions, vaultAddress);
    approvalToken = tokenInputs[0]?.token;
  }
  const requiredAllowance = sumTokenInputAmounts(tokenInputs);

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
      "Circle viem adapter has no prepareAction() — can't encode the earn action safely.",
    );
  }

  // ctx = {chain: def} with NO address: user-controlled adapters resolve the
  // address themselves via adapter.getAddress() (proven live by swap on
  // 2026-08-20); passing an address is forbidden for them.
  const ctx = { chain: arcDef };

  // APPROVE — let the Adapter Contract pull the token. Only when the service
  // reports a positive approval (matches provider `approvalNeeded` guard). USDC
  // uses increaseAllowance (its canonical predeploy method); any other token
  // (e.g. a vault-share token on withdraw) uses the standard ERC-20 approve.
  // amount = requiredAllowance + WARM_SLOT_RESIDUAL (verbatim provider behaviour).
  let approve: EarnCall | null = null;
  if (approvalToken !== undefined && requiredAllowance > BigInt(0)) {
    const approveAmount = requiredAllowance + WARM_SLOT_RESIDUAL;
    const isUsdc = isSameAddress(approvalToken, usdcAddress);
    const approvePrepared = isUsdc
      ? await adapter.prepareAction(
          "usdc.increaseAllowance",
          { delegate: adapterContract, amount: approveAmount },
          ctx,
        )
      : await adapter.prepareAction(
          "token.approve",
          {
            tokenAddress: approvalToken,
            delegate: adapterContract,
            amount: approveAmount,
          },
          ctx,
        );
    approve = readCallData(approvePrepared, "approve");
  }

  // EXECUTE — AdapterContract.execute(executeParams, tokenInputs, signature).
  // Target (adapter contract) and value (0 for non-native USDC vaults) are
  // resolved inside the handler — we don't set them. executeParams is the RAW
  // executionParams (no BigInt transform; viem encodes string uints).
  const actionKey = action === "deposit" ? "earn.deposit" : "earn.withdraw";
  const executePrepared = await adapter.prepareAction(
    actionKey,
    { executeParams: executionParams, tokenInputs, signature },
    ctx,
  );
  const execute = readCallData(executePrepared, "execute");

  return {
    approve,
    execute,
    action,
    amount: amountTrimmed,
    vaultAddress,
  };
}

/**
 * Build the deposit plan (approve USDC → deposit) for the Google wallet.
 * Loaded behind a dynamic import so the SDK only enters the bundle when a user
 * actually opens Earn.
 */
export async function buildDepositPlan(
  args: BuildEarnPlanArgs,
): Promise<EarnPlan> {
  return buildEarnPlan("deposit", args);
}

/**
 * Build the withdraw plan (approve vault shares if required → withdraw) for the
 * Google wallet.
 */
export async function buildWithdrawPlan(
  args: BuildEarnPlanArgs,
): Promise<EarnPlan> {
  return buildEarnPlan("withdraw", args);
}

/**
 * Resolve Arc's public RPC url + hex chain id from the installed adapter chain
 * definition — nothing hardcoded (falls back to Arc's documented defaults only
 * if the def ever omits them). Shared by the read-only position reader below.
 */
async function resolveArcRpc(): Promise<{ rpcUrl: string; chainIdHex: string }> {
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
  const arcDef = resolveChainIdentifier(ARC_CHAIN_ENUM) as Record<
    string,
    unknown
  >;
  const rpcList = (arcDef as { rpcEndpoints?: unknown }).rpcEndpoints;
  const rpcUrl =
    Array.isArray(rpcList) && typeof rpcList[0] === "string"
      ? (rpcList[0] as string)
      : "https://rpc.testnet.arc.network/";
  const numericChainId = (arcDef as { chainId?: unknown }).chainId;
  const chainIdHex =
    typeof numericChainId === "number"
      ? "0x" + numericChainId.toString(16)
      : "0x" + (5042002).toString(16);
  return { rpcUrl, chainIdHex };
}

/**
 * Read the Google (W3S) wallet's position in a vault. This is a pure on-chain
 * READ — no funds move and no PIN is needed — so it safely reuses the same
 * read-only Arc provider the encoder uses (which THROWS on any sign/send) and
 * the already-verified `getEarnPosition` from app/lib/earn.ts. Lets the withdraw
 * screen show a real vault balance + a working Max button instead of guessing.
 */
export async function readGoogleEarnPosition(args: {
  walletAddress: string;
  vaultAddress: string;
}): Promise<EarnPosition> {
  const { rpcUrl, chainIdHex } = await resolveArcRpc();
  const provider = createReadOnlyArcProvider({
    address: args.walletAddress,
    chainIdHex,
    rpcUrl,
  });
  const { getEarnPosition } = await import("./earn");
  // The read-only provider satisfies Eip1193Provider structurally; cast through
  // unknown to sidestep request-param variance between the two declarations.
  return getEarnPosition({
    provider: provider as unknown as Eip1193Provider,
    vaultAddress: args.vaultAddress,
  });
}
