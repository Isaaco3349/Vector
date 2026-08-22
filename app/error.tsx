"use client";

import { useEffect, type CSSProperties } from "react";

/**
 * Route-segment error boundary.
 *
 * The tester-reported "Failed to load chunk …" crash is a stale-deploy artifact:
 * after a new Vercel build, a tab still running the OLD page references hashed
 * chunk filenames that no longer exist, so the next lazy chunk fetch 404s and
 * React throws a ChunkLoadError. The correct fix is a single full reload, which
 * pulls the fresh chunk manifest. We auto-reload once (guarded so a chunk that
 * is genuinely gone can never loop), and for anything else show a calm branded
 * fallback with a manual reload + a retry that re-renders the segment.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError = isChunkLoadError(error);

  useEffect(() => {
    if (!isChunkError) return;
    // Reload at most once per short window, so a chunk that is truly missing
    // (not merely stale) surfaces the fallback UI instead of reloading forever.
    try {
      const KEY = "vector:chunk-reload-at";
      const last = Number(sessionStorage.getItem(KEY) ?? "0");
      const now = Date.now();
      if (!Number.isFinite(last) || now - last > 10_000) {
        sessionStorage.setItem(KEY, String(now));
        window.location.reload();
      }
    } catch {
      // sessionStorage blocked: still better to reload than sit on a dead
      // screen, but guard with a window flag so we can't loop in this document.
      const w = window as unknown as { __vectorChunkReloaded?: boolean };
      if (!w.__vectorChunkReloaded) {
        w.__vectorChunkReloaded = true;
        window.location.reload();
      }
    }
  }, [isChunkError]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--vector-bg)",
        color: "var(--vector-text)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380, textAlign: "center" }}>
        <div
          style={{
            margin: "0 auto 20px",
            width: 48,
            height: 48,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--vector-surface-raised)",
            border: "1px solid var(--vector-line)",
            color: "var(--vector-pink)",
            fontSize: 22,
          }}
        >
          ↻
        </div>
        <h1 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 8px" }}>
          {isChunkError
            ? "Updating to the latest version…"
            : "Something went wrong"}
        </h1>
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--vector-text-dim)",
            margin: "0 0 24px",
          }}
        >
          {isChunkError
            ? "Vector was just updated. Refreshing to load the newest version — none of your funds are affected."
            : "That view hit an unexpected error. No funds were moved. You can retry or reload the app."}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={() => reset()} style={secondaryBtn}>
            Try again
          </button>
          <button onClick={() => window.location.reload()} style={primaryBtn}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}

const primaryBtn: CSSProperties = {
  height: 44,
  padding: "0 22px",
  borderRadius: 999,
  border: "none",
  background: "var(--vector-pink)",
  color: "#0b0b0e",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtn: CSSProperties = {
  height: 44,
  padding: "0 22px",
  borderRadius: 999,
  border: "1px solid var(--vector-line)",
  background: "transparent",
  color: "var(--vector-text)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name ?? "";
  const message = (error as { message?: string }).message ?? "";
  if (name === "ChunkLoadError") return true;
  return /failed to load chunk|loading chunk|loading css chunk|error loading dynamically imported module/i.test(
    message,
  );
}
