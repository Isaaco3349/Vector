"use client";

import { formatUnits, parseUnits } from "viem";
import type { Eip1193Provider } from "./appkit";
import type { BridgeChain } from "./bridge-chains";
import type { BridgeExecution } from "./bridge";
import { explorerTxUrl } from "./bridge-chains";

const LIFI_INTEGRATOR = "vectorprotocol";
const USDC_DECIMALS = 6;

export type LifiBridgeQuote = {
  amount: string;
  feeText: string;
  gasText: string | null;
  estimatedReceive: string | null;
  toolName: string | null;
  raw: unknown;
};

function usdcAddress(chain: BridgeChain): `0x${string}` {
  if (chain.usdcAddress) return chain.usdcAddress;
  if (chain.usdcKind === "native") {
    return "0x3600000000000000000000000000000000000000";
  }
  throw new Error(`USDC address missing for ${chain.label}.`);
}

export async function estimateLifiBridge(args: {
  from: BridgeChain;
  to: BridgeChain;
  amount: string;
  fromAddress: string;
}): Promise<LifiBridgeQuote> {
  const quote = await fetchLifiQuote(args);
  const tool =
    quote && typeof quote === "object"
      ? ((quote as { toolDetails?: { name?: string } }).toolDetails?.name ??
        (quote as { tool?: string }).tool ??
        null)
      : null;
  const toAmount =
    quote && typeof quote === "object"
      ? ((quote as { estimate?: { toAmount?: string } }).estimate?.toAmount ??
        (quote as { toAmount?: string }).toAmount)
      : null;
  const estimatedReceive =
    toAmount && /^\d+$/.test(toAmount)
      ? formatUnits(BigInt(toAmount), USDC_DECIMALS)
      : null;

  return {
    amount: args.amount,
    feeText: `Bridge via LI.FI${tool ? ` (${tool})` : ""} — network fees apply`,
    gasText: `Source gas on ${args.from.label}`,
    estimatedReceive,
    toolName: tool,
    raw: quote,
  };
}

async function fetchLifiQuote(args: {
  from: BridgeChain;
  to: BridgeChain;
  amount: string;
  fromAddress: string;
}): Promise<unknown> {
  const amountBase = parseUnits(args.amount.trim() as `${number}`, USDC_DECIMALS);
  const url = new URL("https://li.quest/v1/quote");
  url.searchParams.set("fromChain", String(args.from.chainId));
  url.searchParams.set("toChain", String(args.to.chainId));
  url.searchParams.set("fromToken", usdcAddress(args.from));
  url.searchParams.set("toToken", usdcAddress(args.to));
  url.searchParams.set("fromAmount", amountBase.toString());
  url.searchParams.set("fromAddress", args.fromAddress);
  url.searchParams.set("slippage", "0.005");
  url.searchParams.set("integrator", LIFI_INTEGRATOR);

  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  const body = await res.json();
  if (!res.ok) {
    const msg =
      typeof body?.message === "string"
        ? body.message
        : "LI.FI could not quote this bridge route.";
    throw new Error(msg);
  }
  return body;
}

export async function executeLifiBridge(args: {
  provider: Eip1193Provider;
  from: BridgeChain;
  to: BridgeChain;
  amount: string;
  fromAddress: string;
  fromChainId: import("./bridge-chains").BridgeChainId;
}): Promise<BridgeExecution> {
  const quote = (await fetchLifiQuote({
    from: args.from,
    to: args.to,
    amount: args.amount,
    fromAddress: args.fromAddress,
  })) as Record<string, unknown>;

  const { executeLifiFromQuote } = await import("./aggregator-swap/execute-client");
  const { txHash } = await executeLifiFromQuote(
    args.provider,
    args.fromAddress,
    quote,
  );

  return {
    txHash,
    explorerUrl: explorerTxUrl(args.fromChainId, txHash),
    state: "pending",
    failureDetail: null,
    raw: { provider: "lifi", quote },
  };
}
