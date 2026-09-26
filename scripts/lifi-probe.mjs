#!/usr/bin/env node
/**
 * LI.FI capability probe for Arc Testnet — READ-ONLY.
 * ============================================================================
 *
 * WHY THIS EXISTS
 * We cannot integrate LI.FI on faith. Before any swap/bridge code is written,
 * one question has to be answered from LI.FI's own mouth:
 *
 *     Does LI.FI index Arc Testnet (chainId 5042002) at all?
 *
 * LI.FI is an AGGREGATOR: it routes over DEXes and bridges that already exist
 * on a chain it has indexed. It cannot manufacture a pool. So if Arc Testnet
 * isn't in its chain list, swapping Circle out for LI.FI produces the exact
 * same "no route" silence from a different vendor — after a full rewrite.
 *
 * This script asks LI.FI directly. It is READ-ONLY:
 *   - GET requests only. No private key, no wallet, no signing, no approvals.
 *   - No funds can move. Safe to run repeatedly.
 *
 * HOW TO RUN (from the repo root, on your machine — needs normal internet)
 *     node scripts/lifi-probe.mjs
 *     node scripts/lifi-probe.mjs 0xYourWalletAddress    # optional, see below
 *
 * Requires Node 18+ (for global fetch). Next 16 already requires that.
 *
 * WHAT TO SEND BACK
 * Paste the console output, or attach the JSON file it writes next to itself:
 *     scripts/lifi-probe-output.json
 *
 * A FAILURE IS A RESULT. If a call 401s, 403s or 404s, that is the answer —
 * do not clean it up or summarise it. Paste it verbatim. The last time we
 * guessed at a vendor's error instead of printing it, we burned three sessions
 * on the wrong diagnosis.
 * ============================================================================
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API = "https://li.quest/v1";

// Arc Testnet facts, verified from Circle's own installed SDK — NOT guesses.
const ARC_CHAIN_ID = 5042002;
const ARC_TOKENS = {
  // USDC is Arc's NATIVE gas token (18dp); this is its 6dp ERC-20 form.
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  cirBTC: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
};

// Only used to shape a quote request. Any address works for a quote; nothing
// is signed or sent. Override on the command line if LI.FI rejects it.
const FROM_ADDRESS =
  process.argv[2] || "0x0000000000000000000000000000000000000000";

const report = { probedAt: new Date().toISOString(), steps: {} };

function hr(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

/** GET a URL and record status + body verbatim. Never throws. */
async function get(label, url) {
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
      entry.body = text; // Not JSON — keep it raw, it still tells us something.
    }
    if (!res.ok) {
      // The error body is the most valuable output in this whole script.
      console.log("BODY (verbatim):");
      console.log(typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body, null, 2));
    }
    report.steps[label] = entry;
    return res.ok ? entry.body : null;
  } catch (err) {
    entry.error = String(err?.message ?? err);
    console.log(`REQUEST FAILED: ${entry.error}`);
    report.steps[label] = entry;
    return null;
  }
}

// ---------------------------------------------------------------------------
// STEP 1 — The go/no-go. Is Arc in LI.FI's chain list?
// ---------------------------------------------------------------------------
hr("STEP 1  Does LI.FI know Arc Testnet? (chainId 5042002)");

const chainsBody = await get("chains", `${API}/chains`);
let arcChain = null;

if (chainsBody) {
  const chains = Array.isArray(chainsBody) ? chainsBody : chainsBody.chains ?? [];
  console.log(`\nLI.FI returned ${chains.length} chains.`);

  arcChain =
    chains.find((c) => Number(c?.id) === ARC_CHAIN_ID) ??
    chains.find((c) => /\barc\b/i.test(`${c?.name ?? ""} ${c?.key ?? ""}`)) ??
    null;

  if (arcChain) {
    console.log("\n*** ARC FOUND. Verbatim chain object: ***");
    console.log(JSON.stringify(arcChain, null, 2));
    if (Number(arcChain.id) !== ARC_CHAIN_ID) {
      console.log(
        `\n!! NOTE: matched on NAME, not id. LI.FI says id=${arcChain.id}, ` +
          `Arc Testnet is ${ARC_CHAIN_ID}. This is probably Arc MAINNET, ` +
          `which is a different chain and will not help vectorprotocol.pro.`,
      );
    }
  } else {
    console.log(`\n*** ARC NOT FOUND in LI.FI's chain list. ***`);
  }

  // Does LI.FI index ANY testnet? If not, Arc Testnet was never going to work,
  // and that is a fact about LI.FI's product rather than about Arc.
  const testnets = chains.filter((c) =>
    /test|sepolia|goerli|devnet/i.test(`${c?.name ?? ""} ${c?.key ?? ""}`),
  );
  console.log(
    `\nTestnets in LI.FI's list: ${testnets.length}` +
      (testnets.length
        ? ` -> ${testnets.map((c) => `${c.name}(${c.id})`).join(", ")}`
        : "  <-- LI.FI appears to be MAINNET-ONLY."),
  );

  report.summary = {
    chainCount: chains.length,
    arcFound: Boolean(arcChain),
    arcIdReported: arcChain?.id ?? null,
    arcIsTheTestnetWeUse: Number(arcChain?.id) === ARC_CHAIN_ID,
    testnetCount: testnets.length,
    testnetNames: testnets.map((c) => `${c.name}(${c.id})`),
    allChainIds: chains.map((c) => c?.id),
  };
}

// ---------------------------------------------------------------------------
// STEP 2 — If Arc is known, which tokens does LI.FI list for it?
// ---------------------------------------------------------------------------
hr("STEP 2  Which Arc tokens does LI.FI list?");

if (!arcChain) {
  console.log("SKIPPED — Arc is not in LI.FI's chain list, so it has no tokens there.");
} else {
  // Try both identifiers; LI.FI accepts a short key for some endpoints and a
  // numeric id for others, and we are not going to guess which.
  for (const ident of [arcChain.key, String(arcChain.id)].filter(Boolean)) {
    const body = await get(`tokens[${ident}]`, `${API}/tokens?chains=${ident}`);
    if (!body) continue;
    const list = body?.tokens?.[String(arcChain.id)] ?? body?.tokens?.[ident] ?? [];
    console.log(`Tokens listed for "${ident}": ${list.length}`);
    for (const t of list) {
      const known = Object.entries(ARC_TOKENS).find(
        ([, a]) => a.toLowerCase() === String(t?.address).toLowerCase(),
      );
      console.log(
        `  ${String(t?.symbol).padEnd(8)} ${t?.address}  decimals=${t?.decimals}` +
          (known ? `   <- matches our verified ${known[0]}` : ""),
      );
    }
    // Flag any disagreement with Circle's addresses. Do not silently adopt
    // LI.FI's version; a mismatch needs a human look before any funds move.
    for (const [sym, addr] of Object.entries(ARC_TOKENS)) {
      const hit = list.find((t) => String(t?.address).toLowerCase() === addr.toLowerCase());
      if (!hit) console.log(`  !! our ${sym} (${addr}) is NOT in LI.FI's list`);
    }
  }
}

// ---------------------------------------------------------------------------
// STEP 3 — Can LI.FI actually quote the pair Circle refuses?
// ---------------------------------------------------------------------------
hr("STEP 3  Ask for a real quote: 1 USDC -> EURC on Arc");

if (!arcChain) {
  console.log("SKIPPED — no Arc, no quote.");
} else {
  // Param names below are VERIFIED from the LI.FI SDK README's getQuote example
  // (fromAddress / fromChain / toChain / fromToken / toToken / fromAmount), and
  // `integrator` is required by createClient, so we pass it here too.
  //
  // CRITICAL SUBTLETY FOR ARC: the README addresses a chain's NATIVE gas token
  // as the zero address. On Arc, USDC *is* the native gas token (18dp), and it
  // ALSO has a 6dp ERC-20 representation. LI.FI could plausibly want either, so
  // we try every naming rather than picking one and calling it verified.
  const NATIVE_SENTINEL = "0x0000000000000000000000000000000000000000";

  const attempts = [
    ["erc20-USDC->EURC", ARC_TOKENS.USDC, ARC_TOKENS.EURC, "1000000"],
    ["native-USDC->EURC", NATIVE_SENTINEL, ARC_TOKENS.EURC, "1000000000000000000"],
    ["symbol-USDC->EURC", "USDC", "EURC", "1000000"],
  ];

  let gotOne = false;
  for (const [label, fromToken, toToken, fromAmount] of attempts) {
    const qs = new URLSearchParams({
      fromChain: String(arcChain.id),
      toChain: String(arcChain.id),
      fromToken,
      toToken,
      fromAmount,
      fromAddress: FROM_ADDRESS,
      integrator: "vector-probe",
    });
    const quote = await get(`quote[${label}]`, `${API}/quote?${qs}`);
    if (!quote) continue;
    gotOne = true;
    console.log(`\n*** A ROUTE EXISTS via ${label}. Key fields: ***`);
    console.log(
      JSON.stringify(
        {
          tool: quote?.tool,
          fromAmount: quote?.action?.fromAmount ?? quote?.estimate?.fromAmount,
          toAmount: quote?.estimate?.toAmount,
          toAmountMin: quote?.estimate?.toAmountMin,
          // This is the whole prize: a ready-to-send tx we could hand to either
          // an external wallet OR the W3S contract-execution challenge flow.
          transactionRequest: quote?.transactionRequest,
        },
        null,
        2,
      ),
    );
    break; // One working naming is enough; the rest is noise.
  }
  if (!gotOne) {
    console.log(
      "\nNo naming of USDC produced a quote. The verbatim error bodies above are\n" +
        "the answer — send them as-is, do not summarise them.",
    );
  }
}

// ---------------------------------------------------------------------------
// STEP 4 — Bridge feasibility: Arc <-> the chains we already support.
// ---------------------------------------------------------------------------
hr("STEP 4  Bridge connections out of Arc");

if (!arcChain) {
  console.log("SKIPPED — no Arc.");
} else {
  await get(
    "connections[arc->base-sepolia]",
    `${API}/connections?fromChain=${arcChain.id}&toChain=84532`,
  );
}

// ---------------------------------------------------------------------------
hr("VERDICT");

const s = report.summary ?? {};
if (!chainsBody) {
  console.log("Could not reach LI.FI at all. Check the network / paste the error above.");
} else if (!s.arcFound) {
  console.log(
    `Arc is NOT in LI.FI's ${s.chainCount} indexed chains.\n` +
      `=> LI.FI cannot route on Arc today. It would NOT fix the swap problem.\n` +
      (s.testnetCount === 0
        ? `=> LI.FI also lists ZERO testnets, so this is a product boundary, not an Arc gap.`
        : ``),
  );
} else if (!s.arcIsTheTestnetWeUse) {
  console.log(
    `LI.FI knows an "Arc" but reports id=${s.arcIdReported}, not ${ARC_CHAIN_ID}.\n` +
      `=> That is almost certainly Arc MAINNET. Useful later, useless for the testnet app.`,
  );
} else {
  console.log(
    `LI.FI indexes Arc Testnet (${ARC_CHAIN_ID}). Integration is worth costing out.\n` +
      `=> Send back the quote body from STEP 3; that decides whether a route exists.`,
  );
}

const out = join(dirname(fileURLToPath(import.meta.url)), "lifi-probe-output.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nFull raw output written to: ${out}`);
console.log("Paste the console output above, or attach that file.\n");
