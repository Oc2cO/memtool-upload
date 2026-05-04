/**
 * Tests for `fetchAllMemoriesForExport` — the I/O helper that backs the
 * Settings → "Export your memories" button.
 *
 * The schema-level concerns (CSV columns, JSON shape, escaping) are
 * already locked in by `memoriesExport.test.ts`. This file covers the
 * surrounding network behaviour:
 *
 *   - Pages through the server until it sees a short batch.
 *   - Reports progress to the caller after each page.
 *   - Honours an `AbortSignal` (so a user cancel mid-export does not
 *     write a partial file).
 *   - Falls back to the AsyncStorage cache on a real network failure
 *     and flags `usedCache: true` so the UI can warn the user.
 *   - Re-throws genuine HTTP errors (401 / 5xx) instead of silently
 *     returning a stale cached export — those cases need the user (or
 *     server) to do something, not a quiet downgrade.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  EXPORT_FETCH_TIMEOUT_MS,
  fetchAllMemoriesForExport,
  type Memory,
} from "./memories";
import { AuthError } from "./auth";

jest.mock("./annotations", () => ({
  apiFetchAnnotations: jest.fn(() => Promise.resolve({})),
}));

const mockedAsyncStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

const originalFetch = global.fetch;
const fetchMock = jest.fn();

const USER_ID = "user@example.com";
const CACHE_KEY = `memories_${USER_ID}`;
// `authFetch` reads the bearer token from AsyncStorage on every call.
// We can't easily intercept that lookup (it's a module-internal
// binding, not a re-export), so instead we assert on AsyncStorage
// **by key** — the cache key is what we actually care about.
const TOKEN_KEY = "mt_token";

function setCache(value: string | null): void {
  mockedAsyncStorage.getItem.mockImplementation(async (key: string) => {
    if (key === CACHE_KEY) return value;
    if (key === TOKEN_KEY) return "polsia-token-xyz";
    return null;
  });
}

function cacheReadCount(): number {
  return mockedAsyncStorage.getItem.mock.calls.filter(
    (c) => c[0] === CACHE_KEY,
  ).length;
}

beforeEach(() => {
  fetchMock.mockReset();
  mockedAsyncStorage.getItem.mockReset();
  setCache(null);
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

interface ServerMemoryShape {
  id: string;
  content: string;
  type: "memory" | "call";
  tags: string[] | null;
  mood: string | null;
  is_starred: boolean;
  client_id: string;
  created_at: string;
  updated_at: string;
}

function makeServerMemory(i: number): ServerMemoryShape {
  return {
    id: `srv-${i}`,
    content: `memory ${i}`,
    type: "memory",
    tags: [],
    mood: null,
    is_starred: false,
    client_id: `client-${i}`,
    created_at: "2026-04-30T12:00:00.000Z",
    updated_at: "2026-04-30T12:00:00.000Z",
  };
}

function makeListResponse(count: number, page: number): Response {
  const memories = Array.from({ length: count }, (_, i) =>
    makeServerMemory(page * 1000 + i),
  );
  return {
    ok: true,
    status: 200,
    text: () =>
      Promise.resolve(
        JSON.stringify({ memories, total: count, page, limit: 100 }),
      ),
    json: () =>
      Promise.resolve({ memories, total: count, page, limit: 100 }),
  } as unknown as Response;
}

function makeHttpErrorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("fetchAllMemoriesForExport — paging", () => {
  test("keeps requesting pages until it sees a short batch", async () => {
    // Server returns two full pages of 100 then a final short page of
    // 37, which is the signal that we've drained the dataset.
    fetchMock
      .mockResolvedValueOnce(makeListResponse(100, 1))
      .mockResolvedValueOnce(makeListResponse(100, 2))
      .mockResolvedValueOnce(makeListResponse(37, 3));

    const result = await fetchAllMemoriesForExport(USER_ID);

    expect(result.usedCache).toBe(false);
    expect(result.memories).toHaveLength(237);
    // Three list requests (annotations are mocked at the module level).
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const listUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(listUrls[0]).toMatch(/page=1&limit=100/);
    expect(listUrls[1]).toMatch(/page=2&limit=100/);
    expect(listUrls[2]).toMatch(/page=3&limit=100/);
  });

  test("stops after a single page when the very first batch is short", async () => {
    fetchMock.mockResolvedValueOnce(makeListResponse(12, 1));

    const result = await fetchAllMemoriesForExport(USER_ID);

    expect(result.memories).toHaveLength(12);
    expect(result.usedCache).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("returns no memories (and never hits the cache) when the server is empty", async () => {
    fetchMock.mockResolvedValueOnce(makeListResponse(0, 1));

    const result = await fetchAllMemoriesForExport(USER_ID);

    expect(result.memories).toEqual([]);
    expect(result.usedCache).toBe(false);
    // The cache is for the offline path only; a successful (even if
    // empty) network response must never read from it.
    expect(cacheReadCount()).toBe(0);
  });
});

describe("fetchAllMemoriesForExport — progress reporting", () => {
  test("reports the running total after each page", async () => {
    fetchMock
      .mockResolvedValueOnce(makeListResponse(100, 1))
      .mockResolvedValueOnce(makeListResponse(100, 2))
      .mockResolvedValueOnce(makeListResponse(20, 3));

    const onProgress = jest.fn();
    await fetchAllMemoriesForExport(USER_ID, { onProgress });

    // Specifically the running total — not the per-page count — so the
    // UI can render "exported 220 memories" without doing arithmetic.
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([100, 200, 220]);
  });

  test("does not require an onProgress callback", async () => {
    fetchMock.mockResolvedValueOnce(makeListResponse(5, 1));
    await expect(
      fetchAllMemoriesForExport(USER_ID),
    ).resolves.toMatchObject({ usedCache: false });
  });
});

describe("fetchAllMemoriesForExport — abort handling", () => {
  test("throws AbortError immediately when the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    let caught: unknown = null;
    try {
      await fetchAllMemoriesForExport(USER_ID, {
        signal: ctrl.signal,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("AbortError");
    // Critically: no network call must have been made — that's the
    // whole point of honouring the pre-aborted signal.
    expect(fetchMock).not.toHaveBeenCalled();
    // And we must NOT silently fall back to the cache on cancel: a
    // user-initiated cancel is not a network failure.
    expect(cacheReadCount()).toBe(0);
  });

  test("aborts an in-flight fetch immediately when the user cancels mid-request", async () => {
    // Real captive-portal scenario: the page fetch is hanging (resolves
    // only on signal abort), the user taps Cancel, and we must NOT
    // silently downgrade that into a cached-copy export — a user cancel
    // is a user cancel, not a network failure. This regression test
    // pins the contract added alongside Task #143's per-page timeout:
    // the same per-page AbortController also forwards the user signal.
    const userController = new AbortController();
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const sig = init.signal;
        if (!sig) return;
        const onAbort = () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        };
        if (sig.aborted) onAbort();
        else sig.addEventListener("abort", onAbort);
      });
    });
    // Pre-seed the cache so the test can prove we DON'T read it on
    // a user cancel (vs. the offline path which does).
    setCache(
      JSON.stringify([
        {
          id: "client-cached",
          userId: USER_ID,
          content: "must not appear on cancel",
          timestamp: "2026-04-29T08:00:00.000Z",
          kind: "memory",
        },
      ]),
    );

    const promise = fetchAllMemoriesForExport(USER_ID, {
      signal: userController.signal,
    });
    // Cancel before any timeout could possibly fire.
    userController.abort();

    let caught: unknown = null;
    try {
      await promise;
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("AbortError");
    // Hard guarantee: a user cancel must not quietly read cache.
    expect(cacheReadCount()).toBe(0);
    // The fetch was started, then aborted via the per-page controller
    // which the user signal feeds into. One outbound request, aborted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("stops paging when the signal aborts between pages", async () => {
    const ctrl = new AbortController();
    fetchMock.mockImplementationOnce(() => {
      // Simulate the user cancelling while the first page was in flight
      // — by the time the next iteration's `signal.aborted` check runs,
      // the controller is aborted.
      ctrl.abort();
      return Promise.resolve(makeListResponse(100, 1));
    });

    let caught: unknown = null;
    try {
      await fetchAllMemoriesForExport(USER_ID, {
        signal: ctrl.signal,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("AbortError");
    // Only the first page was requested; the second iteration tripped
    // the abort guard before issuing another fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchAllMemoriesForExport — offline cache fallback", () => {
  test("returns the AsyncStorage cache (with usedCache: true) on a network failure", async () => {
    // authFetch wraps `fetch()` rejections as an AuthError with no
    // status — that's the offline signal we must fall back on.
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));

    const cached: Memory[] = [
      {
        id: "client-cached-1",
        userId: USER_ID,
        content: "from cache",
        timestamp: "2026-04-29T08:00:00.000Z",
        kind: "memory",
        tags: ["offline"],
      },
    ];
    setCache(JSON.stringify(cached));

    const result = await fetchAllMemoriesForExport(USER_ID);

    expect(result.usedCache).toBe(true);
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      id: "client-cached-1",
      content: "from cache",
      kind: "memory",
    });
    // Same key MemoriesContext writes to.
    expect(mockedAsyncStorage.getItem).toHaveBeenCalledWith(CACHE_KEY);
  });

  test("returns an empty cached export when AsyncStorage has nothing stored", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    setCache(null);

    const result = await fetchAllMemoriesForExport(USER_ID);

    expect(result.usedCache).toBe(true);
    expect(result.memories).toEqual([]);
  });

  test("survives a malformed cache by returning an empty cached export", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    setCache("{not json");

    const result = await fetchAllMemoriesForExport(USER_ID);

    expect(result.usedCache).toBe(true);
    expect(result.memories).toEqual([]);
  });

  test("backfills missing kind on legacy cached rows so the export schema stays valid", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    setCache(
      JSON.stringify([
        {
          id: "legacy-1",
          userId: USER_ID,
          content: "old row, no kind",
          timestamp: "2026-04-01T00:00:00.000Z",
        },
      ]),
    );

    const result = await fetchAllMemoriesForExport(USER_ID);

    expect(result.usedCache).toBe(true);
    expect(result.memories[0]?.kind).toBe("memory");
  });
});

describe("fetchAllMemoriesForExport — per-page timeout (Task #143)", () => {
  // Captive-portal Wi-Fi: the TCP handshake completes (so fetch resolves
  // its initial promise) but the body never arrives. Without a ceiling
  // the export — and Task #136's "Retrying network…" indicator — would
  // sit there indefinitely until the user backgrounded the app. The
  // helper must give up after `EXPORT_FETCH_TIMEOUT_MS` and fall back
  // to the cached AsyncStorage copy so the caller can re-pop the
  // cached-copy prompt.
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("aborts a hanging page fetch after the timeout and falls back to cache", async () => {
    // Mock fetch as a captive-portal hang: the promise rejects only
    // when the per-page AbortSignal fires, which is exactly what real
    // `fetch()` does when its `signal` aborts mid-request.
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

    const cached: Memory[] = [
      {
        id: "client-cached-stale",
        userId: USER_ID,
        content: "stale but exportable",
        timestamp: "2026-04-28T08:00:00.000Z",
        kind: "memory",
      },
    ];
    setCache(JSON.stringify(cached));

    const promise = fetchAllMemoriesForExport(USER_ID);
    // The fetch is hanging. Step the clock past the timeout so the
    // per-page controller fires `abort()` on the in-flight request.
    await jest.advanceTimersByTimeAsync(EXPORT_FETCH_TIMEOUT_MS + 100);

    const result = await promise;
    expect(result.usedCache).toBe(true);
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]?.id).toBe("client-cached-stale");
    // Critically: only one outbound request, and it received an
    // AbortSignal so the fetch could actually be cancelled.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("does not fire the timeout when the page resolves quickly", async () => {
    fetchMock.mockResolvedValueOnce(makeListResponse(7, 1));

    const result = await fetchAllMemoriesForExport(USER_ID);

    expect(result.usedCache).toBe(false);
    expect(result.memories).toHaveLength(7);
    // Step well past the timeout to prove no late abort fires after
    // the fetch already succeeded — a stray late `abort()` would have
    // no effect on the resolved batch, but if `clearTimeout` regressed
    // we'd see e.g. unhandled rejections in jest.
    await jest.advanceTimersByTimeAsync(EXPORT_FETCH_TIMEOUT_MS * 2);
  });
});

describe("fetchAllMemoriesForExport — real HTTP errors must NOT silently use the cache", () => {
  test("re-throws AuthError on 401 instead of swapping in stale cached memories", async () => {
    fetchMock.mockResolvedValueOnce(
      makeHttpErrorResponse(401, { error: "Invalid credentials" }),
    );
    // The cache has data; the test's job is to prove we don't read it.
    setCache(
      JSON.stringify([
        {
          id: "client-cached",
          userId: USER_ID,
          content: "should not appear",
          timestamp: "2026-04-29T08:00:00.000Z",
          kind: "memory",
        },
      ]),
    );

    let caught: unknown = null;
    try {
      await fetchAllMemoriesForExport(USER_ID);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).status).toBe(401);
    // Hard guarantee: a 401 must not quietly return cache.
    expect(cacheReadCount()).toBe(0);
  });

  test("re-throws AuthError on 5xx instead of swapping in stale cached memories", async () => {
    fetchMock.mockResolvedValueOnce(
      makeHttpErrorResponse(503, { error: "upstream down" }),
    );

    let caught: unknown = null;
    try {
      await fetchAllMemoriesForExport(USER_ID);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).status).toBe(503);
    expect(cacheReadCount()).toBe(0);
  });
});
