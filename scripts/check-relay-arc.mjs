#!/usr/bin/env node
/**
 * Relay × Arc mainnet bridge probe — READ-ONLY.
 *
 * Uses Relay's public HTTP API (same backend as @relayprotocol/relay-sdk /
 * legacy @reservoir0x/relay-sdk getQuote). No SDK install, no signing.
 *
 *   node scripts/check-relay-arc.mjs
 *   node scripts/check-relay-arc.mjs 0xYourWalletAddress
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RELAY_API = "https://api.relay.link";
const ARC_CHAIN_ID = 5042;
const BASE_CHAIN_ID = 8453;

/** Circle App Kit bridge def for Arc mainnet (verified locally). */
const ARC_USDC = "0x3600000000000000000000000000000000000000";
/** Circle App Kit `eurcAddress` on Arc mainnet (verified locally). */
const ARC_EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
/** Base mainnet USDC (Circle). */
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const AMOUNT_USDC = "5";
const AMOUNT_MINOR = "5000000"; // 5 USDC @ 6 decimals

const USER =
  process.argv[2] || "0x03508bb71268bba25ecacc8f620e01866650532c";

/** App fee probe: 100 bps = 1% of input (docs.relay.link get-quote-v2 `appFees`). */
const APP_FEE_BPS = "100";
const APP_FEE_RECIPIENT = USER;

const __dirname = dirname(fileURLToPath(import.meta.url));
const report = { probedAt: new Date().toISOString(), steps: {} };

function hr(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

async function getJson(label, url) {
  console.log(`\n--- ${label}\nGET ${url}`);
  const entry = { url };
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const text = await res.text();
    entry.status = res.status;
    entry.ok = res.ok;
    console.log(`HTTP ${res.status} ${res.statusText}`);
    try {
      entry.body = JSON.parse(text);
    } catch {
      entry.body = text;
    }
    console.log(JSON.stringify(entry.body, null, 2));
  } catch (err) {
    entry.error = String(err);
    console.error(entry.error);
  }
  report.steps[label] = entry;
  return entry;
}

function relayQuoteHeaders(extra = {}) {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    ...extra,
  };
  const apiKey = process.env.RELAY_API_KEY?.trim();
  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}

async function postQuote(label, body, options = {}) {
  const url = `${RELAY_API}/quote/v2`;
  const headers = relayQuoteHeaders(options.headers);
  console.log(`\n--- ${label}\nPOST ${url}`);
  console.log(
    "Headers:",
    JSON.stringify(
      { ...headers, "x-api-key": headers["x-api-key"] ? "(set)" : "(missing)" },
      null,
      2,
    ),
  );
  console.log("Request body:", JSON.stringify(body, null, 2));
  const entry = { url, requestBody: body, apiKeyPresent: Boolean(headers["x-api-key"]) };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    entry.status = res.status;
    entry.ok = res.ok;
    console.log(`HTTP ${res.status} ${res.statusText}`);
    try {
      entry.body = JSON.parse(text);
    } catch {
      entry.body = text;
    }
    console.log(JSON.stringify(entry.body, null, 2));
    entry.summary = summarizeQuote(entry.body, entry.status);
    if (entry.summary) {
      console.log("\n--- Quote summary ---");
      console.log(JSON.stringify(entry.summary, null, 2));
    }
  } catch (err) {
    entry.error = String(err);
    console.error(entry.error);
  }
  report.steps[label] = entry;
  return entry;
}

function summarizeQuote(body, status) {
  if (typeof body === "string") {
    return { executable: false, reason: "non-json response", status };
  }
  if (body?.message && !body?.steps) {
    return {
      executable: false,
      reason: body.message,
      code: body.code ?? body.errorCode,
      status,
    };
  }
  const steps = body?.steps;
  const fees = body?.fees;
  const details = body?.details;
  const hasSteps = Array.isArray(steps) && steps.length > 0;
  return {
    executable: status === 200 && hasSteps,
    status,
    stepCount: hasSteps ? steps.length : 0,
    fees: fees ?? null,
    details: details ?? null,
    timeEstimate: body?.timeEstimate ?? details?.timeEstimate ?? null,
    currencyIn: details?.currencyIn ?? body?.currencyIn ?? null,
    currencyOut: details?.currencyOut ?? body?.currencyOut ?? null,
  };
}

/** Pull app-fee lines from quote response (fees.app + expandedPriceImpact.app). */
function extractAppFeeBreakdown(body) {
  if (!body || typeof body !== "object") return null;
  const details = body.details;
  return {
    feesApp: body.fees?.app ?? null,
    expandedPriceImpactApp: details?.expandedPriceImpact?.app ?? null,
    currencyOutAmount: details?.currencyOut?.amount ?? null,
    currencyOutFormatted: details?.currencyOut?.amountFormatted ?? null,
    totalImpactUsd: details?.totalImpact?.usd ?? null,
  };
}

function printAppFeeComparison(baseline, withFee) {
  console.log("\n--- App fee A/B (baseline vs appFees in request) ---");
  console.log(JSON.stringify({ baseline, withFee }, null, 2));
}

hr("Relay SDK / API (read-only notes)");
console.log(`
Programmatic quotes:
  • HTTP: POST ${RELAY_API}/quote/v2  (documented at docs.relay.link)
  • SDK:  @relayprotocol/relay-sdk (current; npm also lists legacy @reservoir0x/relay-sdk)
  • Action: getClient().actions.getQuote({ chainId, toChainId, currency, toCurrency, amount, tradeType, user, ... })
This script uses the HTTP API only — no new project dependencies.
`);

await getJson(
  "chains includeChains=5042,8453",
  `${RELAY_API}/chains?includeChains=${ARC_CHAIN_ID},${BASE_CHAIN_ID}`,
);

const quoteArcToBase = {
  user: USER,
  recipient: USER,
  originChainId: ARC_CHAIN_ID,
  destinationChainId: BASE_CHAIN_ID,
  originCurrency: ARC_USDC,
  destinationCurrency: BASE_USDC,
  amount: AMOUNT_MINOR,
  tradeType: "EXACT_INPUT",
};

const quoteBaseToArc = {
  user: USER,
  recipient: USER,
  originChainId: BASE_CHAIN_ID,
  destinationChainId: ARC_CHAIN_ID,
  originCurrency: BASE_USDC,
  destinationCurrency: ARC_USDC,
  amount: AMOUNT_MINOR,
  tradeType: "EXACT_INPUT",
};

await postQuote(
  `quote ${AMOUNT_USDC} USDC Arc (${ARC_CHAIN_ID}) → Base (${BASE_CHAIN_ID})`,
  quoteArcToBase,
);

await postQuote(
  `quote ${AMOUNT_USDC} USDC Base (${BASE_CHAIN_ID}) → Arc (${ARC_CHAIN_ID})`,
  quoteBaseToArc,
);

const quoteArcSameChain = {
  user: USER,
  recipient: USER,
  originChainId: ARC_CHAIN_ID,
  destinationChainId: ARC_CHAIN_ID,
  originCurrency: ARC_USDC,
  destinationCurrency: ARC_EURC,
  amount: AMOUNT_MINOR,
  tradeType: "EXACT_INPUT",
};

await postQuote(
  `quote ${AMOUNT_USDC} USDC → EURC same-chain Arc (${ARC_CHAIN_ID})`,
  quoteArcSameChain,
);

hr("App fee probe (POST /quote/v2 `appFees`)");
console.log(`
Docs (get-quote-v2): optional \`appFees\` array — each entry { recipient, fee } where fee is bps (100 = 1%).
Also optional \`referrer\` / \`referrerAddress\` (no fee semantics in OpenAPI).
Probe: ${APP_FEE_BPS} bps on ${AMOUNT_USDC} USDC Arc→Base, recipient ${APP_FEE_RECIPIENT}
Set RELAY_API_KEY in the environment if the app-fee quote returns 401 (live API requires x-api-key for appFees).
`);

const appFeeBaselineBody = {
  user: USER,
  recipient: USER,
  originChainId: ARC_CHAIN_ID,
  destinationChainId: BASE_CHAIN_ID,
  originCurrency: ARC_USDC,
  destinationCurrency: BASE_USDC,
  amount: AMOUNT_MINOR,
  tradeType: "EXACT_INPUT",
};

const appFeeWithFeeBody = {
  ...appFeeBaselineBody,
  appFees: [{ recipient: APP_FEE_RECIPIENT, fee: APP_FEE_BPS }],
  referrer: "vector-app-fee-probe",
  referrerAddress: APP_FEE_RECIPIENT,
};

const baselineEntry = await postQuote(
  `app-fee baseline ${AMOUNT_USDC} USDC Arc→Base (no appFees)`,
  appFeeBaselineBody,
);
const withFeeEntry = await postQuote(
  `app-fee test ${AMOUNT_USDC} USDC Arc→Base (appFees ${APP_FEE_BPS} bps)`,
  appFeeWithFeeBody,
);

const baselineBreakdown = extractAppFeeBreakdown(baselineEntry.body);
const withFeeBreakdown = extractAppFeeBreakdown(withFeeEntry.body);
printAppFeeComparison(baselineBreakdown, withFeeBreakdown);
report.steps.appFeeComparison = {
  requestField: "appFees",
  feeDenomination: "basis points of input amount (per OpenAPI + features/app-fees)",
  bpsUsed: APP_FEE_BPS,
  recipient: APP_FEE_RECIPIENT,
  baseline: baselineBreakdown,
  withAppFees: withFeeBreakdown,
};

const outPath = join(__dirname, "check-relay-arc-output.json");
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nWrote ${outPath}`);
