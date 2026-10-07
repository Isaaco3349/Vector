"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { VectorModalShell } from "./VectorModalShell";

/**
 * Receive panel — shows the wallet address as text + QR so funds can be sent in.
 *
 * Works for BOTH connection types: the address is passed in as a prop (the
 * Google-login / W3S address isn't in wagmi, so this component stays agnostic
 * and never assumes an injected wallet). Read-only — nothing is signed here.
 *
 * The QR sits on a white tile with padding so there's a proper quiet zone and
 * it scans reliably, without depending on a version-specific margin prop.
 *
 * NOTE: requires the `qrcode.react` package (npm i qrcode.react). It ships its
 * own TypeScript types, so no @types package is needed.
 */
export function ReceivePanel({
  address,
  networkLabel,
  onClose,
}: {
  address: string;
  networkLabel: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <VectorModalShell title="Receive USDC" onClose={onClose}>
        <div className="flex flex-col items-center">
          <div className="bg-white p-4 rounded-2xl mb-5">
            <QRCodeSVG
              value={address}
              size={180}
              bgColor="#ffffff"
              fgColor="#0b0b0e"
              level="M"
            />
          </div>

          <p className="text-[12px] text-[var(--vector-text-dim)] mb-2">
            Your address on{" "}
            <span className="font-mono text-[var(--vector-text)]">
              {networkLabel}
            </span>
          </p>

          <button
            onClick={copy}
            className="w-full rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] px-4 py-3 font-mono text-[13px] text-[var(--vector-text)] break-all hover:border-[var(--vector-pink)] transition-colors"
          >
            {address}
          </button>

          <button
            onClick={copy}
            className="mt-3 text-[12px] text-[var(--vector-pink)] hover:opacity-80 transition-opacity uppercase tracking-wide"
          >
            {copied ? "Copied" : "Copy address"}
          </button>
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-[var(--vector-text-dim)] text-center">
          Only send USDC on {networkLabel} to this address. Sending other assets
          or using the wrong network can lose funds.
        </p>
    </VectorModalShell>
  );
}
