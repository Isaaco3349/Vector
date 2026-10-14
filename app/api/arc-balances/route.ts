import { NextResponse } from "next/server";
import { erc20Abi, formatUnits } from "viem";
import {
  AGGREGATOR_CIRBTC_MAINNET,
  AGGREGATOR_EURC_MAINNET,
} from "../../lib/aggregator-swap/tokens";
import { arcServerPublicClient } from "../../lib/arc-public-rpc-server";
import {
  rejectIfDisallowedOrigin,
  rejectIfRateLimited,
} from "../../lib/endpoints-abuse-guard";
import { arcUsdcAddress, isMainnet } from "../../lib/network";

export async function POST(request: Request) {
  const originBlock = rejectIfDisallowedOrigin(request);
  if (originBlock) return originBlock;

  const rateBlock = rejectIfRateLimited(request, "arc-balances");
  if (rateBlock) return rateBlock;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const address = (body as { address?: unknown }).address;
  if (typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  }

  const owner = address as `0x${string}`;
  const client = arcServerPublicClient();

  try {
    const [nativeWei, usdcErc20, cirBtc, eurc] = await Promise.all([
      client.getBalance({ address: owner }),
      client.readContract({
        address: arcUsdcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      isMainnet
        ? client.readContract({
            address: AGGREGATOR_CIRBTC_MAINNET,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [owner],
          })
        : Promise.resolve(BigInt(0)),
      isMainnet
        ? client.readContract({
            address: AGGREGATOR_EURC_MAINNET,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [owner],
          })
        : Promise.resolve(BigInt(0)),
    ]);

    return NextResponse.json({
      nativeWei: nativeWei.toString(),
      usdcErc20Minor: usdcErc20.toString(),
      cirBtcMinor: cirBtc.toString(),
      eurcMinor: eurc.toString(),
      cirBtcHuman: formatUnits(cirBtc, 8),
      eurcHuman: formatUnits(eurc, 6),
    });
  } catch (err) {
    console.error("[Vector] arc-balances failed:", err);
    return NextResponse.json(
      { error: "Could not read Arc balances." },
      { status: 502 },
    );
  }
}
