"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

type AppNav = {
  onSwap: () => void;
  onBridge: () => void;
  onEarn: () => void;
  onSend: () => void;
  onReceive: () => void;
  onHistory: () => void;
};

export function LandingNav({
  appNav,
  networkLabel,
  vectorMark,
}: {
  appNav: AppNav | null;
  networkLabel: string;
  vectorMark: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--vector-line)] bg-[var(--vector-bg)]/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[var(--vector-max-content)] items-center justify-between gap-4 px-6 py-3.5 md:px-10 md:py-4">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          {vectorMark}
          <span className="text-[16px] font-semibold tracking-tight">Vector</span>
        </Link>

        <nav
          className="hidden md:flex items-center gap-0.5 font-medium text-[14px]"
          aria-label="Primary"
        >
          {appNav ? (
            <>
              <NavBtn label="Swap" onClick={appNav.onSwap} />
              <NavBtn label="Bridge" onClick={appNav.onBridge} />
              <NavBtn label="Earn" onClick={appNav.onEarn} />
              <NavBtn label="Send" onClick={appNav.onSend} />
              <NavBtn label="Receive" onClick={appNav.onReceive} />
              <NavBtn label="Activity" onClick={appNav.onHistory} />
            </>
          ) : (
            <>
              <Anchor href="#features">Features</Anchor>
              <Anchor href="#how-it-works">How it works</Anchor>
              <Anchor href="#faq">FAQ</Anchor>
            </>
          )}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <span className="hidden sm:inline text-[11px] text-[var(--vector-text-dim)] font-mono">
            {networkLabel}
          </span>
          {!appNav && (
            <a href="#connect" className="vector-btn-primary !h-10 !px-4 !text-[13px] hidden sm:inline-flex">
              Connect
            </a>
          )}
          {!appNav && (
            <button
              type="button"
              className="md:hidden vector-btn-secondary !h-10 !w-10 !p-0 flex items-center justify-center"
              aria-expanded={open}
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "✕" : "☰"}
            </button>
          )}
        </div>
      </div>

      {!appNav && open && (
        <div className="md:hidden border-t border-[var(--vector-line)] bg-[var(--vector-surface)] px-6 py-4 flex flex-col gap-1">
          <MobileAnchor href="#features" onNavigate={() => setOpen(false)}>
            Features
          </MobileAnchor>
          <MobileAnchor href="#how-it-works" onNavigate={() => setOpen(false)}>
            How it works
          </MobileAnchor>
          <MobileAnchor href="#faq" onNavigate={() => setOpen(false)}>
            FAQ
          </MobileAnchor>
          <MobileAnchor href="#connect" onNavigate={() => setOpen(false)}>
            Connect
          </MobileAnchor>
          <p className="text-[11px] font-mono text-[var(--vector-text-dim)] pt-2 sm:hidden">
            {networkLabel}
          </p>
        </div>
      )}
    </header>
  );
}

function Anchor({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="vector-nav-link">
      {children}
    </a>
  );
}

function MobileAnchor({
  href,
  children,
  onNavigate,
}: {
  href: string;
  children: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <a href={href} className="vector-nav-link !block py-2.5" onClick={onNavigate}>
      {children}
    </a>
  );
}

function NavBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="vector-nav-link">
      {label}
    </button>
  );
}
