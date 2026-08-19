"use client";

import { useEffect, useRef, useState } from "react";
import { setCookie, getCookie, deleteCookie } from "cookies-next";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useBalance,
} from "wagmi";
import { formatUnits } from "viem";
import { SwapPanel } from "./components/SwapPanel";
import { BridgePanel } from "./components/BridgePanel";
import { SendPanel } from "./components/SendPanel";
import { ReceivePanel } from "./components/ReceivePanel";
import { EarnPanel } from "./components/EarnPanel";
import { bridgeChainByNumericId } from "./lib/bridge-chains";

const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID as string;
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID as string;

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
  const { data: injectedBalance } = useBalance({
    address: injectedAddress,
    query: { enabled: Boolean(injectedAddress) },
  });
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const [showBridge, setShowBridge] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showEarn, setShowEarn] = useState(false);

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

        const restoredAppId = (getCookie("appId") as string) || appId || "";
        const restoredGoogleClientId =
          (getCookie("google.clientId") as string) || googleClientId || "";
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
  const deviceIdFetchRef = useRef<Promise<string | null> | null>(null);

  const fetchDeviceId = async (attempt = 1): Promise<string | null> => {
    if (!sdkRef.current) return null;
    try {
      const cached =
        typeof window !== "undefined"
          ? window.localStorage.getItem("deviceId")
          : null;
      if (cached) {
        setDeviceId(cached);
        setDeviceIdError(null);
        return cached;
      }
      setDeviceIdLoading(true);
      const id = await sdkRef.current.getDeviceId();
      setDeviceId(id);
      setDeviceIdError(null);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("deviceId", id);
      }
      return id;
    } catch (error) {
      console.error(`Failed to get deviceId (attempt ${attempt}):`, error);
      // This step talks to a hidden Circle iframe over postMessage — a
      // heavy set of competing wallet extensions on some browser profiles
      // can delay or break that handshake. A short retry clears most of
      // those cases.
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        return fetchDeviceId(attempt + 1);
      }
      setDeviceIdError(
        "Couldn't reach Circle's login service. This can happen when several wallet extensions are active at once, try disabling some, or use an Incognito window, then retry.",
      );
      return null;
    } finally {
      setDeviceIdLoading(false);
    }
  };

  useEffect(() => {
    // Quietly try in the background as soon as the SDK is ready, so
    // returning users (with a cached deviceId) see an instantly-usable
    // button. If it's not ready yet by the time someone clicks, handleConnect
    // below fetches it on demand instead of leaving the button disabled.
    if (sdkReady && !deviceIdFetchRef.current) {
      deviceIdFetchRef.current = fetchDeviceId();
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
          blockchain: "ARC-TESTNET",
          balance: injectedBalance
            ? Number(
                formatUnits(injectedBalance.value, injectedBalance.decimals),
              ).toFixed(2)
            : "0.00",
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

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2">
          <VectorMark />
          <span className="text-[15px] font-semibold tracking-tight">
            Vector
          </span>
        </div>
        <span className="text-xs text-[var(--vector-text-dim)] font-mono">
          Arc Testnet
        </span>
      </header>

      <section className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-[420px]">
          {!connected && (
            <>
              <div className="mb-8">
                <h1 className="text-[32px] leading-[1.15] font-semibold tracking-tight mb-3">
                  Swap. Stake. Lend.
                  <br />
                  Bridge. Farm.
                  <br />
                  <span className="text-[var(--vector-pink)]">
                    All on Arc.
                  </span>
                </h1>
                <p className="text-[var(--vector-text-dim)] text-[15px] leading-relaxed">
                  Vector is a home base for USDC-native DeFi on Circle&apos;s
                  Arc network: one place to trade, earn, and move value,
                  whether you&apos;re new to crypto or bringing a wallet you
                  already trust.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-8">
                <FeaturePill label="Swap" />
                <FeaturePill label="Stake" />
                <FeaturePill label="Lend" />
                <FeaturePill label="Borrow" />
                <FeaturePill label="Bridge" />
                <FeaturePill label="Yield" />
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
                className="w-full h-[52px] rounded-full border border-[var(--vector-line)] text-[var(--vector-text)] font-semibold text-[15px] flex items-center justify-center gap-2.5 hover:border-[var(--vector-pink)] transition-colors disabled:opacity-40"
              >
                <WalletMark />
                {isConnectPending ? "Connecting…" : "Connect Wallet"}
              </button>

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

              {status && (
                <p className="mt-4 text-center text-[13px] text-[var(--vector-text-dim)] font-mono">
                  {status}
                </p>
              )}

              {loginError && (
                <p className="mt-4 text-center text-[13px] text-[var(--vector-pink)] font-mono">
                  {loginError}
                </p>
              )}

              {connectError && (
                <p className="mt-4 text-center text-[13px] text-[var(--vector-pink)] font-mono">
                  {connectError.message}
                </p>
              )}

              {step === "init" && challengeId && (
                <button
                  onClick={handleCreateWallet}
                  disabled={busy}
                  className="mt-4 w-full h-[52px] rounded-full border border-[var(--vector-line)] text-[var(--vector-text)] font-semibold text-[15px] hover:border-[var(--vector-pink)] transition-colors disabled:opacity-40"
                >
                  Confirm wallet setup
                </button>
              )}

              <StepDots step={step} />

              <p className="mt-10 text-[12px] leading-relaxed text-[var(--vector-text-dim)] text-center">
                Google sign-in wallets can&apos;t be recovered by Vector or
                Circle if you lose access to that account, so keep it secure.
              </p>
            </>
          )}

          {connected && (
            <WalletCard
              address={connected.address}
              blockchain={connected.blockchain}
              balance={connected.balance}
              source={connected.source}
              onSend={
                connected.source === "wallet"
                  ? () => setShowSend(true)
                  : undefined
              }
              onReceive={() => setShowReceive(true)}
              onSwap={
                connected.source === "wallet"
                  ? () => setShowSwap(true)
                  : undefined
              }
              onBridge={
                connected.source === "wallet"
                  ? () => setShowBridge(true)
                  : undefined
              }
              onEarn={
                connected.source === "wallet"
                  ? () => setShowEarn(true)
                  : undefined
              }
              onDisconnect={
                connected.source === "wallet"
                  ? () => disconnect()
                  : handleCircleSignOut
              }
            />
          )}
        </div>
      </section>

      {showSwap && connected?.source === "wallet" && (
        <SwapPanel onClose={() => setShowSwap(false)} />
      )}

      {showBridge && connected?.source === "wallet" && (
        <BridgePanel onClose={() => setShowBridge(false)} />
      )}

      {showSend && connected?.source === "wallet" && (
        <SendPanel onClose={() => setShowSend(false)} />
      )}

      {showEarn && connected?.source === "wallet" && (
        <EarnPanel onClose={() => setShowEarn(false)} />
      )}

      {showReceive && connected && (
        <ReceivePanel
          address={connected.address}
          networkLabel={receiveNetworkLabel}
          onClose={() => setShowReceive(false)}
        />
      )}
    </main>
  );
}

function StepDots({ step }: { step: Step }) {
  const order: Step[] = ["start", "device", "auth", "init", "wallet"];
  const idx = Math.max(order.indexOf(step), 0);
  return (
    <div className="mt-8 flex items-center justify-center gap-1.5">
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
  source,
  onSend,
  onReceive,
  onSwap,
  onBridge,
  onEarn,
  onDisconnect,
}: {
  address: string;
  blockchain: string;
  balance: string | null;
  source: "circle" | "wallet";
  onSend?: () => void;
  onReceive?: () => void;
  onSwap?: () => void;
  onBridge?: () => void;
  onEarn?: () => void;
  onDisconnect?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  return (
    <div className="rounded-3xl border border-[var(--vector-line)] bg-[var(--vector-surface)] p-7">
      <div className="flex items-center justify-between mb-8">
        <span className="text-[13px] text-[var(--vector-text-dim)] font-mono">
          {blockchain}
        </span>
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--vector-text-dim)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--vector-pink)]" />
          {source === "circle" ? "Google wallet" : "external wallet"}
        </span>
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

      {/* Wallet actions. Send/Receive/Swap/Bridge/Earn are live for external
          wallets; Receive also works for Google wallets, while the rest there
          are honestly flagged as coming next. */}
      {source === "wallet" ? (
        <>
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
        </>
      ) : (
        <>
          <button
            onClick={onReceive}
            className="w-full h-[48px] rounded-full bg-[var(--vector-pink)] text-[#0b0b0e] font-semibold text-[14px] mb-3 hover:opacity-90 active:opacity-80 transition-opacity"
          >
            Receive
          </button>
          <div className="w-full rounded-2xl border border-[var(--vector-line)] px-4 py-3 mb-3 text-center">
            <span className="text-[12px] leading-relaxed text-[var(--vector-text-dim)]">
              Send, Swap, Bridge &amp; Earn for Google login are coming next —
              all four are already live with an external wallet like MetaMask.
            </span>
          </div>
        </>
      )}

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

function FeaturePill({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-[var(--vector-line)] bg-[var(--vector-surface)] py-2.5 text-center">
      <span className="text-[12px] text-[var(--vector-text-dim)]">
        {label}
      </span>
    </div>
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
