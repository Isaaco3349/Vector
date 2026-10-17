const STATS = [
  { value: "Arc", label: "Native network" },
  { value: "USDC", label: "Gas & settlement" },
  { value: "CCTP v2", label: "Cross-chain bridge" },
  { value: "3+", label: "Swap route sources" },
] as const;

export function StatsStrip() {
  return (
    <section className="vector-stats-strip border-y border-[var(--vector-line)]">
      <div className="mx-auto max-w-[var(--vector-max-content)] px-6 md:px-10 py-8 md:py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {STATS.map((s) => (
            <div key={s.label} className="text-center md:text-left">
              <p className="text-[22px] md:text-[26px] font-semibold text-[var(--vector-pink)] tracking-tight mb-1">
                {s.value}
              </p>
              <p className="text-[11px] md:text-[12px] uppercase tracking-wider text-[var(--vector-text-dim)] font-medium">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
