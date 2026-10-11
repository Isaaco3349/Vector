"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ARC_SWAP_TOKENS } from "../lib/swap-tokens";

/**
 * Touch-friendly token picker — native `<select>` is broken in many OKX / mobile WebViews.
 */
export function TokenPicker({
  value,
  onChange,
  noteFor,
}: {
  value: string;
  onChange: (v: string) => void;
  noteFor?: (symbol: string) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative z-30 shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="min-h-[44px] bg-[var(--vector-surface)] border border-[var(--vector-line)] rounded-full px-4 py-2 text-[13px] font-semibold text-[var(--vector-text)] outline-none hover:border-[var(--vector-pink)] active:border-[var(--vector-pink)] transition-colors touch-manipulation"
      >
        {value}
        <span className="ml-1 text-[var(--vector-text-dim)]" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Token"
          className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[160px] rounded-2xl border border-[var(--vector-line)] bg-[var(--vector-surface)] py-1 shadow-lg shadow-black/40"
        >
          {ARC_SWAP_TOKENS.map((t) => {
            const note = noteFor?.(t.symbol) ?? null;
            const selected = t.symbol === value;
            return (
              <li key={t.symbol} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(t.symbol);
                    setOpen(false);
                  }}
                  className={`w-full min-h-[44px] px-4 py-2.5 text-left text-[14px] font-semibold touch-manipulation hover:bg-[var(--vector-surface-raised)] ${
                    selected ? "text-[var(--vector-pink)]" : "text-[var(--vector-text)]"
                  }`}
                >
                  {t.symbol}
                  {note ? (
                    <span className="ml-1 text-[11px] font-normal text-[var(--vector-text-dim)]">
                      ({note})
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
