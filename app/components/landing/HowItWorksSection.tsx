export function HowItWorksSection() {
  const steps = [
    {
      n: "1",
      title: "Connect",
      body: "Sign in with Google for a Circle wallet, or connect MetaMask, OKX, Binance Wallet, and other extensions. Vector runs on Arc mainnet.",
    },
    {
      n: "2",
      title: "Fund on Arc",
      body: "Arc uses USDC for gas. Bridge USDC from another network or hold USDC on Arc already. Your dashboard shows spendable balance before you swap, bridge, or earn.",
    },
    {
      n: "3",
      title: "Swap, bridge, earn",
      body: "Swap USDC and EURC on Arc, move USDC cross-chain with CCTP v2, or deposit into yield vaults. Routes and fees are shown before you confirm in your wallet.",
    },
  ] as const;

  return (
    <section id="how-it-works" className="scroll-mt-24 vector-landing-section-alt">
      <div className="mx-auto max-w-[var(--vector-max-content)] px-6 md:px-10 py-14 md:py-20">
      <p className="text-[12px] uppercase tracking-wider text-[var(--vector-text-dim)] mb-2 font-medium">
        How it works
      </p>
      <h2 className="text-[28px] md:text-[32px] font-semibold tracking-tight mb-3">
        Three steps to DeFi on Arc
      </h2>
      <p className="text-[15px] text-[var(--vector-text-dim)] mb-10 max-w-2xl leading-relaxed">
        Connect once, fund with USDC on Arc, then use swap, bridge, and earn from
        the same dashboard.
      </p>
      <ol className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
        {steps.map((step) => (
          <li
            key={step.n}
            className="vector-panel-border flex flex-col gap-3 p-6 bg-[var(--vector-surface)]/80 h-full"
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--vector-pink-dim)] text-[14px] font-semibold text-[var(--vector-pink)] font-mono"
              aria-hidden
            >
              {step.n}
            </span>
            <div>
              <h3 className="text-[16px] font-semibold mb-2">{step.title}</h3>
              <p className="text-[14px] leading-relaxed text-[var(--vector-text-dim)]">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
      </div>
    </section>
  );
}
