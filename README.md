# Vector

Vector is a non-custodial, USDC-native DeFi hub on **Arc Testnet** — Circle's
stablecoin-native EVM L1, where USDC is the native gas token. It's one place to
swap, bridge, and earn, whether you onboard with just a Google account or bring
a wallet you already use.

Live: https://vectorprotocol.vercel.app

## Two ways to connect

- **Continue with Google** — creates a non-custodial wallet through Circle's
  user-controlled wallets (W3S). No seed phrase; the user secures it with a PIN,
  and every transaction is signed via Circle's challenge flow. The wallet is
  scoped to Arc.
- **Connect Wallet** — any injected/browser wallet (e.g. MetaMask) via wagmi.

## Features

| Feature | External wallet | Google (Circle) wallet |
| --- | :---: | :---: |
| Receive USDC | ✅ | ✅ |
| Send USDC | ✅ | ✅ |
| Bridge (CCTP v2) | ✅ | ✅ |
| Swap (Arc USDC↔EURC) | ✅ | ✅ |
| Earn (yield vaults) | ✅ | ✅ |

Bridge routes: Arc Testnet ⇄ Base Sepolia / Ethereum Sepolia, via Circle's
CCTP v2 (approve → burn on the source; Circle's relayer mints on the
destination).

**Planned for v2 — Stake, Lend, Borrow.** These need third-party
lending/staking protocols deployed on Arc, and there is no Circle SDK for them.
Rather than wire them to guessed contract addresses (a real risk with funds at
stake), they're intentionally left out until they can be built against verified,
first-party contracts on Arc.

## Architecture

- `app/page.tsx` — the client app: Circle Web SDK init → Google OAuth (or wallet
  connect) → wallet + USDC balance → the action panels.
- `app/api/endpoints/route.ts` — the only backend route. Proxies to Circle's API
  with your server-side `CIRCLE_API_KEY` (never exposed to the browser) and
  handles the challenge-based flows (transfer, contract execution) the Google
  wallet uses.
- `app/lib/*` — one isolated wrapper per feature: `appkit.ts` + `google-swap.ts`
  (swap), `bridge.ts` + `google-bridge.ts` (CCTP bridge), `earn.ts` +
  `google-earn.ts` (yield vaults), `w3s-tx.ts` (challenge runner), and the
  `bridge-chains` / `swap-tokens` registries.
- `app/components/*` — one modal panel per action (`SwapPanel`, `BridgePanel`,
  `SendPanel`, `ReceivePanel`, `EarnPanel`), plus `Google*Panel` variants for the
  Circle wallet.
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
