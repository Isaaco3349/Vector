import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { fetchWalletActivityAcrossChains } from "../../lib/wallet-activity-fetch";

export const dynamic = "force-dynamic";

/**
 * Read-only aggregated activity for an injected wallet (explorer APIs).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address")?.trim() ?? "";
  if (!isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const chainIdsParam = searchParams.get("chainIds");
  const chainIds = chainIdsParam
    ? chainIdsParam
        .split(",")
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n))
    : undefined;

  const items = await fetchWalletActivityAcrossChains({
    address,
    chainIds,
    perChainLimit: 12,
  });

  return NextResponse.json({ items });
}
