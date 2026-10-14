"use client";

import { useState } from "react";

const FAQ_ITEMS = [
  {
    q: "Which network does Vector use?",
    a: "Vector targets Circle's Arc network. Swaps and earn run on Arc. Bridging uses Circle CCTP v2 between Arc and supported EVM chains.",
  },
  {
    q: "Do I need ETH for gas?",
    a: "No. On Arc, transaction fees are paid in USDC. Keep a small USDC balance for gas in addition to the amount you swap, bridge, or deposit.",
  },
  {
    q: "What wallets are supported?",
    a: "Google sign-in creates a Circle wallet in the browser. You can also connect external wallets such as MetaMask, OKX, and Binance Wallet through WalletConnect or injected providers.",
  },
  {
    q: "How are swap routes chosen?",
    a: "USDC and EURC on Arc default to Circle pricing for speed. You can compare Circle, Kyber, and LI.FI routes before confirming. Other pairs use aggregators that support Arc liquidity.",
  },
  {
    q: "How long does bridging take?",
    a: "You sign a burn on the source chain. Circle's relayer mints USDC on the destination. Most routes complete in a few minutes depending on source chain confirmation time.",
  },
] as const;

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="scroll-mt-28">
      <p className="text-[12px] uppercase tracking-wide text-[var(--vector-text-dim)] mb-2">
        FAQ
      </p>
      <h2 className="text-[26px] lg:text-[28px] font-semibold tracking-tight mb-6">
        Common questions
      </h2>
      <div className="space-y-3">
        {FAQ_ITEMS.map((item, i) => {
          const expanded = open === i;
          return (
            <div key={item.q} className="vector-panel-border overflow-hidden bg-[var(--vector-surface)]/60">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : i)}
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-[15px] font-semibold hover:bg-[var(--vector-surface-raised)]/40 transition-colors"
                aria-expanded={expanded}
              >
                {item.q}
                <span
                  className="text-[var(--vector-text-dim)] text-[18px] leading-none shrink-0"
                  aria-hidden
                >
                  {expanded ? "−" : "+"}
                </span>
              </button>
              {expanded && (
                <p className="px-5 pb-4 text-[14px] leading-relaxed text-[var(--vector-text-dim)] border-t border-[var(--vector-line)] pt-3">
                  {item.a}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
