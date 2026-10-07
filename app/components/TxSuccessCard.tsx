"use client";

/** Post-tx success — hash + explorer link; hides validation noise underneath. */
export function TxSuccessCard({
  title,
  txHash,
  explorerUrl,
  subtitle,
  onDismiss,
}: {
  title: string;
  txHash: string;
  explorerUrl: string | null;
  subtitle?: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="mb-4 rounded-2xl border border-[var(--vector-pink)]/40 bg-[var(--vector-surface-raised)] p-4"
      role="status"
    >
      <p className="text-[15px] font-semibold text-[var(--vector-text)] mb-1">
        {title}
      </p>
      {subtitle && (
        <p className="text-[12px] text-[var(--vector-text-dim)] leading-relaxed mb-3">
          {subtitle}
        </p>
      )}
      <p className="text-[11px] font-mono text-[var(--vector-text-dim)] break-all mb-3">
        {txHash}
      </p>
      {explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[13px] text-[var(--vector-pink)] font-semibold underline"
        >
          View on explorer ↗
        </a>
      ) : null}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-4 w-full h-10 rounded-full border border-[var(--vector-line)] text-[13px] font-semibold text-[var(--vector-text-dim)] hover:border-[var(--vector-pink)] transition-colors"
        >
          Done
        </button>
      )}
    </div>
  );
}
