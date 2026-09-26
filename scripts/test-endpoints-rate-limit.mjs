/**
 * Smoke-test origin gate + rate limit on POST /api/endpoints.
 * Usage: node scripts/test-endpoints-rate-limit.mjs [baseUrl]
 * Default baseUrl: http://localhost:3000
 */
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const url = `${base}/api/endpoints`;

async function post(body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function main() {
  console.log("Target:", url);

  const noOrigin = await post(
    { action: "createDeviceToken", deviceId: "test-device" },
    { Origin: "" },
  );
  delete noOrigin.json;
  const blocked = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "createDeviceToken",
      deviceId: "test-device",
    }),
  });
  console.log(
    "Origin gate (no Origin/Referer):",
    blocked.status,
    blocked.status === 403 ? "OK" : "expected 403",
  );

  let lastStatus = 0;
  let saw429 = false;
  for (let i = 1; i <= 12; i++) {
    const r = await post({
      action: "createDeviceToken",
      deviceId: `rate-test-${i}`,
    });
    lastStatus = r.status;
    if (r.status === 429) {
      saw429 = true;
      console.log(`Request ${i}: 429 RATE_LIMITED —`, r.json.code ?? r.json.error);
      break;
    }
    if (i <= 3 || i === 10) {
      console.log(`Request ${i}:`, r.status);
    }
  }

  console.log(
    saw429
      ? "Rate limit: triggered as expected (createDeviceToken bucket, 10/min)."
      : `Rate limit: no 429 after 12 tries (last status ${lastStatus}). On a cold dev server, retry or hit faster.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
