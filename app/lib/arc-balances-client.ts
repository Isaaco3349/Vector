"use client";

import { fetchVectorApi } from "./okx-mobile-fetch";
import { dedupePostJson } from "./vector-api-inflight";

export type ArcBalancesSnapshot = {
  nativeWei: string;
  usdcErc20Minor: string;
  cirBtcMinor: string;
  eurcMinor: string;
  cirBtcHuman: string;
  eurcHuman: string;
};

export async function fetchArcBalances(
  address: `0x${string}`,
): Promise<ArcBalancesSnapshot | null> {
  try {
    const bodyJson = JSON.stringify({ address });
    const res = await dedupePostJson(`arc-balances:${address}`, () =>
      fetchVectorApi("/api/arc-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyJson,
        cache: "no-store",
      }),
    );
    const data = (await res.json()) as ArcBalancesSnapshot & { error?: string };
    if (!res.ok) return null;
    return data;
  } catch {
    return null;
  }
}
