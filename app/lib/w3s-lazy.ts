"use client";

import { getCookie } from "cookies-next";

/** Load Circle W3S only when Google login is likely — not on every wallet-only visit. */
export function shouldInitW3sOnPageLoad(): boolean {
  if (typeof window === "undefined") return false;
  if (getCookie("deviceToken")) return true;
  if (getCookie("deviceEncryptionKey")) return true;
  const search = window.location.search;
  if (/[?&](code|state|session_state)=/i.test(search)) return true;
  return false;
}
