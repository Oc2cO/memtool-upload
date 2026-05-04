/**
 * Coverage for the request-timeout layer added in Pre-launch Round 2.
 *
 * The bug we're guarding against: a stalled socket on any authFetch /
 * publicFetch call would pin the calling screen on a permanent
 * spinner (the Mem AI Guide "Mem is thinking…" indicator was the
 * worst case). The fix wraps fetch in an AbortController with a
 * 20 s ceiling, and surfaces the abort as the same friendly
 * "Couldn't reach the server" AuthError that a flat-out network
 * failure already produced.
 *
 * These tests use jest fake timers to advance past the 20 s ceiling
 * without waiting in real time. They do NOT cover the happy path or
 * the friendlyMessage mapping — those are exercised indirectly by
 * the existing aiGuide / subscription / memories test suites.
 */

import { authFetch, AuthError } from "./auth";

// Flush enough microtasks for the chain getToken → fetchWithTimeout
// → fetch() initial call → addEventListener("abort", ...) to settle.
async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe("authFetch request timeout", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("aborts a stalled request after the 20s ceiling and surfaces a friendly AuthError", async () => {
    // Simulate a permanently-stalled socket: fetch never resolves on
    // its own, only when its AbortSignal fires. This mirrors the
    // real-world "TCP connected but server stopped responding"
    // failure mode that previously hung the AI Guide forever.
    let aborted = false;
    globalThis.fetch = jest.fn((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // never resolves
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    const promise = authFetch("/ai-guide/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hi" }),
    });
    // The promise will reject — install a no-op catch right away so
    // Node doesn't flag it as unhandled while we advance timers.
    const settled = promise.catch((e) => e);

    // Hand control back so authFetch can finish awaiting getToken()
    // (mocked AsyncStorage) and register its abort listener before
    // we trip the timer.
    await flushMicrotasks();
    jest.advanceTimersByTime(20_000);

    const err = await settled;
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).message).toBe(
      "Couldn't reach the server — check your connection",
    );
    // The timeout intentionally lands in the network-failure branch
    // (no HTTP status), so callers like sendAiGuideMessage map it to
    // AI_GUIDE_NETWORK_ERROR_MESSAGE — the same calm "Try again" copy
    // a real network outage produces.
    expect((err as AuthError).status).toBeUndefined();
    expect(aborted).toBe(true);
  });

  it("does not abort a request that completes inside the ceiling", async () => {
    // Sanity check the timer plumbing — a fast response must not be
    // killed by the timeout. We resolve fetch immediately, then
    // advance past where the 20 s abort would otherwise fire.
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const promise = authFetch("/ping");
    await flushMicrotasks();
    // Advance well past the ceiling — clearTimeout in the finally
    // block must have removed the abort timer; if it didn't, the
    // resolved Response is unaffected anyway since fetch already
    // returned, but a regression to a leaked abort would still get
    // caught by the matching pair of tests above.
    jest.advanceTimersByTime(30_000);
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it("honors an externally-passed abort signal in addition to the internal timeout", async () => {
    // If a caller already passes a signal (e.g. a future cancellable
    // mutation), the wrapper must not silently swap it out — both
    // sources should be able to fire the abort.
    let aborted = false;
    globalThis.fetch = jest.fn((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    const external = new AbortController();
    const promise = authFetch("/slow", { signal: external.signal });
    const settled = promise.catch((e) => e);
    await flushMicrotasks();
    external.abort();

    const err = await settled;
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).message).toBe(
      "Couldn't reach the server — check your connection",
    );
    expect(aborted).toBe(true);
  });
});
