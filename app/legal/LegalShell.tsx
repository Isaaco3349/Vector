import Link from "next/link";
import type { ReactNode } from "react";

export function LegalShell({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--vector-bg)] text-[var(--vector-text)]">
      <header className="border-b border-[var(--vector-line)] px-6 py-5">
        <div className="mx-auto max-w-[720px] flex items-center justify-between gap-4">
          <Link
            href="/"
            className="text-[15px] font-semibold text-[var(--vector-text)] hover:text-[var(--vector-pink)] transition-colors"
          >
            ← Vector
          </Link>
          <nav className="flex gap-4 text-[13px] text-[var(--vector-text-dim)]">
            <Link href="/terms" className="hover:text-[var(--vector-pink)]">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-[var(--vector-pink)]">
              Privacy
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[720px] px-6 py-10">
        <h1 className="text-[28px] font-semibold tracking-tight mb-2">{title}</h1>
        <p className="text-[13px] text-[var(--vector-text-dim)] mb-8 font-mono">
          Last updated: {lastUpdated}
        </p>
        <article className="legal-prose space-y-6 text-[15px] leading-relaxed text-[var(--vector-text-dim)]">
          {children}
        </article>
      </main>
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[17px] font-semibold text-[var(--vector-text)] mb-2">
        {heading}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
