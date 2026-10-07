"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { setCookie, getCookie, deleteCookie } from "cookies-next";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import {
  useAccount,
  useConnect,
  useDisconnect,
} from "wagmi";
import { SwapPanel } from "./components/SwapPanel";
import { BridgePanel } from "./components/BridgePanel";
import { SendPanel } from "./components/SendPanel";
import { GoogleSendPanel } from "./components/GoogleSendPanel";
import { GoogleBridgePanel } from "./components/GoogleBridgePanel";
import { GoogleSwapPanel } from "./components/GoogleSwapPanel";
import { ReceivePanel } from "./components/ReceivePanel";
import { EarnPanel } from "./components/EarnPanel";
import { DigitalMarquee } from "./components/DigitalMarquee";
import { GoogleEarnPanel } from "./components/GoogleEarnPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { useTokenBalance } from "./components/useTokenBalance";
import { bridgeChainByNumericId } from "./lib/bridge-chains";
import {
  arcFaucetUrl,
  headerNetworkLabel,
  isTestnet,
  w3sBlockchainLabel,
} from "./lib/network";
import {
  circleAppIdEnvName,
  resolveCircleAppId,
  resolveGoogleClientId,
} from "./lib/w3s-public-config";

type LoginResult = {
  userToken: string;
  encryptionKey: string;
};

type Wallet = {
  id: string;
  address: string;
  blockchain: string;
  [key: string]: unknown;
};

type Step = "start" | "device" | "auth" | "init" | "wallet";

export default function HomePage() {
  // --- Bring-your-own-wallet path (MetaMask, Rabby, Coinbase Wallet, etc.) ---
  const { address: injectedAddress, isConnected: isInjectedConnected, chainId: injectedChainId } =
    useAccount();
  const { connect, connectors, isPending: isConnectPending, error: connectError } =
    useConnect();
  const { disconnect } = useDisconnect();
  const injectedUsdcOnArc = useTokenBalance("USDC");
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const [showBridge, setShowBridge] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showEarn, setShowEarn] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // --- Circle social-login path ---
  const sdkRef = useRef<W3SSdk | null>(null);

  const [sdkReady, setSdkReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string>("");
  const [deviceIdLoading, setDeviceIdLoading] = useState(false);

  const [deviceToken, setDeviceToken] = useState<string>("");
  const [deviceEncryptionKey, setDeviceEncryptionKey] = useState<string>("");

  const [loginResult, setLoginResult] = useState<LoginResult | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  // cirBTC holdings for the Google (Circle) wallet, parsed from the SAME
  // balances endpoint as USDC (Circle returns human-readable amounts, so no
  // decimal math here). Display-only — it never gates Send/Swap. The external
  // wallet reads cirBTC on-chain via useTokenBalance instead, so this stays null
  // for that path.
  const [cirBtcBalance, setCirBtcBalance] = useState<string | null>(null);
  const [eurcBalance, setEurcBalance] = useState<string | null>(null);
  // Circle's own token UUID for this wallet's USDC — required as `tokenId` when
  // creating a transfer challenge. Captured from the balances endpoint so we
  // never hardcode a USDC address for the Google-wallet Send path.
  const [usdcTokenId, setUsdcTokenId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const initSdk = async () => {
      // If an SDK instance already exists (e.g. a remount), don't create a
      // second one — that would orphan the first instance mid-flight while
      // it's processing an OAuth redirect, and its real callback would get
      // silently dropped.
      if (sdkRef.current) {
        setSdkReady(true);
        return;
      }

      try {
        const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");

        const onLoginComplete = (error: unknown, result: any) => {
          // Always log the raw callback first, before any early return,
          // so a genuine login result is never silently lost to debugging
          // blind spots again.
          console.log("[Vector] onLoginComplete fired", { error, result });

          if (error) {
            const err = error as any;
            const message =
              err?.message ||
              err?.error?.message ||
              (typeof err === "string" ? err : JSON.stringify(err));
            setLoginError(message || "Login failed (no error detail returned)");
            setLoginResult(null);
            setStatus("");
            return;
          }

          if (!result?.userToken) {
            console.warn(
              "[Vector] onLoginComplete had no error but also no userToken",
              result,
            );
            setLoginError("Login completed but no session was returned.");
            setStatus("");
            return;
          }

          setLoginResult({
            userToken: result.userToken,
            encryptionKey: result.encryptionKey,
          });
          setLoginError(null);
        };

        let activeAppId = "";
        let activeGoogleClientId = "";
        try {
          activeAppId = resolveCircleAppId();
          activeGoogleClientId = resolveGoogleClientId();
        } catch (configErr) {
          console.error("[Vector] W3S config:", configErr);
          if (!cancelled) setSdkReady(false);
          return;
        }

        const restoredAppId =
          (getCookie("appId") as string) || activeAppId || "";
        const restoredGoogleClientId =
          (getCookie("google.clientId") as string) ||
          activeGoogleClientId ||
          "";
        const restoredDeviceToken = (getCookie("deviceToken") as string) || "";
        const restoredDeviceEncryptionKey =
          (getCookie("deviceEncryptionKey") as string) || "";

        const initialConfig = {
          appSettings: { appId: restoredAppId },
          loginConfigs: {
            deviceToken: restoredDeviceToken,
            deviceEncryptionKey: restoredDeviceEncryptionKey,
            google: {
              clientId: restoredGoogleClientId,
              redirectUri:
                typeof window !== "undefined" ? window.location.origin : "",
              selectAccountPrompt: true,
            },
          },
        };

        console.log("[Vector] mounting, current URL:", window.location.href);
        console.log("[Vector] restored config on mount:", {
          hasAppId: Boolean(restoredAppId),
          hasGoogleClientId: Boolean(restoredGoogleClientId),
          hasDeviceToken: Boolean(restoredDeviceToken),
          hasDeviceEncryptionKey: Boolean(restoredDeviceEncryptionKey),
        });

        const sdk = new W3SSdk(initialConfig, onLoginComplete);
        sdkRef.current = sdk;
        console.log("[Vector] W3SSdk instance created");

        if (!cancelled) setSdkReady(true);
      } catch (err) {
        console.error("Failed to initialize Web SDK:", err);
      }
    };

    void initSdk();
    return () => {
      cancelled = true;
    };
  }, []);

  const [deviceIdError, setDeviceIdError] = useState<string | null>(null);
  /** The single in-flight getDeviceId handshake, or null. See fetchDeviceId. */
  const deviceIdFetchRef = useRef<Promise<string | null> | null>(null);
  /** Whether the on-mount background prefetch has already had its one try. */
  const deviceIdPrefetchedRef = useRef(false);

  /**
   * Fetch Circle's deviceId.
   *
   * ── WHAT THIS ACTUALLY DOES (verified in the SDK source, not inferred) ──────
   * `sdk.getDeviceId()` appends a hidden iframe pointing at a HARDCODED Circle
   * URL and waits for a `postMessage` back from that exact origin:
   *
   *   https://pw-auth.circle.com/device-id?origin=<protocol>//<host>
   *
   * If no message arrives within 10s it rejects with the string
   * 'Failed to receive deviceId'.
   * (node_modules/@circle-fin/w3s-pw-web-sdk/src/index.ts — getDeviceId @149,
   *  appendIframe @339, serviceUrl @49, origin check @752.)
   *
   * Two consequences worth keeping in mind:
   *  1. `host` INCLUDES the subdomain, so `www.vectorprotocol.pro` and
   *     `vectorprotocol.pro` are DIFFERENT origins to Circle. If the origin
   *     serving the app isn't registered against the Circle App ID, Circle
   *     simply never posts back and this times out silently.
   *  2. Nothing in this path touches a wallet extension. An earlier version of
   *     this function blamed "several wallet extensions" — that was a guess, it
   *     was wrong, and it sent real debugging time in the wrong direction.
   *     Don't reintroduce a cause we haven't verified.
   *
   * ── ONLY ONE HANDSHAKE AT A TIME (verified in the SDK source) ───────────────
   * The SDK stores the pending promise's handles on the INSTANCE:
   *   private receivedResponseFromService = false   (@80)
   *   private resolveDeviceIdPromise?  (@84)   private rejectDeviceIdPromise?  (@88)
   * and getDeviceId() OVERWRITES both on every call (@151-152). So two
   * overlapping calls corrupt each other: the second call replaces the handles,
   * then the FIRST call's 10s timer fires, rejects the SECOND call's promise, and
   * calls unSubscribeMessage() — tearing down the listener so Circle's reply to
   * the second call is never received. The background prefetch would therefore
   * sabotage any Google click made in its first 10 seconds, which is exactly
   * when a first-time visitor clicks. We serialise on `deviceIdFetchRef`: if a
   * handshake is already running, await THAT instead of starting another.
   *
   * @param opts.attempts How many times to try before giving up (10s each).
   * @param opts.silent   Background mode: don't drive the button's loading label
   *                      and don't surface an error. Used for the on-mount
   *                      prefetch, so a failing handshake can't stall the UI.
   */
  const fetchDeviceId = async (
    opts: { attempts?: number; silent?: boolean } = {},
  ): Promise<string | null> => {
    const { attempts = 2, silent = false } = opts;
    // Capture the SDK once rather than re-reading sdkRef.current after each
    // await. TS would let the narrowed property survive the loop, but that's an
    // unsoundness — the Retry button genuinely does set sdkRef.current = null,
    // so a local binding is the honest way to hold it.
    const sdk = sdkRef.current;
    if (!sdk) return null;

    const cached =
      typeof window !== "undefined"
        ? window.localStorage.getItem("deviceId")
        : null;
    if (cached) {
      setDeviceId(cached);
      setDeviceIdError(null);
      return cached;
    }

    if (!silent) setDeviceIdLoading(true);
    try {
      // Join an in-flight handshake rather than corrupting it (see above). If it
      // succeeds we're done; if it fails we fall through and try again ourselves.
      let joinedFailure = false;
      const inFlight = deviceIdFetchRef.current;
      if (inFlight) {
        const joined = await inFlight;
        if (joined) {
          setDeviceIdError(null);
          return joined;
        }
        joinedFailure = true;
      }

      // A handshake we waited out and watched fail COUNTS as one of our attempts.
      // Without this, joining the background prefetch would ADD 10s to the click
      // path (10s joined + 10s + 1s + 10s = 31s) — worse than the stall this
      // whole change exists to remove. Charging it keeps the worst case at ~20s.
      const remaining = attempts - (joinedFailure ? 1 : 0);
      if (remaining > 0) {
        const run = (async () => {
          for (let attempt = 1; attempt <= remaining; attempt++) {
            try {
              const id = await sdk.getDeviceId();
              setDeviceId(id);
              setDeviceIdError(null);
              if (typeof window !== "undefined") {
                window.localStorage.setItem("deviceId", id);
              }
              return id;
            } catch (error) {
              console.error(
                `[Vector] getDeviceId failed (attempt ${attempt}/${remaining}):`,
                error,
              );
              if (attempt < remaining) {
                await new Promise((r) => setTimeout(r, 1000));
              }
            }
          }
          return null;
        })();
        deviceIdFetchRef.current = run;

        try {
          const id = await run;
          if (id) return id;
        } finally {
          // Release the slot so a later click (or Retry) can start a fresh
          // handshake instead of joining a promise that has already failed.
          if (deviceIdFetchRef.current === run) deviceIdFetchRef.current = null;
        }
      }

      // Every attempt timed out. Name the origin Circle was asked to validate —
      // that string is the whole diagnosis, so put it where it can be read.
      const origin =
        typeof window !== "undefined" ? window.location.origin : "this site";
      console.error(
        "[Vector] Circle's login service never responded. It was asked to " +
          `validate origin: ${origin}\n` +
          "The SDK loads https://pw-auth.circle.com/device-id?origin=<origin> " +
          "and waits 10s for a postMessage reply. A silent timeout usually " +
          "means this EXACT origin (subdomain included) is not registered " +
          `against ${circleAppIdEnvName()} in the Circle console.`,
      );
      if (!silent) {
        setDeviceIdError(
          `Circle's login service didn't respond for ${origin}. Google sign-in is unavailable right now — you can still connect an existing wallet below. (Details in the browser console.)`,
        );
      }
      return null;
    } finally {
      if (!silent) setDeviceIdLoading(false);
    }
  };

  useEffect(() => {
    // Quietly try in the background as soon as the SDK is ready, so
    // returning users (with a cached deviceId) see an instantly-usable
    // button. If it's not ready yet by the time someone clicks, handleConnect
    // below fetches it on demand instead of leaving the button disabled.
    //
    // `silent` + a SINGLE attempt is what keeps that promise. This prefetch
    // used to run 3×10s attempts (with 1s and 2s backoffs) while driving the
    // button's loading label, so a failing Circle handshake left every
    // first-time visitor staring at "Connecting to Circle…" for ~33s before an
    // error appeared — the opposite of quiet. Now a failure here costs nothing
    // visible: the button reads "Continue with Google" immediately, and the
    // on-demand fetch in handleConnect does the retrying and the reporting when
    // someone actually clicks. fetchDeviceId itself owns deviceIdFetchRef, so a
    // click during this window JOINS this handshake rather than breaking it.
    if (sdkReady && !deviceIdPrefetchedRef.current) {
      deviceIdPrefetchedRef.current = true;
      void fetchDeviceId({ attempts: 1, silent: true });
    }
  }, [sdkReady]);

  async function loadUsdcBalance(userToken: string, walletId: string) {
    try {
      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getTokenBalance", userToken, walletId }),
      });
      const data = await response.json();
      if (!response.ok) return null;
      const balances = (data.tokenBalances as any[]) || [];
      const usdcEntry =
        balances.find((t) => {
          const symbol = t.token?.symbol || "";
          const name = t.token?.name || "";
          return symbol.startsWith("USDC") || name.includes("USDC");
        }) ?? null;
      const amount = usdcEntry?.amount ?? "0";
      setUsdcBalance(amount);
      // Circle's token UUID for USDC — needed as `tokenId` for a transfer.
      // Only set when found; leave null so Send stays gated until it's known.
      setUsdcTokenId(
        typeof usdcEntry?.token?.id === "string" ? usdcEntry.token.id : null,
      );
      // cirBTC holdings, from the same list — display-only, so no tokenId or
      // gating. If the wallet holds none, it simply won't appear → show "0".
      const cirBtcEntry =
        balances.find((t) => {
          const symbol = (t.token?.symbol || "").toLowerCase();
          const name = (t.token?.name || "").toLowerCase();
          return symbol === "cirbtc" || name.includes("cirbtc");
        }) ?? null;
      setCirBtcBalance(cirBtcEntry?.amount ?? "0");
      const eurcEntry =
        balances.find((t) => {
          const symbol = (t.token?.symbol || "").toUpperCase();
          const name = (t.token?.name || "").toUpperCase();
          return symbol === "EURC" || name.includes("EURC");
        }) ?? null;
      setEurcBalance(eurcEntry?.amount ?? "0");
      return amount;
    } catch (err) {
      console.error("Failed to load USDC balance:", err);
      return null;
    }
  }

  const loadWallets = async (userToken: string) => {
    try {
      setStatus("Loading your wallet…");
      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listWallets", userToken }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus("");
        setLoginError(
          data.code === "TIMEOUT"
            ? "That's taking longer than expected reaching Circle. Please try again."
            : "Couldn't load wallet details. Please try again.",
        );
        return;
      }
      const walletList = (data.wallets as Wallet[]) || [];
      setWallets(walletList);
      if (walletList.length > 0) {
        await loadUsdcBalance(userToken, walletList[0].id);
        setStatus("");
      } else {
        setStatus("");
      }
    } catch (err) {
      console.error("Failed to load wallet details:", err);
      setStatus("");
      setLoginError("Couldn't load wallet details. Please try again.");
    }
  };

  const handleConnect = async () => {
    setBusy(true);
    setStatus("Preparing secure session");

    let id: string | null = deviceId;
    if (!id) {
      setStatus("Connecting to Circle…");
      id = await fetchDeviceId();
      if (!id) {
        setBusy(false);
        return;
      }
    }

    try {
      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createDeviceToken", deviceId: id }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus("Couldn't start session");
        setBusy(false);
        return;
      }
      setDeviceToken(data.deviceToken);
      setDeviceEncryptionKey(data.deviceEncryptionKey);
      setCookie("deviceToken", data.deviceToken);
      setCookie("deviceEncryptionKey", data.deviceEncryptionKey);

      const sdk = sdkRef.current;
      if (!sdk) {
        setBusy(false);
        return;
      }

      const appId = resolveCircleAppId();
      const googleClientId = resolveGoogleClientId();

      setCookie("appId", appId);
      setCookie("google.clientId", googleClientId);

      sdk.updateConfigs({
        appSettings: { appId },
        loginConfigs: {
          deviceToken: data.deviceToken,
          deviceEncryptionKey: data.deviceEncryptionKey,
          google: {
            clientId: googleClientId,
            redirectUri: window.location.origin,
            selectAccountPrompt: true,
          },
        },
      });

      setStatus("Redirecting to Google");
      sdk.performLogin(SocialLoginProvider.GOOGLE);
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error ? err.message : "Couldn't start session";
      if (message.startsWith("Missing NEXT_PUBLIC_")) {
        setLoginError(message);
      }
      setStatus("Couldn't start session");
      setBusy(false);
    }
  };

  // Once Google login completes, auto-initialize the user and surface a challenge
  useEffect(() => {
    const run = async () => {
      if (!loginResult?.userToken) return;
      setBusy(true);
      setStatus("Setting up your wallet…");
      try {
        const response = await fetch("/api/endpoints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "initializeUser",
            userToken: loginResult.userToken,
          }),
        });
        const data = await response.json();

        if (!response.ok) {
          if (data.code === 155106) {
            // Already initialized — just load the existing wallet
            setStatus("Loading your wallet…");
            await loadWallets(loginResult.userToken);
            setBusy(false);
            return;
          }
          if (data.code === "TIMEOUT") {
            setStatus("");
            setLoginError(
              "That's taking longer than expected reaching Circle. Please try again.",
            );
            setBusy(false);
            return;
          }
          setStatus("Couldn't set up your wallet");
          setBusy(false);
          return;
        }

        setChallengeId(data.challengeId);
        setStatus("");
        setBusy(false);
      } catch (err) {
        console.error(err);
        setStatus("Couldn't set up your wallet");
        setBusy(false);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginResult?.userToken]);

  const handleCreateWallet = () => {
    const sdk = sdkRef.current;
    if (!sdk || !challengeId || !loginResult) return;

    sdk.setAuthentication({
      userToken: loginResult.userToken,
      encryptionKey: loginResult.encryptionKey,
    });

    setBusy(true);
    setStatus("Confirm in the popup to finish creating your wallet");

    sdk.execute(challengeId, (error) => {
      if (error) {
        console.error("Execute challenge failed:", error);
        setStatus("Wallet setup didn't complete");
        setBusy(false);
        return;
      }

      setStatus("Finishing up");
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        setChallengeId(null);
        await loadWallets(loginResult.userToken);
        setBusy(false);
      })();
    });
  };

  const handleCircleSignOut = () => {
    // Clear everything tied to the Circle/Google session so the app
    // returns cleanly to the login screen. This doesn't delete or affect
    // the wallet itself — it just ends the local session. Signing back in
    // with the same Google account restores access to the same wallet.
    deleteCookie("appId");
    deleteCookie("google.clientId");
    deleteCookie("deviceToken");
    deleteCookie("deviceEncryptionKey");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("deviceId");
    }
    setLoginResult(null);
    setLoginError(null);
    setChallengeId(null);
    setWallets([]);
    setUsdcBalance(null);
    setEurcBalance(null);
    setCirBtcBalance(null);
    setUsdcTokenId(null);
    setDeviceToken("");
    setDeviceEncryptionKey("");
    setStatus("");
  };

  const primaryWallet = wallets[0];

  // Unify both connection paths into one "are we connected" state.
  const connected = primaryWallet
    ? {
        source: "circle" as const,
        address: primaryWallet.address,
        blockchain: primaryWallet.blockchain,
        balance: usdcBalance ?? "0.00",
      }
    : isInjectedConnected && injectedAddress
      ? {
          source: "wallet" as const,
          address: injectedAddress,
          blockchain: w3sBlockchainLabel,
          balance: injectedUsdcOnArc.formatted ?? "0.00",
        }
      : null;

  // Network label for the Receive panel. For an external wallet, use the chain
  // it's actually on (from the live chainId); for a Google wallet, use the
  // Circle wallet's own blockchain. The address is valid regardless of network.
  const receiveNetworkLabel =
    connected?.source === "wallet"
      ? bridgeChainByNumericId(injectedChainId)?.label ?? "your connected network"
      : connected?.blockchain ?? "your wallet's network";

  let step: Step = "start";
  if (primaryWallet) step = "wallet";
  else if (challengeId) step = "init";
  else if (loginResult) step = "auth";
  else if (deviceToken) step = "device";

  const injectedConnector = connectors.find((c) => c.type === "injected");

  // wagmi auto-discovers every EIP-6963-announced wallet as its own
  // connector (MetaMask, Phantom, OKX, etc.) — but they all still carry
  // type "injected" internally, same as the generic fallback connector.
  // So we exclude the fallback by its literal name instead, not its type,
  // otherwise every real wallet gets filtered out along with it.
  const pickableConnectors = (() => {
    const named = connectors.filter(
      (c, i, arr) =>
        c.name !== "Injected" && arr.findIndex((x) => x.name === c.name) === i,
    );
    return named.length > 0 ? named : connectors;
  })();

  useEffect(() => {
    console.log(
      "[Vector] detected wallet connectors:",
      connectors.map((c) => ({ name: c.name, type: c.type, uid: c.uid })),
    );
  }, [connectors]);

  const appNav =
    connected
      ? {
          onSwap: () => setShowSwap(true),
          onBridge: () => setShowBridge(true),
          onEarn: () => setShowEarn(true),
          onSend: () => setShowSend(true),
          onReceive: () => setShowReceive(true),
          onHistory: () => setShowHistory(true),
        }
      : null;

  return (
    <main className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--vector-line)] bg-[var(--vector-bg)]/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[var(--vector-max-content)] items-center justify-between gap-4 px-6 py-4 md:px-10">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <VectorMark />
            <span className="text-[15px] font-semibold tracking-tight">
              Vector
            </span>
          </Link>

          <nav
            className="hidden md:flex items-center gap-1 text-[14px] font-medium"
            aria-label="Primary"
          >
            {appNav ? (
              <>
                <HeaderNavButton label="Swap" onClick={appNav.onSwap} />
                <HeaderNavButton label="Bridge" onClick={appNav.onBridge} />
                <HeaderNavButton label="Earn" onClick={appNav.onEarn} />
                <HeaderNavButton label="Send" onClick={appNav.onSend} />
                <HeaderNavButton label="Receive" onClick={appNav.onReceive} />
                <HeaderNavButton label="Activity" onClick={appNav.onHistory} />
              </>
            ) : (
              <>
                <a
                  href="#features"
                  className="px-3 py-2 rounded-lg text-[var(--vector-text-dim)] hover:text-[var(--vector-text)] transition-colors"
                >
                  Features
                </a>
                <a
                  href="#connect"
                  className="px-3 py-2 rounded-lg text-[var(--vector-text-dim)] hover:text-[var(--vector-text)] transition-colors"
                >
                  Connect
                </a>
              </>
            )}
          </nav>

          <span className="text-xs text-[var(--vector-text-dim)] font-mono shrink-0">
            {headerNetworkLabel}
          </span>
        </div>
      </header>

      {!connected && <DigitalMarquee />}

      <section className="flex-1 w-full mx-auto max-w-[var(--vector-max-content)] px-6 py-10 md:py-14 lg:py-16">
        <div
          className={`grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-12 lg:gap-16 ${
            connected ? "items-start" : "items-start lg:items-stretch"
          }`}
        >
          <div className="hidden lg:block pt-2" id="features">
            <ProductOverview connected={Boolean(connected)} />
          </div>

          <div
            id="connect"
            className="w-full max-w-[420px] mx-auto lg:mx-0 lg:max-w-[420px] scroll-mt-24 lg:flex lg:flex-col"
          >
          {!connected && (
            <div className="lg:flex lg:flex-col lg:flex-1 lg:min-h-[520px]">
              <div className="mb-8 lg:hidden">
                <LandingHero compact />
              </div>

              <p className="text-[12px] text-[var(--vector-text-dim)] mb-4 uppercase tracking-wide">
                Connect to get started
              </p>

              <button
                onClick={handleConnect}
                disabled={!sdkReady || busy}
                className="w-full h-[52px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[15px] flex items-center justify-center gap-2.5 transition-opacity disabled:opacity-40 hover:opacity-90 active:opacity-80"
              >
                <GoogleMark />
                {busy
                  ? "Working…"
                  : deviceIdLoading
                    ? "Connecting to Circle…"
                    : "Continue with Google"}
              </button>

              {deviceIdError && (
                <div className="mt-3 text-center">
                  <p className="text-[12px] text-[var(--vector-pink)] leading-relaxed">
                    {deviceIdError}
                  </p>
                  <button
                    onClick={() => {
                      setDeviceIdError(null);
                      setDeviceId("");
                      if (typeof window !== "undefined") {
                        window.localStorage.removeItem("deviceId");
                      }
                      setSdkReady(false);
                      sdkRef.current = null;
                      window.location.reload();
                    }}
                    className="mt-2 text-[12px] text-[var(--vector-text-dim)] underline hover:text-[var(--vector-pink)]"
                  >
                    Retry
                  </button>
                </div>
              )}

              <div className="flex items-center gap-3 my-5">
                <span className="flex-1 h-px bg-[var(--vector-line)]" />
                <span className="text-[11px] text-[var(--vector-text-dim)] font-mono">
                  or
                </span>
                <span className="flex-1 h-px bg-[var(--vector-line)]" />
              </div>

              <div className="flex flex-col gap-5 mt-0 lg:flex-1 lg:min-h-[380px] lg:justify-evenly lg:gap-0 lg:py-4">
              <button
                onClick={() => {
                  if (pickableConnectors.length <= 1) {
                    const c = pickableConnectors[0] ?? injectedConnector;
                    if (c) connect({ connector: c });
                  } else {
                    setShowWalletPicker(true);
                  }
                }}
                disabled={pickableConnectors.length === 0 || isConnectPending}
                className="w-full h-[52px] rounded-full border border-[var(--vector-line)] text-[var(--vector-text)] font-semibold text-[15px] flex items-center justify-center gap-2.5 hover:border-[var(--vector-pink)] transition-colors disabled:opacity-40 shrink-0"
              >
                <WalletMark />
                {isConnectPending ? "Connecting…" : "Connect Wallet"}
              </button>

              <p className="text-[11px] text-[var(--vector-text-dim)] leading-relaxed text-center shrink-0">
                By connecting, you agree to our{" "}
                <Link href="/terms" className="text-[var(--vector-pink)] underline">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="text-[var(--vector-pink)] underline">
                  Privacy Policy
                </Link>
                .
              </p>

              {showWalletPicker && (
                <div
                  className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
                  onClick={() => setShowWalletPicker(false)}
                >
                  <div
                    className="w-full max-w-[380px] rounded-t-3xl sm:rounded-3xl border border-[var(--vector-line)] bg-[var(--vector-surface)] p-5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[15px] font-semibold">
                        Choose a wallet
                      </span>
                      <button
                        onClick={() => setShowWalletPicker(false)}
                        className="text-[var(--vector-text-dim)] text-[13px]"
                      >
                        Close
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {pickableConnectors.map((c) => (
                        <button
                          key={c.uid}
                          onClick={() => {
                            connect({ connector: c });
                            setShowWalletPicker(false);
                          }}
                          disabled={isConnectPending}
                          className="flex items-center gap-3 p-3 rounded-xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] hover:border-[var(--vector-pink)] transition-colors text-left disabled:opacity-40"
                        >
                          {c.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.icon}
                              alt=""
                              width={26}
                              height={26}
                              className="rounded-md"
                            />
                          ) : (
                            <span className="w-[26px] h-[26px] rounded-md bg-[var(--vector-line)] flex items-center justify-center text-[11px]">
                              {c.name.slice(0, 1)}
                            </span>
                          )}
                          <span className="text-[14px]">{c.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {(status || loginError || connectError || (step === "init" && challengeId)) && (
                <div className="flex flex-col gap-3 shrink-0">
              {status && (
                <p className="text-center text-[13px] text-[var(--vector-text-dim)] font-mono">
                  {status}
                </p>
              )}

              {loginError && (
                <p className="text-center text-[13px] text-[var(--vector-pink)] font-mono">
                  {loginError}
                </p>
              )}

              {connectError && (
                <p className="text-center text-[13px] text-[var(--vector-pink)] font-mono">
                  {connectError.message}
                </p>
              )}

              {step === "init" && challengeId && (
                <button
                  onClick={handleCreateWallet}
                  disabled={busy}
                  className="w-full h-[52px] rounded-full border border-[var(--vector-line)] text-[var(--vector-text)] font-semibold text-[15px] hover:border-[var(--vector-pink)] transition-colors disabled:opacity-40"
                >
                  Confirm wallet setup
                </button>
              )}
                </div>
              )}

              <StepDots step={step} className="lg:mt-0 shrink-0" />

              <p className="text-[12px] leading-relaxed text-[var(--vector-text-dim)] text-center shrink-0 lg:max-w-[340px] lg:mx-auto">
                Google sign-in wallets can&apos;t be recovered by Vector or
                Circle if you lose access to that account, so keep it secure.
              </p>
              </div>

              <div className="lg:hidden mt-12 pt-10 border-t border-[var(--vector-line)]">
                <ProductOverview connected={false} />
              </div>
            </div>
          )}

          {connected && (
            <>
              <WalletCard
                address={connected.address}
                blockchain={connected.blockchain}
                balance={connected.balance}
                cirBtcBalance={cirBtcBalance}
                source={connected.source}
                onSend={() => setShowSend(true)}
                onReceive={() => setShowReceive(true)}
                onSwap={() => setShowSwap(true)}
                onBridge={() => setShowBridge(true)}
                onEarn={() => setShowEarn(true)}
                onHistory={() => setShowHistory(true)}
                onDisconnect={
                  connected.source === "wallet"
                    ? () => disconnect()
                    : handleCircleSignOut
                }
              />
              <div className="lg:hidden mt-12 pt-10 border-t border-[var(--vector-line)]">
                <ProductOverview connected />
              </div>
            </>
          )}
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t border-[var(--vector-line)] flex flex-col items-center gap-4 px-6 py-8">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-[var(--vector-text-dim)]">
          <Link href="/terms" className="hover:text-[var(--vector-pink)] transition-colors">
            Terms
          </Link>
          <span className="text-[var(--vector-line)]" aria-hidden>
            ·
          </span>
          <Link href="/privacy" className="hover:text-[var(--vector-pink)] transition-colors">
            Privacy
          </Link>
        </div>
        <div className="flex items-center justify-center gap-5">
        <SocialLink
          href="https://github.com/Isaaco3349/Vector"
          label="Vector on GitHub"
        >
          <GitHubMark />
        </SocialLink>
        <SocialLink href="https://x.com/Vector_protocol" label="Vector on X">
          <XMark />
        </SocialLink>
        <SocialLink
          href="mailto:vectorprotocol7@gmail.com"
          label="Email Vector"
        >
          <MailMark />
        </SocialLink>
        </div>
      </footer>

      {showSwap && connected?.source === "wallet" && (
        <SwapPanel onClose={() => setShowSwap(false)} />
      )}

      {showSwap &&
        connected?.source === "circle" &&
        primaryWallet &&
        loginResult &&
        sdkRef.current && (
          <GoogleSwapPanel
            sdk={sdkRef.current}
            auth={loginResult}
            walletId={primaryWallet.id}
            walletAddress={primaryWallet.address}
            tokenBalances={{
              USDC: usdcBalance,
              EURC: eurcBalance,
              cirBTC: cirBtcBalance,
            }}
            onClose={() => setShowSwap(false)}
            onSuccess={() => {
              void loadUsdcBalance(loginResult.userToken, primaryWallet.id);
            }}
          />
        )}

      {showBridge && connected?.source === "wallet" && (
        <BridgePanel onClose={() => setShowBridge(false)} />
      )}

      {showBridge &&
        connected?.source === "circle" &&
        primaryWallet &&
        loginResult &&
        sdkRef.current && (
          <GoogleBridgePanel
            sdk={sdkRef.current}
            auth={loginResult}
            walletId={primaryWallet.id}
            walletAddress={primaryWallet.address}
            balance={usdcBalance}
            onClose={() => setShowBridge(false)}
            onSuccess={() => {
              void loadUsdcBalance(loginResult.userToken, primaryWallet.id);
            }}
          />
        )}

      {showSend && connected?.source === "wallet" && (
        <SendPanel onClose={() => setShowSend(false)} />
      )}

      {showSend &&
        connected?.source === "circle" &&
        primaryWallet &&
        loginResult &&
        sdkRef.current && (
          <GoogleSendPanel
            sdk={sdkRef.current}
            auth={loginResult}
            walletId={primaryWallet.id}
            walletAddress={primaryWallet.address}
            tokenId={usdcTokenId}
            balance={usdcBalance}
            onClose={() => setShowSend(false)}
            onSuccess={() => {
              void loadUsdcBalance(loginResult.userToken, primaryWallet.id);
            }}
          />
        )}

      {showEarn && connected?.source === "wallet" && (
        <EarnPanel onClose={() => setShowEarn(false)} />
      )}

      {showEarn &&
        connected?.source === "circle" &&
        primaryWallet &&
        loginResult &&
        sdkRef.current && (
          <GoogleEarnPanel
            sdk={sdkRef.current}
            auth={loginResult}
            walletId={primaryWallet.id}
            walletAddress={primaryWallet.address}
            usdcBalance={usdcBalance}
            onClose={() => setShowEarn(false)}
            onSuccess={() => {
              void loadUsdcBalance(loginResult.userToken, primaryWallet.id);
            }}
          />
        )}

      {showReceive && connected && (
        <ReceivePanel
          address={connected.address}
          networkLabel={receiveNetworkLabel}
          onClose={() => setShowReceive(false)}
        />
      )}

      {showHistory && connected && (
        <HistoryPanel
          source={connected.source}
          walletAddress={connected.address}
          userToken={
            connected.source === "circle" ? loginResult?.userToken : undefined
          }
          walletId={
            connected.source === "circle" ? primaryWallet?.id : undefined
          }
          numericChainId={
            connected.source === "wallet" ? injectedChainId : undefined
          }
          onClose={() => setShowHistory(false)}
        />
      )}
    </main>
  );
}

function StepDots({ step, className }: { step: Step; className?: string }) {
  const order: Step[] = ["start", "device", "auth", "init", "wallet"];
  const idx = Math.max(order.indexOf(step), 0);
  return (
    <div
      className={`mt-8 flex items-center justify-center gap-1.5 ${className ?? ""}`}
    >
      {order.slice(0, 4).map((_, i) => (
        <span
          key={i}
          className="h-[3px] rounded-full transition-all duration-300"
          style={{
            width: i <= idx ? 20 : 10,
            background:
              i <= idx ? "var(--vector-pink)" : "var(--vector-line)",
          }}
        />
      ))}
    </div>
  );
}

function WalletCard({
  address,
  blockchain,
  balance,
  cirBtcBalance,
  source,
  onSend,
  onReceive,
  onSwap,
  onBridge,
  onEarn,
  onHistory,
  onDisconnect,
}: {
  address: string;
  blockchain: string;
  balance: string | null;
  cirBtcBalance?: string | null;
  source: "circle" | "wallet";
  onSend?: () => void;
  onReceive?: () => void;
  onSwap?: () => void;
  onBridge?: () => void;
  onEarn?: () => void;
  onHistory?: () => void;
  onDisconnect?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  // Multi-asset portfolio: show cirBTC alongside USDC.
  // - External wallet: read it on-chain (decimals read on-chain, never guessed).
  //   The hook self-disables when wagmi isn't connected, so it's inert for the
  //   Google path.
  // - Google (Circle) wallet: comes in via the cirBtcBalance prop, parsed from
  //   Circle's balances endpoint upstream.
  const cirBtcOnChain = useTokenBalance("cirBTC");
  const cirBtc =
    source === "wallet" ? cirBtcOnChain.formatted : cirBtcBalance ?? null;
  const cirBtcNum = cirBtc !== null && cirBtc !== "" ? Number(cirBtc) : null;
  const hasCirBtc = cirBtcNum !== null && Number.isFinite(cirBtcNum) && cirBtcNum > 0;

  // Arc's gas token IS USDC, so a 0-balance wallet is stuck until funded — show
  // a faucet nudge in that case.
  const balanceNum = balance !== null && balance !== "" ? Number(balance) : null;
  const needsFunds = balanceNum !== null && Number.isFinite(balanceNum) && balanceNum === 0;

  return (
    <div className="rounded-3xl border border-[var(--vector-line)] bg-[var(--vector-surface)] p-7">
      <div className="flex items-center justify-between gap-3 mb-8">
        <WalletMetaBadge
          href="https://www.arc.io"
          title="Arc — Circle's USDC-native L1 (opens arc.io)"
        >
          <span className="font-mono uppercase tracking-wider">{blockchain}</span>
          <ArcLinkIcon />
        </WalletMetaBadge>
        <WalletMetaBadge role="status">
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-[var(--vector-pink)]"
            aria-hidden
          />
          {source === "circle" ? "Google wallet" : "External wallet"}
        </WalletMetaBadge>
      </div>

      <p className="text-[13px] text-[var(--vector-text-dim)] mb-1.5">
        Balance
      </p>
      <p className="text-[40px] font-semibold tracking-tight mb-8">
        {balance ?? "0.00"}{" "}
        <span className="text-[18px] text-[var(--vector-text-dim)] font-mono">
          USDC
        </span>
      </p>

      {/* Multi-asset portfolio — when the wallet also holds cirBTC, break the
          holdings out so Vector reads as a portfolio, not a single-balance
          wallet. Hidden for USDC-only wallets to keep the card clean. Built to
          take more rows as new verified assets are added. */}
      {hasCirBtc && (
        <div className="mb-6 rounded-2xl bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] overflow-hidden">
          <div className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-wide text-[var(--vector-text-dim)]">
            Assets
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--vector-line)]">
            <span className="flex items-center gap-2 text-[14px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--vector-pink)]" />
              USDC
            </span>
            <span className="text-[14px] font-mono">{balance ?? "0.00"}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--vector-line)]">
            <span className="flex items-center gap-2 text-[14px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--vector-text-dim)]" />
              cirBTC
            </span>
            <span className="text-[14px] font-mono">{cirBtc}</span>
          </div>
        </div>
      )}

      {/* Arc gas is paid in USDC, so a 0-balance wallet can't do anything until
          it's funded. Nudge new users straight to the faucet. */}
      {needsFunds && isTestnet && arcFaucetUrl && (
        <a
          href={arcFaucetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block mb-6 rounded-2xl border border-[var(--vector-pink)] bg-[var(--vector-surface-raised)] px-4 py-3 hover:opacity-90 transition-opacity"
        >
          <p className="text-[13px] font-semibold text-[var(--vector-text)] mb-0.5">
            Get test USDC to get started ↗
          </p>
          <p className="text-[12px] leading-relaxed text-[var(--vector-text-dim)]">
            Arc pays gas in USDC, so your wallet needs a little before you can
            send, swap, or bridge. Claim free test USDC from the faucet.
          </p>
        </a>
      )}

      {needsFunds && !isTestnet && onBridge && (
        <button
          type="button"
          onClick={onBridge}
          className="block w-full mb-6 rounded-2xl border border-[var(--vector-pink)] bg-[var(--vector-surface-raised)] px-4 py-3 hover:opacity-90 transition-opacity text-left"
        >
          <p className="text-[13px] font-semibold text-[var(--vector-text)] mb-0.5">
            Bridge USDC to Arc
          </p>
          <p className="text-[12px] leading-relaxed text-[var(--vector-text-dim)]">
            Arc pays gas in USDC. Bridge USDC from another network to fund this
            wallet before you send, swap, or earn.
          </p>
        </button>
      )}

      {/* Wallet actions — Send / Receive / Swap / Bridge / Earn are all live for
          both external and Google (Circle) wallets. */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <button
          onClick={onSend}
          className="h-[48px] rounded-full bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] font-semibold text-[14px] text-[var(--vector-text)] hover:border-[var(--vector-pink)] transition-colors"
        >
          Send
        </button>
        <button
          onClick={onReceive}
          className="h-[48px] rounded-full bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] font-semibold text-[14px] text-[var(--vector-text)] hover:border-[var(--vector-pink)] transition-colors"
        >
          Receive
        </button>
      </div>
      <button
        onClick={onSwap}
        className="w-full h-[48px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[14px] mb-3 hover:opacity-90 active:opacity-80 transition-opacity"
      >
        Swap
      </button>
      <button
        onClick={onBridge}
        className="w-full h-[48px] rounded-full border border-[var(--vector-pink)] text-[var(--vector-pink)] font-semibold text-[14px] mb-3 hover:bg-[var(--vector-pink)] hover:text-[#0b0b0e] active:opacity-80 transition-colors"
      >
        Bridge USDC
      </button>
      <button
        onClick={onEarn}
        className="w-full h-[48px] rounded-full border border-[var(--vector-line)] text-[var(--vector-text)] font-semibold text-[14px] mb-3 hover:border-[var(--vector-pink)] active:opacity-80 transition-colors"
      >
        Earn USDC
      </button>

      <button
        onClick={() => {
          navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="w-full h-[48px] rounded-full bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] font-mono text-[13px] text-[var(--vector-text)] hover:border-[var(--vector-pink)] transition-colors"
      >
        {copied ? "Copied" : short}
      </button>

      {isTestnet && arcFaucetUrl && (
        <a
          href={arcFaucetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center h-[44px] rounded-full bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] font-semibold text-[13px] text-[var(--vector-text-dim)] hover:border-[var(--vector-pink)] hover:text-[var(--vector-text)] transition-colors"
        >
          Get test USDC (Faucet) ↗
        </a>
      )}

      {onHistory && (
        <button
          onClick={onHistory}
          className="w-full mt-3 h-[44px] rounded-full bg-[var(--vector-surface-raised)] border border-[var(--vector-line)] font-semibold text-[13px] text-[var(--vector-text-dim)] hover:border-[var(--vector-pink)] hover:text-[var(--vector-text)] transition-colors"
        >
          Activity
        </button>
      )}

      {onDisconnect && (
        <button
          onClick={onDisconnect}
          className="w-full mt-3 text-[12px] text-[var(--vector-text-dim)] hover:text-[var(--vector-pink)] transition-colors"
        >
          {source === "circle" ? "Sign out" : "Disconnect"}
        </button>
      )}
    </div>
  );
}

const WALLET_META_BADGE =
  "inline-flex items-center gap-2 rounded-md border border-[var(--vector-line)] bg-[var(--vector-surface-raised)] px-3 py-1.5 text-[11px] font-semibold tracking-wide text-[var(--vector-text)] shadow-sm transition-colors";

function WalletMetaBadge({
  children,
  href,
  title,
  role,
}: {
  children: ReactNode;
  href?: string;
  title?: string;
  role?: "status";
}) {
  const className = `${WALLET_META_BADGE}${href ? " hover:border-[var(--vector-pink)]" : ""}`;
  if (href) {
    return (
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        title={title}
      >
        {children}
      </Link>
    );
  }
  return (
    <span className={className} role={role}>
      {children}
    </span>
  );
}

function ArcLinkIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className="text-[var(--vector-text-dim)] shrink-0"
      aria-hidden
    >
      <path
        d="M3.5 2h6v6M9 3 3 9"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeaderNavButton({
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-2 rounded-lg text-[var(--vector-text-dim)] hover:text-[var(--vector-text)] hover:bg-[var(--vector-surface)] transition-colors"
    >
      {label}
    </button>
  );
}

function LandingHero({ compact }: { compact?: boolean }) {
  return (
    <div className={compact ? "mb-0" : "mb-10"}>
      <h1
        className={
          compact
            ? "text-[32px] leading-[1.15] font-semibold tracking-tight mb-3"
            : "text-[40px] lg:text-[44px] leading-[1.1] font-semibold tracking-tight mb-4"
        }
      >
        <span className="text-[var(--vector-pink)]">All on Arc.</span>
      </h1>
      <p
        className={
          compact
            ? "text-[var(--vector-text-dim)] text-[15px] leading-relaxed"
            : "text-[var(--vector-text-dim)] text-[16px] lg:text-[17px] leading-relaxed max-w-xl"
        }
      >
        Vector is a home base for USDC-native DeFi on Circle&apos;s Arc network:
        trade, earn yield, and move USDC across chains — with Google sign-in or
        your own wallet.
      </p>
    </div>
  );
}

function ProductOverview({ connected }: { connected: boolean }) {
  return (
    <div className="space-y-10">
      {!connected && <LandingHero />}

      {connected && (
        <div>
          <p className="text-[12px] uppercase tracking-wide text-[var(--vector-text-dim)] mb-2">
            Your hub
          </p>
          <h2 className="text-[28px] font-semibold tracking-tight mb-3">
            Manage USDC on Arc
          </h2>
          <p className="text-[15px] leading-relaxed text-[var(--vector-text-dim)] max-w-lg">
            Use the card to send, swap, bridge, or earn. Top navigation mirrors
            the same actions on desktop.
          </p>
        </div>
      )}

      <div className="space-y-4">
        <FeatureBlurb
          title="Swap"
          body="Same-chain USDC ↔ EURC on Arc through Circle App Kit, with transparent Vector fees shown before you confirm."
        />
        <FeatureBlurb
          title="Bridge"
          body="CCTP v2 cross-chain USDC — burn on the source chain, mint on the destination via Circle's relayer. Arc, Base, Ethereum, and more."
        />
        <FeatureBlurb
          title="Earn"
          body="Deposit USDC into Morpho-style vaults on Arc. Withdraw anytime. Available for Google and external wallets."
        />
      </div>

      <p className="text-[13px] leading-relaxed text-[var(--vector-text-dim)] max-w-lg">
        Arc uses USDC for gas, so one balance covers fees and transfers. New here?{" "}
        <Link href="/terms" className="text-[var(--vector-pink)] underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="text-[var(--vector-pink)] underline">
          Privacy
        </Link>{" "}
        explain how Vector and Circle handle your data.
      </p>
    </div>
  );
}

function FeatureBlurb({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-2xl border border-[var(--vector-line)] bg-[var(--vector-surface)]/60 p-5">
      <h3 className="text-[15px] font-semibold mb-2">{title}</h3>
      <p className="text-[14px] leading-relaxed text-[var(--vector-text-dim)]">
        {body}
      </p>
    </article>
  );
}

function WalletMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect
        x="2"
        y="4.5"
        width="14"
        height="10"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M2 7.5H16"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="12.5" cy="10.8" r="1" fill="currentColor" />
    </svg>
  );
}

function VectorMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M3 3L11 19L19 3"
        stroke="var(--vector-pink)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.64z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.27c-.81.54-1.85.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.7A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.29-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  // Only http(s) links open in a new tab; mailto: opens the mail client in place.
  const isExternal = href.startsWith("http");
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="text-[var(--vector-text-dim)] hover:text-[var(--vector-pink)] transition-colors"
    >
      {children}
    </a>
  );
}

function GitHubMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.23 1.84 1.23 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.22.7.83.58C20.56 22.29 24 17.8 24 12.5 24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

function XMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function MailMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect
        x="2"
        y="4"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M2.5 5.5L9 9.5L15.5 5.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
