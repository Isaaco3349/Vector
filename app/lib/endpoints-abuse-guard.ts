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

const VECTOR_HOSTS = new Set([
  "vectorprotocol.pro",
  "www.vectorprotocol.pro",
  "localhost",
  "127.0.0.1",
]);

function vectorHostFromRequest(request: Request): string | null {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  return host && VECTOR_HOSTS.has(host) ? host : null;
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
  if (originHeader && originHeader !== "null") {
    requestOrigin = normalizeOrigin(originHeader);
  } else if (refererHeader) {
    requestOrigin = normalizeOrigin(refererHeader);
  }

  if (requestOrigin && allowed.includes(requestOrigin)) {
    return null;
  }

  // OKX / mobile wallet WebViews load vectorprotocol.pro but often send the
  // wallet’s Origin on fetch — not our site URL. Same Host means same deployment.
  if (vectorHostFromRequest(request)) {
    return null;
  }

  return NextResponse.json(
    {
      error:
        "Open Vector at https://vectorprotocol.pro inside your wallet app (Discover → DApps), tap Refresh, and try again.",
      code: "ORIGIN_NOT_ALLOWED",
    },
    { status: 403 },
  );
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
  default: () => envLimit("RATE_LIMIT_DEFAULT_PER_MINUTE", 60),
};

/** Per-route limits — must not share one bucket (receipt polling alone can exceed 30/min). */
const READ_ACTION_DEFAULTS: Record<string, number> = {
  "arc-receipt": 360,
  "swap-routes": 180,
  "arc-balances": 120,
  kyber: 90,
};

function limitForAction(action: string): number {
  const envKey = `RATE_LIMIT_${action.replace(/-/g, "_").toUpperCase()}_PER_MINUTE`;
  const fromEnv = envLimit(envKey, -1);
  if (fromEnv > 0) return fromEnv;
  if (action in READ_ACTION_DEFAULTS) {
    return READ_ACTION_DEFAULTS[action]!;
  }
  const bucket = rateLimitBucketForAction(action);
  return BUCKET_LIMITS[bucket]();
}

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

function slidingWindowKey(ip: string, action: string): string {
  const bucket = rateLimitBucketForAction(action);
  if (bucket === "kit" || bucket === "device") {
    return `${bucket}:${ip}`;
  }
  return `${action}:${ip}`;
}

export function rejectIfRateLimited(
  request: Request,
  action: string,
): NextResponse | null {
  const limit = limitForAction(action);
  const ip = clientIpFromRequest(request);
  const key = slidingWindowKey(ip, action);
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
