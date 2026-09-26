/**
 * Temporary verification (mainnet flags only). Delete after review if desired.
 * Loads .env.local without printing secrets.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AppKit, EarnChain } from "@circle-fin/app-kit";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env.local");

function loadEnvLocal() {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvLocal();
process.env.NEXT_PUBLIC_NETWORK = "mainnet";

const CIRCLE_BASE =
  process.env.NEXT_PUBLIC_CIRCLE_BASE_URL ?? "https://api.circle.com";
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;

console.log("=== Config (no secrets) ===");
console.log("NEXT_PUBLIC_NETWORK:", process.env.NEXT_PUBLIC_NETWORK);
console.log("CIRCLE_API_KEY set:", Boolean(CIRCLE_API_KEY));
console.log("NEXT_PUBLIC_KIT_KEY set:", Boolean(process.env.NEXT_PUBLIC_KIT_KEY));
console.log("CIRCLE_KIT_KEY / KIT_KEY env set:", Boolean(
  process.env.CIRCLE_KIT_KEY || process.env.KIT_KEY,
));

const { w3sBlockchainLabel, earnApiChainDefault } = await import(
  "../app/lib/network.ts"
);

console.log("w3sBlockchainLabel:", w3sBlockchainLabel);
console.log("earnApiChainDefault:", earnApiChainDefault);

console.log("\n=== W3S initializeUser probe (invalid userToken — auth/validation only) ===");
const initBody = {
  idempotencyKey: crypto.randomUUID(),
  accountType: "SCA",
  blockchains: [w3sBlockchainLabel],
};
console.log("Request body (to Circle):", JSON.stringify(initBody, null, 2));

if (!CIRCLE_API_KEY) {
  console.log("SKIP: no CIRCLE_API_KEY — cannot call W3S API.");
} else {
  const initRes = await fetch(`${CIRCLE_BASE}/v1/w3s/user/initialize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CIRCLE_API_KEY}`,
      "X-User-Token": "verify-probe-invalid-user-token",
    },
    body: JSON.stringify(initBody),
  });
  const initJson = await initRes.json();
  console.log("HTTP status:", initRes.status);
  console.log("Response JSON:", JSON.stringify(initJson, null, 2));

  const badChainRes = await fetch(`${CIRCLE_BASE}/v1/w3s/user/initialize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CIRCLE_API_KEY}`,
      "X-User-Token": "verify-probe-invalid-user-token",
    },
    body: JSON.stringify({
      idempotencyKey: crypto.randomUUID(),
      accountType: "SCA",
      blockchains: ["NOT_A_REAL_BLOCKCHAIN"],
    }),
  });
  const badChainJson = await badChainRes.json();
  console.log("\nCompare invalid blockchain label NOT_A_REAL_BLOCKCHAIN:");
  console.log("HTTP status:", badChainRes.status);
  console.log("Response JSON:", JSON.stringify(badChainJson, null, 2));
}

console.log("\n=== Earn exploreVaults (App Kit, chain EarnChain.Arc) ===");
try {
  const kit = new AppKit();
  const result = await kit.earn.exploreVaults({
    chain: EarnChain.Arc,
    asset: "USDC",
    sortBy: "apy",
  });
  console.log("SUCCESS: vault count:", result?.vaults?.length ?? 0);
  if (result?.vaults?.[0]) {
    console.log("First vault (summary):", {
      name: result.vaults[0].name,
      vaultAddress: result.vaults[0].vaultAddress,
      chain: result.vaults[0].chain,
    });
  }
} catch (err) {
  console.log("FAILURE:");
  console.log(err instanceof Error ? err.message : String(err));
  if (err && typeof err === "object" && "cause" in err) {
    console.log("cause:", err.cause);
  }
}

console.log("\n=== Direct GET /v1/earnKit/vaults/explore?chain=ARC (no Authorization) ===");
const exploreUrl = `${CIRCLE_BASE}/v1/earnKit/vaults/explore?chain=ARC&asset=USDC&sortBy=apy`;
const exploreRes = await fetch(exploreUrl, {
  headers: { Accept: "application/json" },
});
const exploreText = await exploreRes.text();
console.log("HTTP status:", exploreRes.status);
console.log("Body (first 2000 chars):", exploreText.slice(0, 2000));
