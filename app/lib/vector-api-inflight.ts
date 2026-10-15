/** Coalesce identical in-flight Vector API POSTs (OKX WebView often double-fires effects). */
const inflight = new Map<string, Promise<Response>>();

export function dedupePostJson(
  dedupeKey: string,
  run: () => Promise<Response>,
): Promise<Response> {
  const existing = inflight.get(dedupeKey);
  if (existing) return existing;

  const promise = run().finally(() => {
    if (inflight.get(dedupeKey) === promise) {
      inflight.delete(dedupeKey);
    }
  });
  inflight.set(dedupeKey, promise);
  return promise;
}
