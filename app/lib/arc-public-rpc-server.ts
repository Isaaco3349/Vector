import { createPublicClient, fallback, http, type Hash } from "viem";
import { arcViemChain } from "./viem-arc-chain";
import { isMainnet, rpcUrl } from "./network";

/** Arc mainnet RPCs (server-side — no browser CORS). */
export function arcServerRpcUrls(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    const u = raw?.trim();
    if (!u) return;
    const key = u.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(u);
  };
  push(rpcUrl);
  if (isMainnet) {
    push("https://rpc.mainnet.arc.io");
    push("https://rpc.arc.network/");
  } else {
    push("https://rpc.testnet.arc.network/");
  }
  return out;
}

let serverClient: ReturnType<typeof createPublicClient> | null = null;

export function arcServerPublicClient() {
  if (!serverClient) {
    const urls = arcServerRpcUrls();
    serverClient = createPublicClient({
      chain: arcViemChain,
      transport: fallback(urls.map((u) => http(u, { timeout: 12_000 }))),
    });
  }
  return serverClient;
}

export async function readArcReceiptStatus(
  txHash: string,
): Promise<"pending" | "success" | "reverted"> {
  const hash = txHash as Hash;
  const client = arcServerPublicClient();
  const receipt = await client.getTransactionReceipt({ hash });
  if (!receipt) return "pending";
  if (receipt.status === "success") return "success";
  return "reverted";
}
