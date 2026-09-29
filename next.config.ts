import type { NextConfig } from "next";
import path from "node:path";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  // Circle's W3SSdk processes the Google OAuth redirect synchronously on
  // construction and isn't safe under StrictMode's dev-only double
  // mount/unmount/mount cycle — the real login callback was firing but
  // getting discarded by the synthetic unmount in between. Disabling this
  // only affects development; production builds never double-invoke.
  reactStrictMode: false,

  // Pin the workspace root to this repo. Without this, Next 16 walks up the
  // tree, finds a stray package-lock.json in C:\Users\user (outside the git
  // repo), and warns because it can't tell which folder is the project root.
  // Pinning it keeps module resolution scoped to the app and silences the warning.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
