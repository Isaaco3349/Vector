import { NextResponse } from "next/server";

const CIRCLE_BASE_URL =
  process.env.NEXT_PUBLIC_CIRCLE_BASE_URL ?? "https://api.circle.com";
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY as string;

// Every call to Circle's API gets a hard timeout. Without this, a slow or
// flaky connection just hangs indefinitely on the client, showing up as
// an unexplained multi-second (or multi-minute) freeze with no error.
async function fetchCircle(
  url: string,
  init: RequestInit,
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function timeoutErrorResponse(action: string) {
  return NextResponse.json(
    {
      error: `Timed out talking to Circle while running "${action}". This is usually a network hiccup, please try again.`,
      code: "TIMEOUT",
    },
    { status: 504 },
  );
}

export async function POST(request: Request) {
  let action = "unknown";
  try {
    const body = await request.json();
    ({ action } = body ?? {});
    const params = body ?? {};

    if (!action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    switch (action) {
      case "createDeviceToken": {
        const { deviceId } = params;
        if (!deviceId) {
          return NextResponse.json(
            { error: "Missing deviceId" },
            { status: 400 },
          );
        }

        const response = await fetchCircle(
          `${CIRCLE_BASE_URL}/v1/w3s/users/social/token`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${CIRCLE_API_KEY}`,
            },
            body: JSON.stringify({
              idempotencyKey: crypto.randomUUID(),
              deviceId,
            }),
          },
        );

        const data = await response.json();

        if (!response.ok) {
          return NextResponse.json(data, { status: response.status });
        }

        // Returns: { deviceToken, deviceEncryptionKey }
        return NextResponse.json(data.data, { status: 200 });
      }

      case "initializeUser": {
        const { userToken } = params;
        if (!userToken) {
          return NextResponse.json(
            { error: "Missing userToken" },
            { status: 400 },
          );
        }

        const response = await fetchCircle(
          `${CIRCLE_BASE_URL}/v1/w3s/user/initialize`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${CIRCLE_API_KEY}`,
              "X-User-Token": userToken,
            },
            body: JSON.stringify({
              idempotencyKey: crypto.randomUUID(),
              accountType: "SCA",
              blockchains: ["ARC-TESTNET"],
            }),
          },
        );

        const data = await response.json();

        if (!response.ok) {
          // Pass through Circle error payload (e.g. code 155106: user already initialized)
          return NextResponse.json(data, { status: response.status });
        }

        // Returns: { challengeId }
        return NextResponse.json(data.data, { status: 200 });
      }

      case "listWallets": {
        const { userToken } = params;
        if (!userToken) {
          return NextResponse.json(
            { error: "Missing userToken" },
            { status: 400 },
          );
        }

        const response = await fetchCircle(`${CIRCLE_BASE_URL}/v1/w3s/wallets`, {
          method: "GET",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            Authorization: `Bearer ${CIRCLE_API_KEY}`,
            "X-User-Token": userToken,
          },
        });

        const data = await response.json();

        if (!response.ok) {
          return NextResponse.json(data, { status: response.status });
        }

        // Returns: { wallets: [...] }
        return NextResponse.json(data.data, { status: 200 });
      }

      case "getTokenBalance": {
        const { userToken, walletId } = params;
        if (!userToken || !walletId) {
          return NextResponse.json(
            { error: "Missing userToken or walletId" },
            { status: 400 },
          );
        }

        const response = await fetchCircle(
          `${CIRCLE_BASE_URL}/v1/w3s/wallets/${walletId}/balances`,
          {
            method: "GET",
            headers: {
              accept: "application/json",
              Authorization: `Bearer ${CIRCLE_API_KEY}`,
              "X-User-Token": userToken,
            },
          },
        );

        const data = await response.json();

        if (!response.ok) {
          return NextResponse.json(data, { status: response.status });
        }

        // Returns: { tokenBalances: [...] }
        return NextResponse.json(data.data, { status: 200 });
      }

      case "createTransferChallenge": {
        // Creates a challenge to send USDC from a user-controlled (Google/W3S)
        // wallet. This is the ONE call that moves real funds, so every field
        // name below is copied verbatim from Circle's verified API reference
        // for POST /v1/w3s/user/transactions/transfer — nothing is guessed:
        //   - wallet identified by `walletId` alone (docs: walletId OR
        //     walletAddress+blockchain; we have walletId).
        //   - token identified by `tokenId` (Circle's token UUID from the
        //     balances endpoint) — no hardcoded USDC address.
        //   - `amounts` is an ARRAY of decimal strings; one element for a
        //     single transfer.
        //   - `feeLevel: "MEDIUM"` lets Circle estimate gas (on Arc, gas is
        //     paid in USDC), so we never hand-compute fees.
        const { userToken, walletId, tokenId, destinationAddress, amount } =
          params;
        if (
          !userToken ||
          !walletId ||
          !tokenId ||
          !destinationAddress ||
          !amount
        ) {
          return NextResponse.json(
            {
              error:
                "Missing userToken, walletId, tokenId, destinationAddress, or amount",
            },
            { status: 400 },
          );
        }

        const response = await fetchCircle(
          `${CIRCLE_BASE_URL}/v1/w3s/user/transactions/transfer`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${CIRCLE_API_KEY}`,
              "X-User-Token": userToken,
            },
            body: JSON.stringify({
              idempotencyKey: crypto.randomUUID(),
              walletId,
              tokenId,
              destinationAddress,
              amounts: [String(amount)],
              feeLevel: "MEDIUM",
            }),
          },
        );

        const data = await response.json();

        if (!response.ok) {
          // Pass through Circle's error payload (code + message) with status.
          return NextResponse.json(data, { status: response.status });
        }

        // Returns: { challengeId }
        return NextResponse.json(data.data, { status: 200 });
      }

      case "createContractExecutionChallenge": {
        // Creates a challenge to execute an arbitrary smart-contract call from
        // a user-controlled (Google/W3S) wallet. Used by Bridge (CCTP approve
        // + burn) and later Swap/Earn.
        //
        // DESIGN: the CLIENT encodes the call with Circle's OWN kit
        // (adapter.prepareAction(...).getCallData() → {to,data,value}) and
        // sends us the resulting raw `callData` + target `contractAddress`.
        // So this route never hand-encodes a router/CCTP call — the exact
        // addresses, function selectors and argument packing all come from
        // Circle's installed SDK, not from us. (The endpoint also accepts
        // `abiFunctionSignature` + `abiParameters`; we forward that form too if
        // a caller ever prefers Circle-side encoding.)
        //
        // Field names copied verbatim from Circle's verified API reference for
        // POST /v1/w3s/user/transactions/contractExecution:
        //   - wallet identified by `walletId` alone.
        //   - `contractAddress` = the target contract (`to`).
        //   - `callData` = raw ABI-encoded hex — OR abiFunctionSignature +
        //     abiParameters.
        //   - `amount` = NATIVE value (msg.value) as a decimal string; "0" for
        //     our CCTP approve/burn (both non-payable).
        //   - `feeLevel: "MEDIUM"` lets Circle estimate gas (paid in USDC on
        //     Arc), so we never hand-compute fees.
        const {
          userToken,
          walletId,
          contractAddress,
          callData,
          abiFunctionSignature,
          abiParameters,
          amount,
        } = params;

        const hasCallData =
          typeof callData === "string" && callData.length > 0;
        const hasAbiSpec =
          typeof abiFunctionSignature === "string" &&
          abiFunctionSignature.length > 0;

        if (!userToken || !walletId || !contractAddress || (!hasCallData && !hasAbiSpec)) {
          return NextResponse.json(
            {
              error:
                "Missing userToken, walletId, contractAddress, or a call spec (callData OR abiFunctionSignature[+abiParameters])",
            },
            { status: 400 },
          );
        }

        // Assemble ONLY the fields Circle expects. Prefer the raw calldata the
        // client extracted from the kit; fall back to abi+args if that's what
        // was provided.
        const contractBody: Record<string, unknown> = {
          idempotencyKey: crypto.randomUUID(),
          walletId,
          contractAddress,
          amount: amount != null ? String(amount) : "0",
          feeLevel: "MEDIUM",
        };
        if (hasCallData) {
          contractBody.callData = callData;
        } else {
          contractBody.abiFunctionSignature = abiFunctionSignature;
          contractBody.abiParameters = Array.isArray(abiParameters)
            ? abiParameters
            : [];
        }

        const response = await fetchCircle(
          `${CIRCLE_BASE_URL}/v1/w3s/user/transactions/contractExecution`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${CIRCLE_API_KEY}`,
              "X-User-Token": userToken,
            },
            body: JSON.stringify(contractBody),
          },
        );

        const data = await response.json();

        if (!response.ok) {
          // Pass through Circle's error payload (code + message) with status.
          return NextResponse.json(data, { status: response.status });
        }

        // Returns: { challengeId }
        return NextResponse.json(data.data, { status: 200 });
      }

      case "createSwapTransaction": {
        // Builds a swap transaction via Circle's Stablecoin Service, which
        // returns the Adapter-Contract `executeParams` + a Circle proxy-signed
        // EIP-712 `signature`. This is the ONE piece a Google-wallet swap needs
        // that the bridge didn't: the client then encodes approve + execute
        // calldata from this response with Circle's OWN adapter kit and routes
        // each through the verified createContractExecutionChallenge flow.
        //
        // WHY THIS IS A SERVER PROXY (not called from the browser directly):
        // it's the same-origin path our client already talks to, so it avoids
        // cross-origin/CORS concerns and keeps one networking surface. But note
        // this endpoint is PERMISSIONLESS on testnet — like our external Swap
        // (app/lib/appkit.ts runs App Kit with no kitKey) — so we send NO
        // Authorization header here. Our W3S `CIRCLE_API_KEY` is for the
        // /v1/w3s/* endpoints only; the Stablecoin Service uses a separate
        // "kitKey" that is optional on testnet and, per Circle's SDK, must never
        // be exposed to the browser. We simply omit it (permissionless), exactly
        // as the swap provider does when kitKey is absent.
        //
        // Field names verified against provider-stablecoin-service-swap@1.4.1
        // createSwapRequestBaseSchema (index.cjs:10205) — nothing guessed:
        //   tokenInAddress, tokenInChain, tokenOutAddress, tokenOutChain?,
        //   fromAddress, toAddress, amount (base-units string), slippageBps?.
        // The response is returned DIRECTLY (NOT `.data`-wrapped, unlike the
        // /v1/w3s/* endpoints above) — makeApiRequest returns parsed JSON as-is.
        const {
          tokenInAddress,
          tokenInChain,
          tokenOutAddress,
          tokenOutChain,
          fromAddress,
          toAddress,
          amount,
          slippageBps,
        } = params;

        if (
          !tokenInAddress ||
          !tokenInChain ||
          !tokenOutAddress ||
          !fromAddress ||
          !toAddress ||
          !amount
        ) {
          return NextResponse.json(
            {
              error:
                "Missing tokenInAddress, tokenInChain, tokenOutAddress, fromAddress, toAddress, or amount",
            },
            { status: 400 },
          );
        }

        // Assemble ONLY the fields Circle's schema accepts. tokenOutChain
        // defaults to tokenInChain (same-chain swap) when omitted.
        const swapBody: Record<string, unknown> = {
          tokenInAddress,
          tokenInChain,
          tokenOutAddress,
          tokenOutChain: tokenOutChain ?? tokenInChain,
          fromAddress,
          toAddress,
          amount: String(amount),
        };
        if (slippageBps != null && Number.isFinite(Number(slippageBps))) {
          swapBody.slippageBps = Number(slippageBps);
        }

        const response = await fetchCircle(
          `${CIRCLE_BASE_URL}/v1/stablecoinKits/swap`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // NO Authorization header — permissionless testnet swap.
            },
            body: JSON.stringify(swapBody),
          },
        );

        const data = await response.json();

        if (!response.ok) {
          // Pass through Circle's error payload (code + message) with status.
          return NextResponse.json(data, { status: response.status });
        }

        // Return the swap response verbatim — it is NOT `.data`-wrapped.
        // Shape (createSwapResponseSchema): { tokenInAddress, tokenInChain,
        // tokenOutAddress, tokenOutChain, fromAddress, toAddress, amount,
        // stopLimit, estimatedAmount, fees?, transaction:{ signature,
        // executionParams:{ execId, deadline, metadata, tokens[], instructions[] } } }.
        return NextResponse.json(data, { status: 200 });
      }

      case "createEarnDeposit":
      case "createEarnWithdraw": {
        // Builds an Earn deposit/withdraw via Circle's Earn Service, which
        // returns the Adapter-Contract `executionParams` + a Circle proxy-signed
        // `signature`. The client then encodes approve + execute calldata from
        // this response with Circle's OWN adapter kit (app/lib/google-earn.ts)
        // and routes each through the verified createContractExecutionChallenge
        // flow — exactly like the Google-wallet Swap.
        //
        // WHY THIS IS A SERVER PROXY (not called from the browser directly):
        // it keeps one same-origin networking surface (no cross-origin/CORS
        // concerns). Like the Swap proxy, this endpoint is PERMISSIONLESS on
        // testnet — Circle's Earn Service `buildConfig` sends NO Authorization
        // header when no `kitKey` is present, and the kitKey is a server-only
        // secret that must never reach the browser. So we send NO Authorization
        // header here. (Our W3S CIRCLE_API_KEY is for /v1/w3s/* endpoints only.)
        //
        // Field names verified against provider-earn-service@1.4.0 fetchDeposit
        // (index.mjs:14251) / fetchWithdraw (:14586) — nothing guessed:
        //   { vaultAddress, amount, address, chain }.
        //   - vaultAddress: discovered via exploreVaults, never hardcoded.
        //   - amount: human-readable decimal STRING; the service scales it.
        //   - chain: MUST be "ARC-TESTNET" (CHAIN_TO_API[Arc_Testnet], :9131).
        // The response IS `.data`-wrapped (depositPayloadSchema :11490 /
        // withdrawPayloadSchema): { data: { execId, executionParams, signature } }.
        // We unwrap to `.data` so the client gets the payload at top level,
        // matching how the provider does `return response.data`.
        const isDeposit = action === "createEarnDeposit";
        const { vaultAddress, amount, address, chain } = params;

        if (!vaultAddress || !amount || !address) {
          return NextResponse.json(
            { error: "Missing vaultAddress, amount, or address" },
            { status: 400 },
          );
        }

        const earnBody = {
          vaultAddress,
          amount: String(amount),
          address,
          // Default to Arc Testnet's API chain string if the client omits it.
          chain: typeof chain === "string" && chain ? chain : "ARC-TESTNET",
        };

        const response = await fetchCircle(
          `${CIRCLE_BASE_URL}/v1/earnKit/${isDeposit ? "deposit" : "withdraw"}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // NO Authorization header — permissionless testnet earn.
            },
            body: JSON.stringify(earnBody),
          },
          // The earn service polls internally on its own client, but here we
          // make a single call; give it a little longer than the default since
          // param signing can take a moment.
          20000,
        );

        const data = await response.json();

        if (!response.ok) {
          // Pass through Circle's error payload (code + message) with status.
          return NextResponse.json(data, { status: response.status });
        }

        // Unwrap the `.data` envelope → { execId, executionParams, signature }.
        return NextResponse.json(data?.data ?? data, { status: 200 });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`Circle API call timed out during "${action}"`);
      return timeoutErrorResponse(action);
    }
    console.error(`Error in /api/endpoints (action: ${action}):`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
