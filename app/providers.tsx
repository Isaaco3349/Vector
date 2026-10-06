"use client";

import { useEffect, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "./wagmi-config";
import { ThemeToggle } from "./components/ThemeToggle";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  // Belt-and-suspenders for the stale-deploy "Failed to load chunk" crash.
  // app/error.tsx + app/global-error.tsx catch chunk errors thrown during
  // render; this catches the async path — a lazy import() (Swap/Bridge load
  // their SDKs this way) whose chunk 404s after a redeploy and rejects outside
  // React. On a chunk error we reload once, guarded so it can never loop.
  useEffect(() => {
    function looksLikeChunkError(value: unknown): boolean {
      const name =
        value && typeof value === "object"
          ? String((value as { name?: unknown }).name ?? "")
          : "";
      const message =
        value && typeof value === "object"
          ? String((value as { message?: unknown }).message ?? "")
          : typeof value === "string"
            ? value
            : "";
      if (name === "ChunkLoadError") return true;
      return /failed to load chunk|loading chunk|loading css chunk|error loading dynamically imported module/i.test(
        message,
      );
    }

    function reloadOnce() {
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
    }

    function onError(event: ErrorEvent) {
      if (
        looksLikeChunkError(event.error) ||
        looksLikeChunkError(event.message)
      ) {
        reloadOnce();
      }
    }
    function onRejection(event: PromiseRejectionEvent) {
      if (looksLikeChunkError(event.reason)) reloadOnce();
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
        <ThemeToggle />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
