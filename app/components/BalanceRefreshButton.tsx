"use client";

export function BalanceRefreshButton({
  onClick,
  refreshing,
  compact,
}: {
  onClick: () => void | Promise<void>;
  refreshing?: boolean;
  /** Smaller control for wallet card header. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={refreshing}
      aria-label={refreshing ? "Refreshing balances" : "Refresh balances"}
      title={refreshing ? "Refreshing…" : "Refresh balances"}
      className={
        compact
          ? "vector-balance-refresh-btn vector-balance-refresh-btn--compact disabled:opacity-50"
          : "vector-modal-close !min-w-0 px-3 disabled:opacity-50"
      }
    >
      {refreshing ? "Refreshing…" : compact ? "Refresh" : "Refresh"}
    </button>
  );
}
