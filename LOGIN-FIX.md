# Ship + verify Google login

Everything here is one job: make Circle and Google both recognise the origin that
actually serves Vector. Two consoles, two different failure symptoms.

---

## Step 0 — find out what the origin actually IS (do this first)

Open <https://vectorprotocol.pro> and look at the **address bar after any redirect
settles**. Whatever is there is the only string that matters.

You want the `protocol://host` part, with **no trailing slash** and no path:

- `https://www.vectorprotocol.pro`  ← if Vercel redirects apex → www
- `https://vectorprotocol.pro`      ← if the apex serves directly

Why this precision matters: the SDK builds the origin as
`` `${protocol}//${host}` `` (`w3s-pw-web-sdk/src/index.ts` @339-345). `host`
includes the subdomain and the port. So `www.vectorprotocol.pro` and
`vectorprotocol.pro` are **two different origins** to Circle, and registering the
wrong one looks identical to registering nothing.

If both hosts serve real traffic (no redirect), register **both**. Also register
your `*.vercel.app` preview domain if you ever test login there, and
`http://localhost:3000` for local dev.

---

## Step 1 — push the code

```powershell
cd C:\Users\user\vector-app
npm run build          # the real gate; must be green before pushing
git add app/page.tsx
git commit -m "Tell the truth about why Google login fails, and stop the 33s stall"
git push
```

Only `app/page.tsx` is modified. Untracked and deliberately left alone for now:
`scripts/deviceid-race-sim.mjs`, `scripts/lifi-probe.mjs`, `vector-grant-deck.pptx`.

This push does **not** fix login. It makes the app tell you the truth about why
login is failing, and stops it burning ~33 seconds doing so. The fix is steps 2-3.

---

## Step 2 — register the origin with Circle

In the Circle developer console, find the app that owns your
`NEXT_PUBLIC_CIRCLE_APP_ID` and add the Step 0 string to its list of allowed
origins / allowed domains for web SDK use.

I can't see Circle's console from here and I'm not going to invent menu names for
you. Look for the setting that controls **which web origins are permitted to use
this App ID** — it may be called allowed origins, allowed domains, authorized
domains, or app settings. If you can't find it, that itself is the useful signal:
it means the App ID may be scoped to a domain you set at creation time and needs
a support ticket or a new App ID.

**How you'll know this was the problem:** the `pw-auth` request in Step 5 stops
timing out and Google login proceeds to the PIN/passkey step.

---

## Step 3 — register the SAME origin with Google

Separate console, separate registration. Google Cloud Console → APIs & Services →
Credentials → your OAuth 2.0 Client ID (the one in
`NEXT_PUBLIC_GOOGLE_CLIENT_ID`). Add the Step 0 string to **both**:

- **Authorized JavaScript origins**
- **Authorized redirect URIs**

Both, because `app/page.tsx:476` passes `redirectUri: window.location.origin` —
so Google receives the origin as a redirect target, not just as a script origin.

**Different symptom, so you can tell them apart:** if Circle is wrong you never
get past "connecting" — no Google account picker ever appears. If *Google* is
wrong you DO get the account picker, then a Google error page saying the redirect
URI mismatches. Those are different bugs; don't fix one and assume the other.

---

## Step 4 — confirm the env vars survived the build

`NEXT_PUBLIC_*` variables are **inlined at build time**, not read at runtime. A
variable added to Vercel after the last build does not exist in the deployed
bundle.

In Vercel → Settings → Environment Variables, confirm these exist for
**Production** (check presence only — don't paste values anywhere, `KIT_KEY` is a
credential per Circle's own docs):

- `NEXT_PUBLIC_CIRCLE_APP_ID`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `NEXT_PUBLIC_KIT_KEY`
- `NEXT_PUBLIC_CIRCLE_BASE_URL`
- `CIRCLE_API_KEY` (server-side, used by `/api/endpoints`)

If you add or change any of them, **redeploy** — a rebuild is the only way the new
value reaches the browser.

---

## Step 5 — verify, in a profile that has never logged in

⚠️ **The `deviceId` is cached in `localStorage`.** Any browser that once
succeeded will keep working no matter how broken the registration is. "It works
for me" proves nothing. Use a fresh Incognito window, or clear the `deviceId` key.

1. Open the site in **Incognito**. DevTools ▸ **Network** ▸ filter `pw-auth`.
2. Click **Continue with Google**.
3. Read the request to `pw-auth.circle.com/device-id`:
   - **Look at the `origin=` query parameter.** This is the whole diagnosis. It
     is the exact string Circle is being asked to validate. Does it match what
     you registered in Step 2, character for character?
   - **Status.** A response that never arrives (pending → then our 10s timeout)
     means Circle declined to post back — almost always an unregistered origin.
4. Check the **Console** tab. The app now prints the origin itself, so you don't
   have to derive it:
   - `[Vector] Circle's login service never responded. It was asked to validate origin: …`
   - `[Vector] getDeviceId failed (attempt 1/2): Failed to receive deviceId`

### Expected timings after this push

| | Before | After |
|---|---|---|
| Landing page, no click | "Connecting to Circle…" for **~33s**, then a false error about wallet extensions | "Continue with Google" **immediately**; one silent 10s attempt in the background, nothing visible |
| Click, still broken | up to ~33s | ~20s, then an honest error naming the origin |
| Click, working | — | as fast as Circle replies |

---

## What this does NOT fix

The wallet-extension theory was wrong, and disabling extensions was never going
to help — nothing in the deviceId handshake touches an extension. It is a hidden
iframe to a hardcoded Circle URL and a `postMessage` reply, nothing more. If
Steps 2-4 are all correct and the `origin=` parameter still matches what you
registered, then the problem is on Circle's side and you have the exact request,
the exact origin string, and the timeout to show them.
