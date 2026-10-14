"use client";

import { fetchVectorApi } from "./okx-mobile-fetch";

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
    const res = await fetchVectorApi("/api/arc-balances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
      cache: "no-store",
    });
    const data = (await res.json()) as ArcBalancesSnapshot & { error?: string };
    if (!res.ok) return null;
    return data;
  } catch {
    return null;
  }
}
