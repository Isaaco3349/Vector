#!/usr/bin/env node
/**
 * Circle Stablecoin Service probe for Arc Testnet — READ-ONLY.
 * ============================================================================
 *
 * THE QUESTION THIS ANSWERS
 * Vector's Swap fails with INPUT_UNSUPPORTED_ROUTE (1003) but ezwallet.cash
 * swaps USDC/EURC/cirBTC on Arc Testnet through the same Circle service.
 *
 * We have verified from the installed SDK source that Vector's request is built
 * CORRECTLY — chain string, token symbols and addresses all check out (see the
 * eliminations below). So the difference is not the request shape. The leading
 * hypothesis is now the ENDPOINT:
 *
 *   - Vector's external-wallet Swap calls App Kit estimateSwap
 *       -> GET  /v1/stablecoinKits/quote
 *   - EZwallet (per its author) calls
 *       -> POST /v1/stablecoinKits/swap    and hand-builds the tx batch
 *
 * If /quote 404s on Arc Testnet while /swap succeeds, that single fact explains
 * everything: why EZwallet works, why we don't, and why EVERY pair fails for us
 * rather than just cirBTC. swap-kit maps ANY 404 to UNSUPPORTED_ROUTE with
 * recoverability 'FATAL' hardcoded at the mapping site (index.cjs ~2758), so an
 * endpoint-level 404 is indistinguishable from "this pair has no liquidity".
 *
 * ALREADY ELIMINATED (from installed source, not guesswork):
 *   - Token addresses. swap-kit resolves Arc USDC to 0x3600…0000 itself.
 *   - Base URL. STABLECOIN_SERVICE_BASE_URL is a single hardcoded
 *     'https://api.circle.com' — there is no testnet host we're missing.
 *   - Chain string. Vector sends "Arc_Testnet"; Blockchain.Arc_Testnet is
 *     exactly "Arc_Testnet".
 *   - Token symbols/case. supportedSwapTokenSchema uppercases input then checks
 *     SWAP_TOKEN_REGISTRY, whose keys include USDC, EURC and CIRBTC. "cirBTC"
 *     normalises to "CIRBTC" and is valid.
 *   - A mandatory API key. getQuote explicitly supports "permissionless mode:
 *     no Authorization header when the kit key is absent".
 *
 * ============================================================================
 * SAFETY — read this before running.
 *
 * Part A is GET only.
 *
 * Part B issues POST /v1/stablecoinKits/swap. That endpoint does NOT move money:
 * it RETURNS unsigned adapter calldata plus a Circle proxy EIP-712 signature,
 * which a wallet would have to sign and broadcast separately. This script never
 * signs and never broadcasts, holds no private key, and touches no wallet. Your
 * own server already calls this exact endpoint the same way for the Google-wallet
 * swap path (app/api/endpoints/route.ts, case "createSwapTransaction").
 *
 * Nothing here can spend your funds. If you would rather not send the POST at
 * all, run with --quote-only.
 * ============================================================================
 *
 * HOW TO RUN (on your machine — the sandbox has no network)
 *     node scripts/circle-swap-quote-probe.mjs 0xYourArcWalletAddress
 *     node scripts/circle-swap-quote-probe.mjs 0xYourArcWalletAddress --quote-only
 *
 * Optional, to test whether authenticating widens the route set. The script
 * never prints or saves the key — do not paste it into chat, do not commit it:
 *     CIRCLE_KIT_KEY=... node scripts/circle-swap-quote-probe.mjs 0xYourAddress
 *
 * WHAT TO SEND BACK
 * The console output, or scripts/circle-swap-quote-output.json. A failure is a
 * result — paste error bodies verbatim, do not summarise them.
 * ============================================================================
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = "https://api.circle.com";
const CHAIN = "Arc_Testnet"; // Blockchain["Arc_Testnet"] === "Arc_Testnet"

// Verified from swap-kit's own token registry locators for Arc_Testnet.
const USDC = "0x3600000000000000000000000000000000000000"; // 6 dp
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"; // 6 dp
const CIRBTC = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF"; // 8 dp

const args = process.argv.slice(2);
const FROM = args.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
const QUOTE_ONLY = args.includes("--quote-only");
const KIT_KEY = process.env.CIRCLE_KIT_KEY;

if (!FROM) {
  console.error(
    "Usage: node scripts/circle-swap-quote-probe.mjs 0xYourArcWalletAddress [--quote-only]\n" +
      "(A real address is needed — the service quotes against a sender.)",
  );
  process.exit(1);
}

const report = {
  probedAt: new Date().toISOString(),
  authenticatedTestRun: Boolean(KIT_KEY),
  quoteOnly: QUOTE_ONLY,
  results: {},
};

/** Query string for GET /quote, built exactly as swap-kit's buildQuoteUrl does. */
function quoteUrl({ tokenIn, tokenOut, amount, feeBps, feeBeneficiary }) {
  const url = new URL("/v1/stablecoinKits/quote", BASE);
  url.searchParams.set("tokenInAddress", tokenIn);
  url.searchParams.set("tokenInChain", CHAIN);
  url.searchParams.set("tokenOutAddress", tokenOut);
  url.searchParams.set("tokenOutChain", CHAIN);
  url.searchParams.set("fromAddress", FROM);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", "300"); // the SDK's documented default
  if (feeBps !== undefined) {
    // buildQuoteUrl flattens fees this way; both keys verbatim.
    url.searchParams.set("fees.platformBps", String(feeBps));
    url.searchParams.set("fees.beneficiary", feeBeneficiary);
  }
  return url.toString();
}

/** Record a response without ever echoing the credential. */
async function send(label, { url, method = "GET", body, withKey = false }) {
  console.log(`\n${"-".repeat(74)}\n${label}`);
  console.log(`${method} ${url}`);
  if (body) console.log(`BODY SENT: ${JSON.stringify(body)}`);
  console.log(`Authorization: ${withKey ? "Bearer <redacted>" : "(none — permissionless)"}`);

  const headers = { accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (withKey && KIT_KEY) headers.Authorization = `Bearer ${KIT_KEY}`;

  const entry = { url, method, requestBody: body ?? null, authenticated: withKey };
  try {
    const res = await fetch(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    entry.status = res.status;
    entry.ok = res.ok;
    try {
      entry.body = JSON.parse(text);
    } catch {
      entry.body = text; // Not JSON — still evidence.
    }
    console.log(`HTTP ${res.status} ${res.statusText}`);
    console.log("RESPONSE (verbatim):");
    console.log(typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body, null, 2));
  } catch (err) {
    entry.error = String(err?.message ?? err);
    console.log(`REQUEST FAILED: ${entry.error}`);
  }
  report.results[label] = entry;
  return entry;
}

const getQuote = (label, opts, o = {}) =>
  send(label, { url: quoteUrl(opts), method: "GET", ...o });

/**
 * POST /v1/stablecoinKits/swap. Field names verified against
 * provider-stablecoin-service-swap createSwapRequestBaseSchema, and identical
 * to what app/api/endpoints/route.ts already sends in production.
 */
const postSwap = (label, { tokenIn, tokenOut, amount }, o = {}) =>
  send(label, {
    url: new URL("/v1/stablecoinKits/swap", BASE).toString(),
    method: "POST",
    body: {
      tokenInAddress: tokenIn,
      tokenInChain: CHAIN,
      tokenOutAddress: tokenOut,
      tokenOutChain: CHAIN,
      fromAddress: FROM,
      toAddress: FROM,
      amount,
      slippageBps: 300,
    },
    ...o,
  });

console.log("=".repeat(74));
console.log("Circle Stablecoin Service probe — Arc Testnet");
console.log(`fromAddress: ${FROM}`);
console.log(`kit key: ${KIT_KEY ? "present (authenticated case will run)" : "absent (permissionless only)"}`);
console.log(`mode: ${QUOTE_ONLY ? "GET /quote only" : "GET /quote + POST /swap"}`);
console.log("=".repeat(74));

// === PART A — GET /quote, the endpoint Vector's external Swap actually uses ===
console.log(`\n${"=".repeat(74)}\nPART A — GET /quote  (what Vector calls today)\n${"=".repeat(74)}`);

const qCirbtc = await getQuote("A1 quote USDC->cirBTC", {
  tokenIn: USDC, tokenOut: CIRBTC, amount: "1000000",
});
const qEurc = await getQuote("A2 quote USDC->EURC", {
  tokenIn: USDC, tokenOut: EURC, amount: "1000000",
});
const qReverse = await getQuote("A3 quote cirBTC->USDC", {
  tokenIn: CIRBTC, tokenOut: USDC, amount: "10000", // 0.0001 cirBTC at 8 dp
});
const qFees = await getQuote("A4 quote USDC->cirBTC + fees.platformBps=10", {
  tokenIn: USDC, tokenOut: CIRBTC, amount: "1000000", feeBps: 10, feeBeneficiary: FROM,
});
const qAuth = KIT_KEY
  ? await getQuote("A5 quote USDC->cirBTC AUTHENTICATED", {
      tokenIn: USDC, tokenOut: CIRBTC, amount: "1000000",
    }, { withKey: true })
  : null;
if (!KIT_KEY) console.log(`\n${"-".repeat(74)}\nA5 skipped — no CIRCLE_KIT_KEY in env.`);

// === PART B — POST /swap, the endpoint EZwallet uses ========================
let sEurc = null;
let sCirbtc = null;
if (QUOTE_ONLY) {
  console.log(`\n${"=".repeat(74)}\nPART B skipped (--quote-only).\n${"=".repeat(74)}`);
} else {
  console.log(`\n${"=".repeat(74)}\nPART B — POST /swap  (what EZwallet calls; returns unsigned calldata only)\n${"=".repeat(74)}`);
  sEurc = await postSwap("B1 swap USDC->EURC", { tokenIn: USDC, tokenOut: EURC, amount: "1000000" });
  sCirbtc = await postSwap("B2 swap USDC->cirBTC", { tokenIn: USDC, tokenOut: CIRBTC, amount: "1000000" });
}

// === DIAGNOSIS =============================================================
console.log(`\n${"=".repeat(74)}\nDIAGNOSIS\n${"=".repeat(74)}`);
const ok = (x) => Boolean(x && x.ok);
const st = (x) => (x ? x.status : "n/a");
const anyQuote = [qCirbtc, qEurc, qReverse, qFees, qAuth].some(ok);
const anySwap = [sEurc, sCirbtc].some(ok);

console.log(
  `GET  /quote : cirBTC=${st(qCirbtc)}  EURC=${st(qEurc)}  reverse=${st(qReverse)}  ` +
    `+fees=${st(qFees)}  auth=${st(qAuth)}`,
);
console.log(`POST /swap  : EURC=${st(sEurc)}  cirBTC=${st(sCirbtc)}\n`);

if (!anyQuote && anySwap) {
  console.log(
    "*** ENDPOINT MISMATCH CONFIRMED — this is the bug. ***\n" +
      "POST /swap works; GET /quote does not. Vector's external Swap quotes through\n" +
      "App Kit estimateSwap -> GET /quote, so it fails on every pair and swap-kit\n" +
      "relabels the 404 as INPUT_UNSUPPORTED_ROUTE. Nothing is wrong with Arc\n" +
      "liquidity, our addresses, or cirBTC.\n" +
      "FIX: drive Swap from POST /swap (we ALREADY have that proxy working for the\n" +
      "Google wallet in app/api/endpoints/route.ts) instead of estimateSwap.",
  );
} else if (anyQuote && !ok(qCirbtc) && ok(qEurc)) {
  console.log(
    "/quote works for EURC but not cirBTC => genuinely pair-specific.\n" +
      "Keep cirBTC out of Swap, and ask EZwallet's author which pairs actually filled.",
  );
} else if (ok(qFees) && !ok(qCirbtc)) {
  console.log(
    "*** Fee params changed the outcome: fees.platformBps/beneficiary participate in\n" +
      "route resolution. Pass customFee (task #21) and the route appears.",
  );
} else if (ok(qAuth) && !ok(qCirbtc)) {
  console.log(
    "*** Authentication widens the route set: permissionless quoting is narrower.\n" +
      "FIX: move swap quoting server-side behind our API route, where a kitKey can\n" +
      "be held safely, instead of quoting from the browser.",
  );
} else if (anyQuote) {
  console.log(
    "/quote succeeded here but Swap still fails in the app => the fault is in our\n" +
      "App Kit wiring (adapter, chain guard, or symbol resolution), not the service.",
  );
} else {
  console.log(
    "Everything failed, including POST /swap. Then the Google-wallet swap path can\n" +
      "never have worked either, and the difference from EZwallet lies in something\n" +
      "the bodies above should show — compare them against EZwallet's request. Note\n" +
      "the HTTP status: 401/403 would mean auth (swap-kit relabels those as\n" +
      "VALIDATION_FAILED), 404 means 'route OR resource not found'.",
  );
}

const out = join(dirname(fileURLToPath(import.meta.url)), "circle-swap-quote-output.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nRaw output (contains no credentials): ${out}`);
