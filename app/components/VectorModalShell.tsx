"use client";

import type { ReactNode } from "react";

/**
 * Full-screen overlay with a sheet that fits mobile / in-app wallet browsers
 * (OKX): sticky header + scrollable body so Close is always reachable.
 */
export function VectorModalShell({
  onClose,
  title,
  header,
  children,
}: {
  onClose: () => void;
  title?: string;
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="vector-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="vector-modal-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vector-modal-header">
          <div className="vector-modal-header-row">
            {header ?? (
              <>
                <span className="text-[17px] font-semibold truncate pr-3">
                  {title}
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  className="vector-modal-close"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </header>
        <div className="vector-modal-body">{children}</div>
      </div>
    </div>
  );
}
