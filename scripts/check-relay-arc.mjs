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
/** Base mainnet USDC (Circle). */
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const AMOUNT_USDC = "5";
const AMOUNT_MINOR = "5000000"; // 5 USDC @ 6 decimals

const USER =
  process.argv[2] || "0x03508bb71268bba25ecacc8f620e01866650532c";

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

async function postQuote(label, body) {
  const url = `${RELAY_API}/quote/v2`;
  console.log(`\n--- ${label}\nPOST ${url}`);
  console.log("Request body:", JSON.stringify(body, null, 2));
  const entry = { url, requestBody: body };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
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

const outPath = join(__dirname, "check-relay-arc-output.json");
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nWrote ${outPath}`);
