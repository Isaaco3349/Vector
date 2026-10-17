"use client";

export function HeroSection() {
  return (
    <section className="vector-landing-hero relative w-full">
      <div className="mx-auto max-w-[var(--vector-max-content)] px-6 md:px-10 pt-12 md:pt-16 pb-10 md:pb-14">
        <p className="vector-hero-badge inline-flex items-center gap-2 mb-6">
          <span className="vector-hero-badge-dot" aria-hidden />
          USDC-native DeFi on Arc
        </p>
        <h1 className="text-[2.35rem] sm:text-[2.75rem] md:text-[3.25rem] lg:text-[3.5rem] font-semibold tracking-tight leading-[1.08] max-w-4xl mb-5">
          <span className="text-[var(--vector-text)]">Swap, bridge, and earn </span>
          <span className="text-[var(--vector-pink)]">all on Arc.</span>
        </h1>
        <p className="text-[16px] md:text-[17px] leading-relaxed text-[var(--vector-text-dim)] max-w-2xl mb-8">
          Vector is a home base for stablecoin DeFi on Circle&apos;s Arc network.
          Connect with Google or your own wallet — trade, move USDC cross-chain,
          and deposit into yield with fees shown before you sign.
        </p>
        <div className="flex flex-col sm:flex-row flex-wrap gap-3">
          <a href="#connect" className="vector-btn-primary">
            Get started
            <span aria-hidden>→</span>
          </a>
          <a href="#how-it-works" className="vector-btn-secondary">
            How it works
          </a>
        </div>
      </div>
    </section>
  );
}
