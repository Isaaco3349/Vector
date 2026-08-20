/**
 * Transaction history + txHash resolution for the Google-login (Circle
 * user-controlled / W3S) wallet.
 *
 * WHY THIS EXISTS: a W3S CREATE_TRANSACTION challenge (used by transfer and
 * contractExecution — i.e. Send, Swap, Bridge, Earn) resolves its completion
 * callback with a plain `ChallengeResult = {type, status}` and NO txHash.
 * (Only a SIGN_TRANSACTION challenge returns `data.txHash`.) Verified against
 * the installed @circle-fin/w3s-pw-web-sdk@1.1.11 types. So after a challenge
 * completes, the on-chain hash — and any past activity — can only be read from
 * Circle's transactions list.
 *
 * Everything here is READ-ONLY (a GET behind our /api/endpoints proxy), so it
 * moves no funds and nothing here is address/amount sensitive. It's also
 * DEFENSIVE by design: Circle's transaction shape can't be verified against
 * first-party docs in this environment, so every field is parsed optionally and
 * every failure is non-fatal — callers always have the explorer address page
 * (see explorerAddressUrl) as an always-correct fallback.
 */

/** A single transaction, parsed defensively — any field may be absent. */
export type W3sTx = {
  id: string | null;
  txHash: string | null;
  /** INITIATED | QUEUED | SENT | CONFIRMED | COMPLETE | FAILED | CANCELLED | ... */
  state: string | null;
  /** TRANSFER | CONTRACTEXECUTION | ... */
  operation: string | null;
  /** INBOUND | OUTBOUND | ... */
  transactionType: string | null;
  /** First element of Circle's `amounts` array, if present. */
  amount: string | null;
  tokenId: string | null;
  sourceAddress: string | null;
  destinationAddress: string | null;
  contractAddress: string | null;
  /** e.g. "ARC-TESTNET". */
  blockchain: string | null;
  /** ISO timestamp string, if present. */
  createDate: string | null;
  /** The untouched original object, for anything not surfaced above. */
  raw: Record<string, unknown>;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function parseTx(obj: unknown): W3sTx {
  const o = (obj && typeof obj === "object" ? obj : {}) as Record<
    string,
    unknown
  >;
  const amounts = Array.isArray(o.amounts) ? o.amounts : null;
  const firstAmount =
    amounts && amounts.length > 0 ? str(amounts[0]) : str(o.amount);
  return {
    id: str(o.id),
    txHash: str(o.txHash),
    state: str(o.state),
    operation: str(o.operation),
    transactionType: str(o.transactionType),
    amount: firstAmount,
    tokenId: str(o.tokenId),
    sourceAddress: str(o.sourceAddress),
    destinationAddress: str(o.destinationAddress),
    contractAddress: str(o.contractAddress),
    blockchain: str(o.blockchain),
    createDate: str(o.createDate),
    raw: o,
  };
}

/** Newest-first: sort by createDate desc, keeping input order for ties/missing. */
function sortNewestFirst(txs: W3sTx[]): W3sTx[] {
  return txs
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const ta = a.t.createDate ? Date.parse(a.t.createDate) : NaN;
      const tb = b.t.createDate ? Date.parse(b.t.createDate) : NaN;
      const va = Number.isNaN(ta) ? -Infinity : ta;
      const vb = Number.isNaN(tb) ? -Infinity : tb;
      if (vb !== va) return vb - va;
      return a.i - b.i; // stable
    })
    .map(({ t }) => t);
}

/**
 * Fetch recent transactions for a W3S wallet, newest-first. Returns [] on any
 * error (never throws) so a history view can degrade to an explorer link.
 */
export async function fetchRecentTransactions(params: {
  userToken: string;
  walletId: string;
  pageSize?: number;
  signal?: AbortSignal;
}): Promise<W3sTx[]> {
  const { userToken, walletId, pageSize, signal } = params;
  try {
    const response = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "listTransactions",
        userToken,
        walletId,
        pageSize: pageSize ?? 20,
      }),
      signal,
    });
    if (!response.ok) return [];
    const data = await response.json();
    const list = Array.isArray(data?.transactions)
      ? data.transactions
      : Array.isArray(data)
        ? data
        : [];
    return sortNewestFirst(list.map(parseTx));
  } catch {
    return [];
  }
}

/**
 * After a challenge completes, poll for the on-chain hash of the transaction it
 * created. Returns the newest transaction's hash once Circle assigns one, or
 * null if it hasn't appeared within the timeout (caller falls back to the
 * explorer address page). Non-fatal by design.
 *
 * Newest-by-createDate is the right target: our multi-step flows (approve →
 * execute/burn/deposit) create the execute call LAST, so the newest tx is the
 * meaningful one to link. We wait specifically for THAT tx's hash rather than
 * grabbing any older hash (e.g. the approve's).
 */
export async function waitForTxHash(params: {
  userToken: string;
  walletId: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<string | null> {
  const { userToken, walletId } = params;
  const timeoutMs = params.timeoutMs ?? 12000;
  const intervalMs = params.intervalMs ?? 2000;
  const deadline = Date.now() + timeoutMs;

  // A tiny initial delay: Circle broadcasts right as the challenge resolves, so
  // the hash is usually assigned a beat later.
  await sleep(Math.min(1200, intervalMs));

  while (Date.now() < deadline) {
    const txs = await fetchRecentTransactions({
      userToken,
      walletId,
      pageSize: 5,
    });
    const newest = txs[0];
    if (newest?.txHash) return newest.txHash;
    await sleep(intervalMs);
  }

  // One last read after the loop, in case the hash landed on the final tick.
  const finalTxs = await fetchRecentTransactions({
    userToken,
    walletId,
    pageSize: 5,
  });
  return finalTxs[0]?.txHash ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
