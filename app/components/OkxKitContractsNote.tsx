"use client";

import { useMemo } from "react";
import { getArcKitContracts } from "../lib/arc-kit-contracts";

/** Explains why swap/earn hit different contracts than bridge (OKX risk context). */
export function OkxKitContractsNote() {
  const contracts = useMemo(() => getArcKitContracts(), []);
  const adapter = contracts.adapter;
  const bridge = contracts.bridge;

  return (
    <div className="mt-3 rounded-xl border border-[var(--vector-line)] bg-[var(--vector-surface-raised)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--vector-text-dim)]">
      <span className="font-semibold text-[var(--vector-text)]">OKX on swap/earn:</span>{" "}
      Vector uses plain transaction confirms only. Swap and yield interact with
      Circle&apos;s{" "}
      <span className="font-mono">Adapter</span>
      {adapter ? (
        <>
          {" "}
          (<span className="break-all">{adapter}</span>)
        </>
      ) : null}
      , not the CCTP <span className="font-mono">Bridge</span>
      {bridge ? (
        <>
          {" "}
          (<span className="break-all">{bridge}</span>)
        </>
      ) : null}{" "}
      contract that OKX bridge already approved. You should see two steps when
      needed: token approve, then swap/deposit.
    </div>
  );
}
