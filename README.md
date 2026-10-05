# Vector

Vector is a non-custodial, USDC-native DeFi hub on **Arc mainnet** — Circle's
stablecoin-native EVM L1, where USDC is the native gas token. Swap, bridge, earn,
send, and receive in one place, whether you onboard with Google or connect a wallet
you already use.

**Live:** [https://vectorprotocol.pro](https://vectorprotocol.pro)

The app also supports **Arc testnet** for development (`NEXT_PUBLIC_NETWORK=testnet`).
Production is configured for mainnet.

## Interface (desktop & mobile)

- **Layout** — Full-width sticky header with primary nav (Swap, Bridge, Earn, etc.
  when connected). On large screens, a **two-column** layout puts product copy and
  feature descriptions on the left and the wallet / connect card on the right (similar
  in spirit to [Uniswap](https://app.uniswap.org/), which uses the full viewport instead
  of a single centered phone column).
- **Typography** — [Inter](https://fonts.google.com/specimen/Inter) via `next/font`
  for UI copy; monospace for addresses, networks, and balances.
- **Scroll** — Landing and dashboard content can extend below the fold (feature
  blurbs, legal links); the page scrolls naturally instead of vertically centering
  a static block on empty side margins.

## Before you deploy (release check)

After each product upgrade, run the release gate and **push only if it passes**:

```bash
npm run verify:release
```

This runs **`npm audit --omit=dev --audit-level=critical`** (production dependency tree;
fails only on **critical** issues) and **`npm run build`**. Use
`npm run verify:audit:full` periodically to review moderate/high findings — many are
**transitive** (Circle App Kit / W3S Firebase, Solana helpers in SDKs) and need upstream
fixes rather than local overrides.

## Two ways to connect

- **Continue with Google** — creates a non-custodial **smart contract account (SCA)**
  through Circle's user-controlled wallets (W3S). No seed phrase; the user secures
  it with a PIN, and every transaction is signed via Circle's challenge flow. The
  wallet is **scoped to Arc mainnet** (Circle provisions it on Arc only). Gas is
  **sponsored via Circle's Gas Station (paymaster)**, so users pay fees in USDC
  through the paymaster policy — they never need to hold a separate native gas
  token for typical flows.
- **Connect Wallet** — any injected/browser wallet (e.g. MetaMask) via wagmi. You
  sign and pay gas on whichever chain each action uses (Arc for swap/earn; source
  chain for CCTP bridge burns).

## Features

| Feature | External wallet | Google (Circle) wallet |
| --- | :---: | :---: |
| Receive USDC | ✅ | ✅ |
| Send USDC | ✅ | ✅ |
| Bridge (CCTP v2) | ✅ | ✅ (Arc → other chains only) |
| Swap (USDC ↔ EURC on Arc) | ✅ | ✅ |
| Earn (Morpho vaults on Arc) | ✅ | ✅ (deposit & withdraw) |

**Bridge (mainnet)** — Circle CCTP v2 via App Kit: burn on the source chain;
Circle's relayer mints on the destination (`useForwarder`). Registered routes
include **Arc** and **Base**, **Ethereum**, **Arbitrum**, **Optimism**, **Polygon**,
**Avalanche**, **Unichain**, and **Linea** (see `app/lib/bridge-chains.ts` for the
canonical list and explorers). External wallets can bridge **from or to** any
supported chain. Google wallets can only **sign burns on Arc**; bridging **into**
Arc requires an external wallet on the source chain.

**Swap** — Same-chain **USDC ↔ EURC** on Arc through **Circle App Kit**, which
aggregates routing (including **LiFi** and other liquidity behind Circle's swap
service). **cirBTC** is intentionally **not** offered on mainnet: Circle's App Kit
chain definition exposes no mainnet cirBTC contract locator (testnet only).

**Earn** — USDC yield vaults on Arc (including **Morpho**-style vaults discovered
live from Circle's Earn service). Deposit and withdraw are implemented for both
wallet paths.

**Platform fee** — Vector charges a transparent fee on routed flows: **0.25%** on
swaps and **0.10%** on bridges. The UI shows the fee before you confirm; fees are
configured in `app/lib/fees.ts` and sent to `NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT`
(Circle's custom-fee split applies per their docs).

## Architecture

- `app/page.tsx` — Client shell: Circle W3S init → Google OAuth or wagmi connect →
  balances → action panels.
- `app/api/endpoints/route.ts` — Single backend route. Proxies to Circle (W3S REST,
  swap/earn kit HTTP) with **server-side API keys** never exposed to the browser.
  Protected by origin allowlist and per-IP rate limits (see below).
- `app/lib/network.ts` — **Testnet vs mainnet** switch via `NEXT_PUBLIC_NETWORK`.
  Arc RPC, explorers, and token locators are resolved from **Circle App Kit**
  (`getSupportedChains`) where possible, not hardcoded mainnet addresses.
- `app/lib/fees.ts` — Platform fee recipient validation and App Kit `customFee`
  payloads (swap bps, bridge amount-based fee in USDC base units).
- `app/lib/endpoints-abuse-guard.ts` — **Origin allowlist** (`ALLOWED_ORIGINS`) and
  **in-memory sliding-window rate limits** per IP for `/api/endpoints` actions.
- `app/lib/*` — Feature adapters: `appkit.ts` + `google-swap.ts` (swap),
  `bridge.ts` + `google-bridge.ts` (CCTP), `earn.ts` + `google-earn.ts` (vaults),
  `w3s-tx.ts` (challenge runner), `vector-router.ts` + `contracts/` (optional
  on-chain send attribution on Arc), `bridge-chains.ts` / `swap-tokens.ts` registries.
- `app/components/*` — Modal panels per action (`SwapPanel`, `BridgePanel`, `SendPanel`,
  `ReceivePanel`, `EarnPanel`, `HistoryPanel`, plus `Google*` variants).
- `app/globals.css` — Design tokens (dark surface, pink accent).

## Setup

Vector needs **separate credentials for testnet and mainnet**. Match
`NEXT_PUBLIC_NETWORK` to the keys and OAuth clients you use.

### 1. Google OAuth

Create OAuth clients in [Google Cloud Console](https://console.cloud.google.com/)
(Web application). Add authorized redirect URIs for local dev and production, e.g.:

- `http://localhost:3000`
- `https://vectorprotocol.pro` (and `https://www.vectorprotocol.pro` if you use it)

Use **one client ID for testnet** and **a separate client ID for mainnet** (see env
vars below).

### 2. Circle Console — testnet

1. [Circle Developer Console](https://console.circle.com/) → **Keys** → create a
   **TEST** API key → `CIRCLE_API_KEY`.
2. **Wallets → User Controlled → Configurator** (testnet) → **Authentication Methods
   → Social Logins → Google** → paste your **testnet** Google Client ID.
3. Copy the testnet **App ID** → `NEXT_PUBLIC_CIRCLE_APP_ID`.

### 3. Circle Console — mainnet (production)

1. Create a **LIVE** API key → `CIRCLE_API_KEY_LIVE`. Test keys are rejected for
   mainnet blockchains (Circle error 156006).
2. Switch to **Mainnet** in the console → **Wallets → User Controlled → Configurator
   → Authentication Methods → Google** → paste your **mainnet** Google Client ID
   (must match the mainnet App ID environment).
3. Copy the mainnet **App ID** → `NEXT_PUBLIC_CIRCLE_APP_ID_LIVE`.
4. **Gas Station → Policies** — configure a **paymaster policy** for your mainnet
   smart-contract wallets. Without it, Google-wallet transactions can fail even
   when the user has USDC.

### 4. Environment variables

```bash
cp .env.local.example .env.local
```

**Required for production (mainnet):**

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_NETWORK` | `mainnet` (use `testnet` for Arc testnet dev) |
| `CIRCLE_API_KEY_LIVE` | Server-side W3S REST (live key) |
| `NEXT_PUBLIC_CIRCLE_APP_ID_LIVE` | W3S / Google wallet (mainnet) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID_LIVE` | Google OAuth (mainnet client) |
| `NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT` | EVM address receiving Vector's share of custom fees |

**Testnet development:**

| Variable | Purpose |
| --- | --- |
| `CIRCLE_API_KEY` | Server-side W3S REST (test key) |
| `NEXT_PUBLIC_CIRCLE_APP_ID` | Testnet App ID |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Testnet OAuth client |

**Optional:**

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_ARC_RPC_URL` | Override Arc RPC (defaults from App Kit) |
| `NEXT_PUBLIC_KIT_KEY` | Circle App Kit key (attribution / higher limits) |
| `NEXT_PUBLIC_VECTOR_ROUTER_ARC` | Deployed `VectorRouter` on Arc for branded sends |
| `NEXT_PUBLIC_ARC_FAUCET_URL` | Testnet only; ignored on mainnet |
| `ALLOWED_ORIGINS` | Comma-separated origins for `/api/endpoints` (defaults include vectorprotocol.pro + localhost) |
| `RATE_LIMIT_DEVICE_PER_MINUTE` | Default **10**/min (`createDeviceToken`) |
| `RATE_LIMIT_KIT_PER_MINUTE` | Default **20**/min in code; **40** recommended in production |
| `RATE_LIMIT_DEFAULT_PER_MINUTE` | Default **30**/min (reads, transfers setup, etc.) |

Relay (`RELAY_API_KEY`) is used only in offline verification scripts under
`scripts/` — it is **not** required to run the app.

### 5. Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For mainnet locally, set
`NEXT_PUBLIC_NETWORK=mainnet` and all `*_LIVE` / live key variables.

### 6. Fund a wallet

**Testnet only** — [Circle Faucet](https://faucet.circle.com/) → **Arc Testnet** →
paste your address → receive test USDC (and other test assets). Reload the app to
see balances.

**Mainnet** — There is **no faucet**. Fund via **CCTP bridge** from another chain,
a normal USDC transfer to your address on Arc, or any other on-ramp you trust.

## Roadmap / What's next

**V2 — NGN offramp (planned)** — Convert and withdraw USDC directly to **Nigerian
Naira** via local bank transfer, so users can cash out without juggling a separate
exchange. This requires a **licensed payment partner** for NGN settlement; it is
on the roadmap and **not built yet**.

## Notes

- Wallets are **non-custodial**: neither Vector nor Circle can recover a user's
  wallet if they lose access to their Google account or keys. Make that clear in
  onboarding before you ship widely.
- The app still calls Circle for balances and wallet lists on load. For scale,
  consider persisting wallet metadata in your own database and syncing via Circle
  webhooks instead of hitting W3S on every page view.
- **Google-wallet bridge out of Arc** — The mint on the destination chain goes to an
  address **you specify**. Your Arc SCA address is **not** automatically a wallet
  you control on Base, Ethereum, etc. The UI requires you to enter a destination
  you control and confirm that before bridging.
- Deploy on **Vercel** (or similar): set all env vars for the target network, set
  `ALLOWED_ORIGINS` if you use preview URLs, and add production OAuth redirect URIs
  in Google Cloud.
