import { NextResponse } from "next/server";
import { readArcReceiptStatus } from "../../lib/arc-public-rpc-server";
import {
  rejectIfDisallowedOrigin,
  rejectIfRateLimited,
} from "../../lib/endpoints-abuse-guard";

export async function POST(request: Request) {
  const originBlock = rejectIfDisallowedOrigin(request);
  if (originBlock) return originBlock;

  const rateBlock = rejectIfRateLimited(request, "arc-receipt");
  if (rateBlock) return rateBlock;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const txHash = (body as { txHash?: unknown }).txHash;
  if (typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "Invalid txHash." }, { status: 400 });
  }

  try {
    const status = await readArcReceiptStatus(txHash);
    return NextResponse.json({ status }, { status: 200 });
  } catch (err) {
    console.error("[Vector] arc-receipt failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not read Arc receipt.",
        status: "error" as const,
      },
      { status: 502 },
    );
  }
}
