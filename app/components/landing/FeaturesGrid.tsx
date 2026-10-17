const FEATURES = [
  {
    title: "Swap",
    body: "Same-chain USDC ↔ EURC on Arc through Circle, with optional Kyber and LI.FI route comparison before you confirm.",
  },
  {
    title: "Bridge",
    body: "Move USDC with Circle CCTP v2. Burn on the source chain and mint on Arc, Base, Ethereum, and other supported networks.",
  },
  {
    title: "Earn",
    body: "Deposit USDC into yield vaults on Arc. Withdraw when you need liquidity. Google and external wallets supported.",
  },
  {
    title: "Send & receive",
    body: "Transfer USDC on Arc with your connected wallet. Receive with a shareable address and clear network labeling.",
  },
] as const;

export function FeaturesGrid() {
  return (
    <section id="features" className="scroll-mt-24 vector-landing-section">
      <div className="mx-auto max-w-[var(--vector-max-content)] px-6 md:px-10 py-14 md:py-20">
        <p className="text-[12px] uppercase tracking-wider text-[var(--vector-text-dim)] mb-2 font-medium">
          Product
        </p>
        <h2 className="text-[28px] md:text-[32px] font-semibold tracking-tight mb-3 max-w-xl">
          Everything you need on one chain
        </h2>
        <p className="text-[15px] text-[var(--vector-text-dim)] max-w-2xl mb-10 leading-relaxed">
          Arc uses USDC for gas, so one balance covers fees and transfers. Vector
          keeps actions in the header once you connect.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="vector-panel-border bg-[var(--vector-surface)]/70 p-6 md:p-7 h-full"
            >
              <h3 className="text-[17px] font-semibold mb-2.5">{f.title}</h3>
              <p className="text-[14px] leading-relaxed text-[var(--vector-text-dim)]">
                {f.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
