"use client";

import { useEffect } from "react";

/**
 * Root error boundary (production only). Replaces the entire layout, so it can't
 * rely on globals.css — colors are inlined. Same job as app/error.tsx: quietly
 * reload once on a stale-deploy chunk error, otherwise show a calm fallback.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError = isChunkLoadError(error);

  useEffect(() => {
    if (!isChunkError) return;
    try {
      const KEY = "vector:chunk-reload-at";
      const last = Number(sessionStorage.getItem(KEY) ?? "0");
      const now = Date.now();
      if (!Number.isFinite(last) || now - last > 10_000) {
        sessionStorage.setItem(KEY, String(now));
        window.location.reload();
      }
    } catch {
      const w = window as unknown as { __vectorChunkReloaded?: boolean };
      if (!w.__vectorChunkReloaded) {
        w.__vectorChunkReloaded = true;
        window.location.reload();
      }
    }
  }, [isChunkError]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#0b0b0e",
          color: "#f5f3f7",
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
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
              background: "#1e1c24",
              border: "1px solid #2a2830",
              color: "#ff3d81",
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
              color: "#9b98a3",
              margin: "0 0 24px",
            }}
          >
            {isChunkError
              ? "Vector was just updated. Refreshing to load the newest version — none of your funds are affected."
              : "Vector hit an unexpected error. No funds were moved. Reload to continue."}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              onClick={() => reset()}
              style={{
                height: 44,
                padding: "0 22px",
                borderRadius: 999,
                border: "1px solid #2a2830",
                background: "transparent",
                color: "#f5f3f7",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                height: 44,
                padding: "0 22px",
                borderRadius: 999,
                border: "none",
                background: "#ff3d81",
                color: "#0b0b0e",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}

function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name ?? "";
  const message = (error as { message?: string }).message ?? "";
  if (name === "ChunkLoadError") return true;
  return /failed to load chunk|loading chunk|loading css chunk|error loading dynamically imported module/i.test(
    message,
  );
}
