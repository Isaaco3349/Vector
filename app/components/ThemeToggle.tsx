"use client";

import { useEffect, useState } from "react";
import {
  applyVectorTheme,
  readStoredTheme,
  storeTheme,
  type VectorTheme,
} from "../lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<VectorTheme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = readStoredTheme();
    const initial = stored ?? "dark";
    setTheme(initial);
    applyVectorTheme(initial);
    setMounted(true);
  }, []);

  function toggle() {
    setTheme((prev) => {
      const next: VectorTheme = prev === "dark" ? "light" : "dark";
      applyVectorTheme(next);
      storeTheme(next);
      return next;
    });
  }

  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      title={isLight ? "Dark mode" : "Light mode"}
      className="fixed bottom-6 right-6 z-[60] flex h-11 w-11 items-center justify-center rounded-full border border-[var(--vector-line)] bg-[var(--vector-surface)] text-[var(--vector-text)] shadow-lg shadow-black/10 hover:border-[var(--vector-pink)] transition-colors"
    >
      {!mounted ? (
        <span className="w-5 h-5" aria-hidden />
      ) : isLight ? (
        <MoonIcon />
      ) : (
        <SunIcon />
      )}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75" />
      <path
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 14.5A7.5 7.5 0 0 1 9.5 4 6.5 6.5 0 1 0 20 14.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}
