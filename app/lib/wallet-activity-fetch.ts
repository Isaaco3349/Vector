/**
 * Read-only wallet transaction fetch + Vector-oriented labeling (server-safe).
 */
import { getAddress, isAddress } from "viem";
import { BRIDGE_CHAINS, bridgeChainByNumericId } from "./bridge-chains";
import {
  explorerBaseFromKitExplorerUrl,
  getKitBridgeChainDefs,
} from "./kit-bridge-chains";
import {
  classifyContractToLabel,
  w3sContractActivityLabel,
} from "./vector-contract-labels";

export { w3sContractActivityLabel };

export type WalletActivityItem = {
  txHash: string;
  chainId: number;
  chainLabel: string;
  label: string;
  detail?: string;
  timestamp: string | null;
  status: "confirmed" | "pending" | "failed";
};


function explorerApiBaseForChain(chainId: number): string | null {
  const row = bridgeChainByNumericId(chainId);
  if (row) {
    const fromTemplate = row.explorerAddress.replace(
      /\/address\/\{address\}$/i,
      "",
    );
    if (fromTemplate && !fromTemplate.includes("{")) {
      return fromTemplate.replace(/\/$/, "");
    }
  }
  const kit = getKitBridgeChainDefs().find((c) => c.chainId === chainId);
  return explorerBaseFromKitExplorerUrl(kit?.explorerUrl) ?? null;
}

function isEtherscanFamilyHost(base: string): boolean {
  try {
    const host = new URL(base).hostname;
    return (
      host.includes("etherscan") ||
      host.includes("basescan") ||
      host.includes("arbiscan") ||
      host.includes("snowtrace") ||
      host.includes("polygonscan") ||
      host.includes("lineascan") ||
      host.endsWith("uniscan.xyz")
    );
  } catch {
    return false;
  }
}

type BlockscoutTx = {
  hash?: string;
  timestamp?: string;
  from?: { hash?: string };
  to?: { hash?: string };
  status?: string;
  method?: string;
};

async function fetchBlockscoutPage(
  apiBase: string,
  address: string,
  signal?: AbortSignal,
): Promise<BlockscoutTx[]> {
  const url = `${apiBase}/api/v2/addresses/${address}/transactions`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal,
    next: { revalidate: 30 },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: BlockscoutTx[] };
  return Array.isArray(data.items) ? data.items : [];
}

async function fetchEtherscanPage(
  apiBase: string,
  address: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Array<{ hash: string; timeStamp: string; to: string; from: string; isError: string }>> {
  const host = new URL(apiBase).hostname;
  let apiHost = host;
  if (host === "basescan.org") apiHost = "api.basescan.org";
  else if (host.endsWith("etherscan.io")) apiHost = "api.etherscan.io";
  else if (host === "arbiscan.io") apiHost = "api.arbiscan.io";
  else if (host === "polygonscan.com") apiHost = "api.polygonscan.com";
  else if (host === "optimistic.etherscan.io") apiHost = "api-optimistic.etherscan.io";
  else if (host === "snowtrace.io") apiHost = "api.snowtrace.io";
  else if (host === "lineascan.build") apiHost = "api.lineascan.build";
  else return [];

  const url = new URL(`https://${apiHost}/api`);
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", address);
  url.searchParams.set("sort", "desc");
  url.searchParams.set("offset", "20");
  url.searchParams.set("page", "1");
  url.searchParams.set("apikey", apiKey);

  const res = await fetch(url.toString(), { signal, next: { revalidate: 30 } });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    status?: string;
    result?: Array<{ hash: string; timeStamp: string; to: string; from: string; isError: string }>;
  };
  if (data.status !== "1" || !Array.isArray(data.result)) return [];
  return data.result;
}

function parseBlockscoutItem(
  tx: BlockscoutTx,
  chainId: number,
  chainLabel: string,
  walletLower: string,
): WalletActivityItem | null {
  const hash = tx.hash;
  if (!hash) return null;
  const to = tx.to?.hash;
  const from = tx.from?.hash?.toLowerCase();
  let label = classifyContractToLabel(to);
  if (from === walletLower && label === "Transaction") {
    label = "Sent";
  }
  const ts = tx.timestamp ?? null;
  const failed = (tx.status ?? "").toLowerCase() === "error";
  return {
    txHash: hash,
    chainId,
    chainLabel,
    label,
    timestamp: ts,
    status: failed ? "failed" : "confirmed",
  };
}

/**
 * Fetch recent transactions for an address across Vector bridge chains.
 * Never throws; returns newest-first merged list (deduped by hash).
 */
export async function fetchWalletActivityAcrossChains(params: {
  address: string;
  /** If set, only query these numeric chain ids (default: all BRIDGE_CHAINS). */
  chainIds?: number[];
  perChainLimit?: number;
  signal?: AbortSignal;
}): Promise<WalletActivityItem[]> {
  const { address, signal } = params;
  if (!isAddress(address)) return [];
  const walletLower = getAddress(address).toLowerCase();
  const chainIds =
    params.chainIds ??
    BRIDGE_CHAINS.map((c) => c.chainId).filter(
      (id, i, arr) => arr.indexOf(id) === i,
    );
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim() ?? "";

  const tasks = chainIds.map(async (chainId) => {
    const chain = bridgeChainByNumericId(chainId);
    const chainLabel = chain?.label ?? String(chainId);
    const base = explorerApiBaseForChain(chainId);
    if (!base) return [] as WalletActivityItem[];

    try {
      if (isEtherscanFamilyHost(base)) {
        if (!apiKey) return [];
        const rows = await fetchEtherscanPage(base, address, apiKey, signal);
        return rows
          .map((tx) => {
            const label = classifyContractToLabel(tx.to);
            const from = tx.from?.toLowerCase();
            const resolved =
              from === walletLower && label === "Transaction" ? "Sent" : label;
            return {
              txHash: tx.hash,
              chainId,
              chainLabel,
              label: resolved,
              timestamp: tx.timeStamp
                ? new Date(Number(tx.timeStamp) * 1000).toISOString()
                : null,
              status:
                tx.isError === "1"
                  ? ("failed" as const)
                  : ("confirmed" as const),
            };
          })
          .slice(0, params.perChainLimit ?? 15);
      }

      const rows = await fetchBlockscoutPage(base, address, signal);
      return rows
        .map((tx) => parseBlockscoutItem(tx, chainId, chainLabel, walletLower))
        .filter((x): x is WalletActivityItem => x !== null)
        .slice(0, params.perChainLimit ?? 15);
    } catch {
      return [];
    }
  });

  const batches = await Promise.all(tasks);
  const byHash = new Map<string, WalletActivityItem>();
  for (const item of batches.flat()) {
    const key = item.txHash.toLowerCase();
    if (!byHash.has(key)) byHash.set(key, item);
  }

  return [...byHash.values()].sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
    const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
    return tb - ta;
  });
}
