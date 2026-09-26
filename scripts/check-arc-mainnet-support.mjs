/**
 * Scratch script: inspect App Kit chain defs for Arc (mainnet vs testnet).
 * Not part of the Next.js app.
 */
import { AppKit } from "@circle-fin/app-kit";
import util from "node:util";

const kit = new AppKit();

function matchesArc(entry) {
  const parts = [
    entry?.name,
    entry?.chain,
    entry?.id,
    entry?.chainId != null ? String(entry.chainId) : undefined,
  ].filter(Boolean);
  return parts.some((p) => String(p).toLowerCase().includes("arc"));
}

function logSection(operationType) {
  console.log("\n" + "=".repeat(72));
  console.log(`getSupportedChains("${operationType}") — Arc-related entries`);
  console.log("=".repeat(72));

  const all = kit.getSupportedChains(operationType);
  const filtered = all.filter(matchesArc);

  console.log(`Total chains: ${all.length}; Arc-related: ${filtered.length}\n`);

  if (filtered.length === 0) {
    console.log("(none)\n");
    return;
  }

  for (const entry of filtered) {
    console.log(util.inspect(entry, { depth: null, colors: false }));
    console.log("");
  }
}

console.log("@circle-fin/app-kit version:", process.env.npm_package_dependencies?.["@circle-fin/app-kit"]);

try {
  const pkg = await import("@circle-fin/app-kit/package.json", {
    with: { type: "json" },
  });
  console.log("Resolved package.json version:", pkg.default.version);
} catch {
  // fallback: read from createRequire if subpath import fails
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  console.log(
    "Resolved package.json version:",
    require("@circle-fin/app-kit/package.json").version,
  );
}

for (const op of ["bridge", "swap", "earn"]) {
  logSection(op);
}
