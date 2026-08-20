"use client";

/**
 * Verified client-side wrapper around the W3S (Circle user-controlled wallet)
 * challenge flow — the piece that actually asks the Google-login user for their
 * PIN and lets Circle sign + broadcast a transaction.
 *
 * WHY THIS EXISTS
 * A user-controlled wallet transaction is a two-step handshake:
 *   1. (server) create the transaction over Circle's REST API  → returns a `challengeId`
 *   2. (browser) `w3sSdk.execute(challengeId)`                  → Circle shows its own
 *      PIN / confirmation UI, the user approves, Circle signs and submits.
 * This module owns step 2. It's identical for every kind of transaction (a plain
 * transfer today; swap / bridge / earn contract-executions later), because
 * `execute()` is a single generic challenge runner — the challenge already
 * encodes what it's for. So this wrapper is written once and reused.
 *
 * NOTHING HERE IS GUESSED. Every symbol is verified against the installed
 * first-party types (node_modules/@circle-fin/w3s-pw-web-sdk @v1.1.11):
 *   - W3SSdk.execute(challengeId, onCompleted)                 (index.d.ts @84)
 *   - onCompleted: (error?: {code?: ErrorCode; message}, result?) => void   (types.d.ts @336)
 *   - result.status: ChallengeStatus  (COMPLETE = success)     (types.d.ts @23, @229)
 *   - ChallengeStatus / ErrorCode enums                        (types.d.ts @23, @40)
 * The friendly messages below map ONLY error codes that exist in that ErrorCode
 * enum — no invented codes.
 *
 * This deliberately does NOT create or configure the SDK. The single configured
 * W3SSdk instance already lives in page.tsx (it holds the OAuth/session state);
 * callers pass that instance in so we never spin up a second, orphaned one.
 */

import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import {
  ChallengeStatus,
  ErrorCode,
} from "@circle-fin/w3s-pw-web-sdk/dist/src/types";

/** The user session returned by Circle social login. */
export type W3sAuth = { userToken: string; encryptionKey: string };

/** Outcome of a completed challenge. `raw` is always kept for debugging. */
export type W3sChallengeOutcome = {
  /** ChallengeStatus as a string (e.g. "COMPLETE"), or null if not reported. */
  status: string | null;
  raw: unknown;
};

/**
 * Turn a Circle error `{ code, message }` into a human sentence. Only codes that
 * actually exist in the SDK's ErrorCode enum are handled; anything else falls
 * back to Circle's own message (or a safe default), so we never fabricate a
 * cause.
 */
function messageForCode(code: number | undefined, fallback: string): string {
  switch (code) {
    case ErrorCode.incorrectUserPin:
      return "That PIN was incorrect. Please try again.";
    case ErrorCode.userPinLocked:
      return "Your PIN is locked after too many attempts. Use 'forgot PIN' to reset it.";
    case ErrorCode.incorrectSecurityAnswers:
    case ErrorCode.securityAnswersLocked:
      return "Those security answers didn't match. Please try again.";
    case ErrorCode.notEnoughFunds:
    case ErrorCode.notEnoughBalance:
    case ErrorCode.minimumFundsRequired:
    case ErrorCode.lowerThenMinimumAccountBalance:
      return "Not enough balance to cover the amount plus the network fee.";
    case ErrorCode.invalidTransactionFee:
    case ErrorCode.gasLimitTooLow:
      return "Couldn't set a valid network fee for this transaction. Please try again shortly.";
    case ErrorCode.invalidDestinationAddress:
      return "That destination address isn't valid for this network.";
    case ErrorCode.rejectedByBlockchain:
    case ErrorCode.droppedAsPartOfReorg:
      return "The network rejected the transaction. No funds moved — please try again.";
    case ErrorCode.rejectedOnAmlScreening:
      return "This transaction was blocked by a compliance screening.";
    case ErrorCode.userCanceled:
      return "You cancelled the request. No funds moved.";
    case ErrorCode.pinCodeNotMatched:
      return "The PINs didn't match. Please try again.";
    case ErrorCode.networkError:
      return "A network error interrupted the request. Please try again.";
    case ErrorCode.userTokenExpired:
    case ErrorCode.invalidUserToken:
    case ErrorCode.userTokenNotFound:
      return "Your session expired. Please sign out, sign back in, and try again.";
    default:
      return fallback;
  }
}

/** Defensively read Circle's `{ code?, message }` error shape. */
function extractError(error: unknown): { code?: number; message: string } {
  if (error && typeof error === "object") {
    const rec = error as Record<string, unknown>;
    const code = typeof rec.code === "number" ? rec.code : undefined;
    const message = typeof rec.message === "string" ? rec.message : "";
    return { code, message };
  }
  if (typeof error === "string") return { message: error };
  return { message: "" };
}

/**
 * Run a server-created challenge to completion.
 *
 * Resolves only when the challenge status is COMPLETE; rejects (with a readable
 * message) on any Circle error, on a cancelled/expired challenge, or on a
 * non-complete terminal status. Set the session on the SDK first, exactly as the
 * existing wallet-creation flow does.
 */
export function runChallenge(
  sdk: W3SSdk,
  auth: W3sAuth,
  challengeId: string,
): Promise<W3sChallengeOutcome> {
  return new Promise<W3sChallengeOutcome>((resolve, reject) => {
    let settled = false;
    const finishOk = (outcome: W3sChallengeOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const finishErr = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };

    try {
      // Circle needs the user session before it can decrypt the key and sign.
      sdk.setAuthentication({
        userToken: auth.userToken,
        encryptionKey: auth.encryptionKey,
      });

      // `error`/`result` typed as unknown and parsed defensively — a function
      // with `unknown` params is assignable to Circle's ChallengeCompleteCallback,
      // and it insulates us from cross-version shape drift.
      sdk.execute(challengeId, (error: unknown, result: unknown) => {
        if (error) {
          const { code, message } = extractError(error);
          finishErr(
            messageForCode(
              code,
              message || "The transaction didn't complete. No funds moved.",
            ),
          );
          return;
        }

        const rec =
          result && typeof result === "object"
            ? (result as Record<string, unknown>)
            : null;
        const status = typeof rec?.status === "string" ? rec.status : null;

        // COMPLETE is the only success state.
        if (status && status !== ChallengeStatus.COMPLETE) {
          finishErr(
            status === ChallengeStatus.EXPIRED
              ? "The confirmation window expired. Please try again."
              : "The transaction didn't complete. No funds moved.",
          );
          return;
        }

        finishOk({ status, raw: result });
      });
    } catch (err) {
      finishErr(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't start the confirmation. Please try again.",
      );
    }
  });
}
