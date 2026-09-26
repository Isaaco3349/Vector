/**
 * Does the on-mount prefetch sabotage a fast Google click?
 *
 * This is NOT a guess about the SDK — MockSdk transcribes the real semantics of
 * node_modules/@circle-fin/w3s-pw-web-sdk/src/index.ts getDeviceId() @149-165:
 *
 *   getDeviceId(): Promise<string> {
 *     return new Promise<string>((resolve, reject) => {
 *       this.resolveDeviceIdPromise = resolve        // @151  INSTANCE field
 *       this.rejectDeviceIdPromise  = reject        // @152  INSTANCE field
 *       this.subscribeMessage()
 *       this.appendIframe(false, 'device-id')
 *       setTimeout(() => {
 *         if (!this.receivedResponseFromService) {   // @80   INSTANCE field
 *           this.rejectDeviceIdPromise?.('Failed to receive deviceId')
 *           this.closeModal()
 *           this.unSubscribeMessage()
 *         }
 *       }, 1000 * 10)
 *     })
 *   }
 *
 * and the message handler @751-757 / @806-809:
 *   if (event.origin !== this.serviceUrl) return
 *   this.receivedResponseFromService = true
 *   ... this.resolveDeviceIdPromise?.(event.data.deviceId); this.unSubscribeMessage()
 *
 * Timings are scaled 100x (10s -> 100ms) so the whole thing runs in a second.
 * The RATIOS are what matter, and they're preserved.
 */

const SDK_TIMEOUT = 100; // real: 10_000
const BACKOFF = 10; // real: 1_000
const CLICK_AT = 20; // user clicks 2s (scaled) after the page is usable
const WATCHDOG = 600; // 60 scaled-sec: longer than any legitimate retry chain

/** Faithful mock of the parts of W3SSdk that getDeviceId touches. */
class MockSdk {
  constructor({ circleReplyDelay }) {
    // circleReplyDelay = null  -> origin NOT registered, Circle never posts back
    this.circleReplyDelay = circleReplyDelay;
    this.receivedResponseFromService = false; // @80
    this.resolveDeviceIdPromise = undefined; // @84
    this.rejectDeviceIdPromise = undefined; // @88
    this.subscribed = false;
    this.iframes = 0;
  }
  getDeviceId() {
    return new Promise((resolve, reject) => {
      this.resolveDeviceIdPromise = resolve; // @151 — OVERWRITES
      this.rejectDeviceIdPromise = reject; // @152 — OVERWRITES
      this.subscribed = true; // subscribeMessage()
      const myIframe = ++this.iframes; // appendIframe()

      if (this.circleReplyDelay !== null) {
        setTimeout(() => {
          // messageHandler: only fires while subscribed (unSubscribeMessage
          // removes the listener, so a reply after teardown is simply lost).
          if (!this.subscribed) return;
          void myIframe;
          this.receivedResponseFromService = true; // @757
          this.resolveDeviceIdPromise?.("device-abc"); // @806
          this.subscribed = false; // @809 unSubscribeMessage()
        }, this.circleReplyDelay);
      }

      setTimeout(() => {
        if (!this.receivedResponseFromService) {
          this.rejectDeviceIdPromise?.("Failed to receive deviceId"); // @159
          this.subscribed = false; // @161 unSubscribeMessage()
        }
      }, SDK_TIMEOUT);
    });
  }
}

/** HEAD's shape: recursive, 3 attempts, backoff 1000*attempt, no serialisation. */
function makeOld(sdk) {
  const ref = { current: null };
  const fetchDeviceId = async (attempt = 1) => {
    try {
      return await sdk.getDeviceId();
    } catch {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, BACKOFF * attempt));
        return fetchDeviceId(attempt + 1);
      }
      return null;
    }
  };
  return { fetchDeviceId, ref };
}

/** The new shape: options object, serialised on an in-flight ref. */
function makeNew(sdk) {
  const inFlightRef = { current: null };
  const fetchDeviceId = async ({ attempts = 2, silent = false } = {}) => {
    void silent;
    let joinedFailure = false;
    const inFlight = inFlightRef.current;
    if (inFlight) {
      const joined = await inFlight;
      if (joined) return joined;
      joinedFailure = true;
    }
    const remaining = attempts - (joinedFailure ? 1 : 0);
    if (remaining > 0) {
      const run = (async () => {
        for (let attempt = 1; attempt <= remaining; attempt++) {
          try {
            return await sdk.getDeviceId();
          } catch {
            if (attempt < remaining) {
              await new Promise((r) => setTimeout(r, BACKOFF));
            }
          }
        }
        return null;
      })();
      inFlightRef.current = run;
      try {
        const id = await run;
        if (id) return id;
      } finally {
        if (inFlightRef.current === run) inFlightRef.current = null;
      }
    }
    return null;
  };
  return { fetchDeviceId, ref: inFlightRef };
}

async function scenario(label, make, sdkOpts, prefetchArgs) {
  const sdk = new MockSdk(sdkOpts);
  const { fetchDeviceId } = make(sdk);
  const t0 = Date.now();
  const NEVER = Symbol("never-settled");

  // on-mount prefetch
  const prefetch = fetchDeviceId(prefetchArgs).then(
    (v) => ({ ok: true, v }),
    (e) => ({ ok: false, e: String(e) }),
  );

  // user clicks shortly after
  await new Promise((r) => setTimeout(r, CLICK_AT));
  const clickPromise = fetchDeviceId().then(
    (v) => ({ ok: true, v }),
    (e) => ({ ok: false, e: String(e) }),
  );
  // Watchdog: a promise that never settles is the failure mode we're hunting,
  // so we must be able to observe it instead of hanging the process.
  const click = await Promise.race([
    clickPromise,
    new Promise((r) => setTimeout(() => r(NEVER), WATCHDOG)),
  ]);
  const clickMs = Date.now() - t0;
  // Did the PREFETCH's own promise ever settle? With overwritten instance
  // handles, one of the two promises can be orphaned forever.
  let prefetchSettled = false;
  prefetch.then(() => {
    prefetchSettled = true;
  });
  await new Promise((r) => setTimeout(r, WATCHDOG - (Date.now() - t0) + 5));

  const verdict =
    click === NEVER
      ? "NEVER SETTLED"
      : click.ok && click.v
        ? "GOT deviceId"
        : "returned null";
  console.log(
    `${label.padEnd(26)} click -> ${verdict.padEnd(14)} after ${String(
      (clickMs / 10).toFixed(1),
    ).padStart(5)} scaled-sec   iframes=${sdk.iframes}   prefetch promise ${
      prefetchSettled ? "settled" : "ORPHANED"
    }`,
  );
  return click !== NEVER && click.ok && !!click.v;
}

console.log(
  "\n── CONTROL: Circle replies in 0.3 scaled-sec (before the click) ──────────",
);
await scenario("OLD (no serialisation)", makeOld, { circleReplyDelay: 3 }, 1);
await scenario("NEW (serialised)", makeNew, { circleReplyDelay: 3 }, {
  attempts: 1,
  silent: true,
});

console.log(
  "\n── THE RACE: Circle replies in 15 scaled-sec, i.e. slower than the SDK's",
);
console.log(
  "   own 10s timeout, so the prefetch's timer fires while the click is",
);
console.log("   still in flight. Origin IS registered — Circle is just slow.\n");
const oldRace = await scenario("OLD (no serialisation)", makeOld, { circleReplyDelay: 150 }, 1);
const newRace = await scenario("NEW (serialised)", makeNew, { circleReplyDelay: 150 }, {
  attempts: 1,
  silent: true,
});

console.log("\n── TODAY'S PRODUCTION: origin not registered, Circle never replies ──\n");
const oldNever = await scenario("OLD (no serialisation)", makeOld, { circleReplyDelay: null }, 1);
const newNever = await scenario("NEW (serialised)", makeNew, { circleReplyDelay: null }, {
  attempts: 1,
  silent: true,
});

console.log(
  `\nRESULT  slow-Circle race: old=${oldRace ? "pass" : "FAIL"}  new=${
    newRace ? "pass" : "FAIL"
  }`,
);
console.log(
  `        never-replies:    old=${oldNever ? "pass" : "FAIL"}  new=${
    newNever ? "pass" : "FAIL"
  }  (both SHOULD fail — there is no deviceId to get)\n`,
);
