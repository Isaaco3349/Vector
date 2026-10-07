"use client";

const SEGMENT = "Swap · Bridge · Earn · ";

/** Continuous horizontal ticker (PlayStation-style digital strip). */
export function DigitalMarquee({ className = "" }: { className?: string }) {
  const line = SEGMENT.repeat(6);
  return (
    <div
      className={`vector-marquee-wrap overflow-hidden border-y border-[var(--vector-line)] bg-[var(--vector-surface)]/80 ${className}`}
      aria-hidden
    >
      <div className="vector-marquee-track flex w-max">
        <span className="vector-marquee-line">{line}</span>
        <span className="vector-marquee-line" aria-hidden>
          {line}
        </span>
      </div>
    </div>
  );
}
