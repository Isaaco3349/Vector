/**
 * Circle W3S + Google OAuth public IDs — testnet vs mainnet (mirrors API key split).
 * Use literal process.env.NEXT_PUBLIC_* names so Next.js inlines them at build time.
 */
import { isMainnet } from "./network";

const TEST_CIRCLE_APP_ID = process.env.NEXT_PUBLIC_CIRCLE_APP_ID?.trim();
const LIVE_CIRCLE_APP_ID = process.env.NEXT_PUBLIC_CIRCLE_APP_ID_LIVE?.trim();
const TEST_GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
const LIVE_GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID_LIVE?.trim();

export function resolveCircleAppId(): string {
  if (isMainnet) {
    if (!LIVE_CIRCLE_APP_ID) {
      throw new Error(
        "Missing NEXT_PUBLIC_CIRCLE_APP_ID_LIVE. Mainnet Google/W3S login requires the LIVE Circle App ID from Circle Console.",
      );
    }
    return LIVE_CIRCLE_APP_ID;
  }
  if (!TEST_CIRCLE_APP_ID) {
    throw new Error(
      "Missing NEXT_PUBLIC_CIRCLE_APP_ID. Testnet Google/W3S login requires the TEST Circle App ID from Circle Console.",
    );
  }
  return TEST_CIRCLE_APP_ID;
}

export function resolveGoogleClientId(): string {
  if (isMainnet) {
    if (!LIVE_GOOGLE_CLIENT_ID) {
      throw new Error(
        "Missing NEXT_PUBLIC_GOOGLE_CLIENT_ID_LIVE. Mainnet Google sign-in requires the LIVE OAuth client ID from Google Cloud Console.",
      );
    }
    return LIVE_GOOGLE_CLIENT_ID;
  }
  if (!TEST_GOOGLE_CLIENT_ID) {
    throw new Error(
      "Missing NEXT_PUBLIC_GOOGLE_CLIENT_ID. Testnet Google sign-in requires the TEST OAuth client ID from Google Cloud Console.",
    );
  }
  return TEST_GOOGLE_CLIENT_ID;
}

/** Active Circle App ID env var name (for error copy). */
export function circleAppIdEnvName(): string {
  return isMainnet
    ? "NEXT_PUBLIC_CIRCLE_APP_ID_LIVE"
    : "NEXT_PUBLIC_CIRCLE_APP_ID";
}
