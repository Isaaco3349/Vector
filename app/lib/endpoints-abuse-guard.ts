import { NextResponse } from "next/server";

/** Default browser origins allowed to call POST /api/endpoints. */
const DEFAULT_ALLOWED_ORIGINS = [
  "https://vectorprotocol.pro",
  "https://www.vectorprotocol.pro",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const WINDOW_MS = 60_000;

function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Reject cross-site browser abuse. Same-origin app requests send Origin
 * (or Referer); server-side scripts must set one of these headers.
 */
export function rejectIfDisallowedOrigin(
  request: Request,
): NextResponse | null {
  const allowed = parseAllowedOrigins().map(normalizeOrigin).filter(Boolean) as string[];
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");

  let requestOrigin: string | null = null;
  if (originHeader) {
    requestOrigin = normalizeOrigin(originHeader);
  } else if (refererHeader) {
    requestOrigin = normalizeOrigin(refererHeader);
  }

  if (!requestOrigin || !allowed.includes(requestOrigin)) {
    return NextResponse.json(
      {
        error:
          "This API only accepts requests from the Vector app origin. If you are developing locally, use http://localhost:3000.",
        code: "ORIGIN_NOT_ALLOWED",
      },
      { status: 403 },
    );
  }

  return null;
}

/** Client IP for rate limiting (Vercel sets x-forwarded-for). */
export function clientIpFromRequest(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

type RateBucket = "device" | "kit" | "default";

function envLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const BUCKET_LIMITS: Record<RateBucket, () => number> = {
  device: () => envLimit("RATE_LIMIT_DEVICE_PER_MINUTE", 10),
  kit: () => envLimit("RATE_LIMIT_KIT_PER_MINUTE", 40),
  default: () => envLimit("RATE_LIMIT_DEFAULT_PER_MINUTE", 30),
};

export function rateLimitBucketForAction(action: string): RateBucket {
  if (action === "createDeviceToken") return "device";
  if (
    action === "createSwapTransaction" ||
    action === "createEarnDeposit" ||
    action === "createEarnWithdraw" ||
    action === "createContractExecutionChallenge"
  ) {
    return "kit";
  }
  return "default";
}

type SlidingEntry = { timestamps: number[] };

/** Per-instance sliding window (Vercel serverless — not global, but raises the bar). */
const slidingWindows = new Map<string, SlidingEntry>();

function slidingWindowKey(ip: string, bucket: RateBucket): string {
  return `${ip}:${bucket}`;
}

export function rejectIfRateLimited(
  request: Request,
  action: string,
): NextResponse | null {
  const bucket = rateLimitBucketForAction(action);
  const limit = BUCKET_LIMITS[bucket]();
  const ip = clientIpFromRequest(request);
  const key = slidingWindowKey(ip, bucket);
  const now = Date.now();

  let entry = slidingWindows.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    slidingWindows.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);

  if (entry.timestamps.length >= limit) {
    return NextResponse.json(
      {
        error: `Too many requests. Please wait a minute and try again. (limit: ${limit} per minute for this action type)`,
        code: "RATE_LIMITED",
      },
      { status: 429 },
    );
  }

  entry.timestamps.push(now);
  return null;
}
