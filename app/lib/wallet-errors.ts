/**
 * Turn wallet / viem / SDK failures into short, human copy — never raw calldata dumps.
 */

const USER_REJECTION =
  /user rejected|rejected the request|request rejected|denied transaction|denied signature|user denied|user cancel|action_rejected|4001/i;

const OKX_BLOCK =
  /risky|signature type|blocked to protect/i;

/** Walk Error.cause (and nested details) for classification text. */
export function errorTextBlob(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  let depth = 0;
  while (cur != null && depth < 6) {
    if (typeof cur === "string") {
      parts.push(cur);
      break;
    }
    if (cur instanceof Error) {
      if (cur.message) parts.push(cur.message);
      cur = cur.cause;
    } else if (typeof cur === "object") {
      const rec = cur as Record<string, unknown>;
      if (typeof rec.message === "string") parts.push(rec.message);
      if (typeof rec.details === "string") parts.push(rec.details);
      if (typeof rec.shortMessage === "string") parts.push(rec.shortMessage);
      cur = rec.cause;
    } else {
      break;
    }
    depth++;
  }
  return parts.join("\n");
}

export function isWalletUserRejection(text: string): boolean {
  return USER_REJECTION.test(text);
}

/** Drop viem/ethers-style debug blocks (Request Arguments, hex data, version footers). */
export function sanitizeWalletDetail(raw: string): string {
  let s = raw.trim();
  const cutPatterns = [
    /\n\nRequest Arguments:[\s\S]*/i,
    /\nRequest Arguments:[\s\S]*/i,
    /\n\nDetails:\s*Version: viem[\s\S]*/i,
    /\nContract Call:[\s\S]*/i,
    /\nRaw Call Arguments:[\s\S]*/i,
    /\n\nDocs: https:\/\/viem\.sh[\s\S]*/i,
  ];
  for (const re of cutPatterns) {
    s = s.replace(re, "").trim();
  }
  // Prefer the last short clause after colons when the prefix is SDK noise.
  const rejected = s.match(/user rejected the request\.?/i);
  if (rejected) return "User rejected the request.";

  if (s.length > 140) {
    const firstLine = s.split("\n").find((line) => line.trim().length > 0) ?? s;
    s = firstLine.length <= 140 ? firstLine.trim() : `${firstLine.trim().slice(0, 137)}…`;
  }
  return s;
}

/** Bridge panel: thrown errors (catch). */
export function friendlyWalletError(err: unknown, fallback: string): string {
  const blob = errorTextBlob(err);

  if (OKX_BLOCK.test(blob)) {
    return (
      "Your wallet blocked this as a security precaution (common with OKX on Arc). " +
      "Try MetaMask, WalletConnect, or Continue with Google — or use Arc Portal for OKX."
    );
  }
  if (isWalletUserRejection(blob)) {
    return "You cancelled in your wallet. Nothing was sent.";
  }
  if (/insufficient/i.test(blob)) {
    return "Insufficient balance for this amount (including fees).";
  }
  if (/forwarder|relayer/i.test(blob)) {
    return "Circle's relayer is busy for this route. Try again shortly.";
  }

  const fromMessage =
    err instanceof Error && err.message
      ? sanitizeWalletDetail(err.message)
      : typeof err === "string"
        ? sanitizeWalletDetail(err)
        : "";
  if (fromMessage && !/^(unknown|error)$/i.test(fromMessage)) {
    return `Bridge didn't complete. ${fromMessage}`;
  }
  return fallback;
}

/** Bridge panel: App Kit returned state:error with a detail string. */
export function friendlyBridgeFailureMessage(
  detail: string | null,
  opts: { burnSubmitted: boolean; fromChainLabel: string },
): string {
  const raw = detail?.trim() ?? "";
  const blob = raw;

  if (isWalletUserRejection(blob)) {
    if (opts.burnSubmitted) {
      return `You cancelled in your wallet after a step on ${opts.fromChainLabel}. Check your wallet activity before retrying.`;
    }
    return "You cancelled in your wallet. Nothing was sent.";
  }

  if (OKX_BLOCK.test(blob)) {
    return (
      "Your wallet blocked this as a security precaution (common with OKX on Arc). " +
      "Try MetaMask, WalletConnect, or Continue with Google — or use Arc Portal for OKX."
    );
  }

  const short = raw ? sanitizeWalletDetail(raw) : "";

  if (opts.burnSubmitted) {
    return short
      ? `The burn was sent on ${opts.fromChainLabel} but the bridge didn't finish: ${short} Check the transaction below before retrying.`
      : `The burn was sent on ${opts.fromChainLabel} but the bridge didn't finish. Check the transaction below before retrying.`;
  }

  if (!short) {
    return "Bridge didn't complete. Nothing was sent — your balance should be unchanged.";
  }

  return `Bridge didn't complete. ${short}`;
}
