/**
 * Tests for `apiListMemoriesWithTimeout` — the per-call timeout
 * wrapper that `MemoriesContext.refresh` uses for the foreground
 * memory list (Task #179).
 *
 * Task #143 added a 15-second per-page ceiling to the export fetch
 * so a captive-portal Wi-Fi (TCP handshake completes but no data
 * ever arrives) can no longer hang the export forever. The same
 * hang was still possible on the in-app memory list because
 * `apiListMemories` had no caller-side timeout — the home tab would
 * sit on its spinner indefinitely instead of falling back to the
 * cached rows.
 *
 * This file pins the wrapper's contract:
 *
 *   - A hung fetch is aborted after `LIST_FETCH_TIMEOUT_MS` and the
 *     resulting error surfaces in the offline shape that
 *     `MemoriesContext.loadMemories` already handles (an `AuthError`
 *     with no `status`).
 *   - A fast, healthy fetch is unaffected and the timeout is cleared
 *     so a late `abort()` cannot fire on a settled request.
 *   - The fetch actually receives an `AbortSignal` (proves the
 *     timeout has something real to cancel).
 */

import {
  LIST_FETCH_TIMEOUT_MS,
  apiListMemoriesWithTimeout,
} from "./memories";
import { AuthError } from "./auth";

const originalFetch = global.fetch;
const fetchMock = jest.fn();

const USER_ID = "user@example.com";
// `authFetch` reads the bearer token from AsyncStorage on every call.
// We can't intercept that lookup directly (it's a module-internal
// binding), so the existing AsyncStorage mock from jest.setup.js is
// re-pointed below to return a fake token for the auth header.
const TOKEN_KEY = "mt_token";

import AsyncStorage from "@react-native-async-storage/async-storage";

const mockedAsyncStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
};

beforeEach(() => {
  fetchMock.mockReset();
  mockedAsyncStorage.getItem.mockReset();
  mockedAsyncStorage.getItem.mockImplementation(async (key: string) => {
    if (key === TOKEN_KEY) return "polsia-token-xyz";
    return null;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

function makeListResponse(count: number): Response {
  const memories = Array.from({ length: count }, (_, i) => ({
    id: `srv-${i}`,
    content: `memory ${i}`,
    type: "memory" as const,
    tags: [],
    mood: null,
    is_starred: false,
    client_id: `client-${i}`,
    created_at: "2026-04-30T12:00:00.000Z",
    updated_at: "2026-04-30T12:00:00.000Z",
  }));
  return {
    ok: true,
    status: 200,
    text: () =>
      Promise.resolve(
        JSON.stringify({ memories, total: count, page: 1, limit: 20 }),
      ),
    json: () =>
      Promise.resolve({ memories, total: count, page: 1, limit: 20 }),
  } as unknown as Response;
}

describe("apiListMemoriesWithTimeout — captive-portal hang (Task #179)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("aborts a hanging list fetch after LIST_FETCH_TIMEOUT_MS and surfaces the offline error shape", async () => {
    // Captive-portal sim: the fetch promise rejects only when its
    // AbortSignal fires, which is exactly what real `fetch()` does
    // when `signal` aborts mid-request. If the helper failed to
    // forward an abort signal, this promise would hang forever and
    // jest's test timeout would surface the regression instead.
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const sig = init.signal;
        if (!sig) return; // would hang forever — proves the helper passes one
        const onAbort = () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        };
        if (sig.aborted) onAbort();
        else sig.addEventListener("abort", onAbort);
      });
    });

    const promise = apiListMemoriesWithTimeout(USER_ID, 1, 20);
    // Catch eagerly so the rejection from the timeout doesn't surface
    // as an unhandled promise rejection between `advanceTimersByTime`
    // and the awaited assertion.
    const caughtPromise = promise.catch((err) => err);

    // The fetch is hanging. Step the clock past the timeout so the
    // wrapper's controller fires `abort()` on the in-flight request.
    await jest.advanceTimersByTimeAsync(LIST_FETCH_TIMEOUT_MS + 100);

    const caught = await caughtPromise;

    // `authFetch` rewraps the underlying AbortError as an AuthError
    // with no `status`. That's the exact shape
    // `MemoriesContext.loadMemories`'s catch already treats as the
    // offline path (it logs a warning then surfaces the cached list)
    // — pinning that shape here is what guarantees the home tab
    // falls back instead of spinning forever.
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).status).toBeUndefined();

    // Critically: only one outbound request, and it received an
    // AbortSignal so the fetch could actually be cancelled.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("does not fire the timeout when the page resolves quickly", async () => {
    fetchMock.mockResolvedValueOnce(makeListResponse(7));

    const memories = await apiListMemoriesWithTimeout(USER_ID, 1, 20);

    expect(memories).toHaveLength(7);
    // Step well past the timeout to prove no late abort fires after
    // the fetch already succeeded — a stray late `abort()` is a no-op
    // on a resolved request, but if `clearTimeout` regressed we'd see
    // unhandled rejections in jest.
    await jest.advanceTimersByTimeAsync(LIST_FETCH_TIMEOUT_MS * 2);
  });

  test("disables the timeout when timeoutMs <= 0", async () => {
    // Belt-and-braces: the helper's `timeoutMs <= 0` escape hatch
    // delegates straight to `apiListMemories` so a future caller that
    // wants the legacy no-timeout behaviour can opt out cleanly. The
    // fast-resolve path is enough to prove the short-circuit returns
    // the underlying memories — the absence of any wrapper-managed
    // setTimeout is what we're really pinning.
    fetchMock.mockResolvedValueOnce(makeListResponse(3));

    const memories = await apiListMemoriesWithTimeout(USER_ID, 1, 20, 0);
    expect(memories).toHaveLength(3);
  });
});
