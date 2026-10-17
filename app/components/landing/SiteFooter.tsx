import Link from "next/link";
import type { ReactNode } from "react";

export function SiteFooter({
  githubMark,
  xMark,
  mailMark,
}: {
  githubMark: ReactNode;
  xMark: ReactNode;
  mailMark: ReactNode;
}) {
  return (
    <footer className="mt-auto border-t border-[var(--vector-line)] bg-[var(--vector-surface)]/40">
      <div className="mx-auto max-w-[var(--vector-max-content)] px-6 md:px-10 py-12 md:py-14">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-10">
          <div className="sm:col-span-2 lg:col-span-1">
            <p className="text-[15px] font-semibold mb-2">Vector</p>
            <p className="text-[13px] leading-relaxed text-[var(--vector-text-dim)] max-w-xs">
              USDC-native swap, bridge, and earn on Circle&apos;s Arc network.
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--vector-text-dim)] mb-3 font-semibold">
              Product
            </p>
            <ul className="space-y-2 text-[14px]">
              <li>
                <a
                  href="#features"
                  className="text-[var(--vector-text-dim)] hover:text-[var(--vector-pink)] transition-colors"
                >
                  Features
                </a>
              </li>
              <li>
                <a
                  href="#how-it-works"
                  className="text-[var(--vector-text-dim)] hover:text-[var(--vector-pink)] transition-colors"
                >
                  How it works
                </a>
              </li>
              <li>
                <a
                  href="#faq"
                  className="text-[var(--vector-text-dim)] hover:text-[var(--vector-pink)] transition-colors"
                >
                  FAQ
                </a>
              </li>
              <li>
                <a
                  href="#connect"
                  className="text-[var(--vector-text-dim)] hover:text-[var(--vector-pink)] transition-colors"
                >
                  Connect
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--vector-text-dim)] mb-3 font-semibold">
              Resources
            </p>
            <ul className="space-y-2 text-[14px]">
              <li>
                <Link
                  href="/terms"
                  className="text-[var(--vector-text-dim)] hover:text-[var(--vector-pink)] transition-colors"
                >
                  Terms
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy"
                  className="text-[var(--vector-text-dim)] hover:text-[var(--vector-pink)] transition-colors"
                >
                  Privacy
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--vector-text-dim)] mb-3 font-semibold">
              Contact
            </p>
            <div className="flex items-center gap-5">
              <SocialLink href="https://github.com/Isaaco3349/Vector" label="GitHub">
                {githubMark}
              </SocialLink>
              <SocialLink href="https://x.com/Vector_protocol" label="X">
                {xMark}
              </SocialLink>
              <SocialLink href="mailto:vectorprotocol7@gmail.com" label="Email">
                {mailMark}
              </SocialLink>
            </div>
          </div>
        </div>
        <div className="pt-8 border-t border-[var(--vector-line)] text-center sm:text-left text-[12px] text-[var(--vector-text-dim)]">
          <p>© {new Date().getFullYear()} Vector Protocol</p>
        </div>
      </div>
    </footer>
  );
}

function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  const isExternal = href.startsWith("http");
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="text-[var(--vector-text-dim)] hover:text-[var(--vector-pink)] transition-colors"
    >
      {children}
    </a>
  );
}
