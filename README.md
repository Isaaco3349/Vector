# Vector

Non-custodial crypto wallet, Google-login onboarding, powered by Circle's
user-controlled wallets SDK on Arc Testnet.

## How it works

- `app/page.tsx` — the whole client flow: Circle Web SDK init → device
  token → Google OAuth redirect → initialize user → execute challenge →
  wallet + USDC balance.
- `app/api/endpoints/route.ts` — single backend route that proxies to
  Circle's API using your server-side `CIRCLE_API_KEY` (never exposed to
  the browser).
- `app/globals.css` — Vector's design tokens (dark surface, pink accent).

## Setup

### 1. Google OAuth

1. [Google Cloud Console](https://console.cloud.google.com/) → new project.
2. Search **Auth** → **Google Auth Platform** → **Get started**.
   - App name: Vector
   - Audience: External
   - Your email for support + contact
3. **Create OAuth client**:
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3000` (add your prod URL later)
4. Copy the **Client ID**.

### 2. Circle Console

1. [Circle Developer Console](https://console.circle.com/) → create an
   account → **Keys → Create a key → API key → Standard Key**.
2. **Wallets → User Controlled → Configurator → Authentication Methods →
   Social Logins → Google** → paste your Google Client ID.
3. Copy your **App ID** from the Configurator page.

### 3. Environment variables

```bash
cp .env.local.example .env.local
```

Fill in:

```
CIRCLE_API_KEY=<your Circle API key>
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<your Google OAuth Client ID>
NEXT_PUBLIC_CIRCLE_APP_ID=<your Circle App ID>
```

### 4. Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000, click **Continue with Google**, approve, then
**Confirm wallet setup**. Your wallet address and USDC balance appear once
Circle finishes creating it (a few seconds).

### 5. Fund a test wallet

[Circle Faucet](https://faucet.circle.com/) → select **Arc Testnet** →
paste your wallet address → **Send USDC**. Reload the app to see the
updated balance.

## Notes

- Wallets are non-custodial: neither Vector nor Circle can recover a
  user's wallet if they lose access to their Google account. Say this
  clearly somewhere in onboarding before you ship.
- This quickstart calls `listWallets` / `getTokenBalance` live on every
  load. For production, persist wallet data in your own database and keep
  it in sync via Circle webhooks instead.
- Deploy on Vercel: add the same three env vars in the project settings,
  and add your production URL to the Google OAuth redirect URIs.

## Pushing to GitHub

```bash
git init
git add .
git commit -m "Initial Vector app"
git remote add origin https://github.com/<your-username>/vector-app.git
git branch -M main
git push -u origin main
```
