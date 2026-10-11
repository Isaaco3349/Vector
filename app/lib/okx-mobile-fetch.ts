"use client";

import { okxInAppBrowser } from "./wallet-brand";

/** OKX WebView often drops fetch when the app backgrounds during signing. */
export async function fetchVectorApi(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const attempts = okxInAppBrowser() ? 4 : 2;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      last = err;
      if (i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last instanceof Error
    ? last
    : new Error("Could not reach Vector. Check connection and try again.");
}
