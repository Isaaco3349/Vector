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
    <section id="how-it-works" className="scroll-mt-28">
      <p className="text-[12px] uppercase tracking-wide text-[var(--vector-text-dim)] mb-2">
        How it works
      </p>
      <h2 className="text-[26px] lg:text-[28px] font-semibold tracking-tight mb-6">
        Three steps to DeFi on Arc
      </h2>
      <ol className="space-y-4">
        {steps.map((step) => (
          <li
            key={step.n}
            className="vector-panel-border flex gap-4 p-5 bg-[var(--vector-surface)]/60"
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--vector-pink-dim)] text-[14px] font-semibold text-[var(--vector-pink)] font-mono"
              aria-hidden
            >
              {step.n}
            </span>
            <div>
              <h3 className="text-[15px] font-semibold mb-1.5">{step.title}</h3>
              <p className="text-[14px] leading-relaxed text-[var(--vector-text-dim)]">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
