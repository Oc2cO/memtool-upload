/**
 * Tests for the server-enforced create path used by Task #32.
 *
 * `apiCreateMemory` no longer talks to Polsia directly. Instead it
 * POSTs to our api-server proxy (`<our-api>/api/sync/memories`),
 * which verifies the same Polsia bearer token, enforces the daily
 * capture cap, then forwards to Polsia. Routing through the proxy
 * is what closes the bypass: a modified client cannot reach
 * Polsia's create without our cap-check screening it first
 * because (a) updates and deletes use the existing authFetch path
 * and (b) the cap subject is bound to the verified token, not a
 * value the client can spoof.
 *
 * These tests cover:
 *   - happy path: proxy returns 200, request carries the bearer
 *     token and the correct Polsia-shaped body.
 *   - 402 + FREE_TIER_CAPTURE_LIMIT → CaptureLimitReachedError
 *     (so callers and the outbox classify the failure correctly).
 *   - 402 + unknown code → AuthError(402) (NOT silently dropped).
 *   - 5xx / network failures throw retryable errors.
 *   - missing token → throws auth error before going on the wire.
 */

import { apiCreateMemory } from "./memories";
import {
  CaptureBlockedError,
  CaptureLimitReachedError,
  FREE_DAILY_CAPTURE_LIMIT,
  SERVER_CAPTURE_BLOCKED_CODE,
  SERVER_CAPTURE_LIMIT_CODE,
} from "./subscription";
import { AuthError } from "./auth";

jest.mock("./auth", () => {
  const actual = jest.requireActual("./auth");
  return {
    ...actual,
    getToken: jest.fn(() => Promise.resolve("polsia-token-xyz")),
  };
});

const mockedAuth = jest.requireMock("./auth") as {
  getToken: jest.Mock;
};

const originalFetch = global.fetch;
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  mockedAuth.getToken.mockReset();
  mockedAuth.getToken.mockResolvedValue("polsia-token-xyz");
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function lastFetchCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  if (!call) throw new Error("expected at least one fetch call");
  return { url: String(call[0]), init: call[1] as RequestInit };
}

describe("apiCreateMemory — server-enforced create path", () => {
  test("posts to our proxy (not Polsia) with the user's bearer token", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, { ok: true, server_id: "srv-1" }),
    );

    const res = await apiCreateMemory({
      client_id: "client-50",
      content: "hello",
      kind: "memory",
    });

    expect(res).toEqual({ ok: true, server_id: "srv-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const { url, init } = lastFetchCall();
    expect(url).toMatch(/\/api\/sync\/memories$/);
    // Critically, NOT Polsia: a request to oc2coos-2.polsia.app would
    // mean we still leak the bypass.
    expect(url).not.toMatch(/polsia\.app/);

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer polsia-token-xyz");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as {
      action: string;
      payload: { client_id: string; content: string; type: string; tags: string[] };
      timestamp: string;
    };
    expect(body.action).toBe("create");
    expect(body.payload.client_id).toBe("client-50");
    expect(body.payload.content).toBe("hello");
    expect(body.payload.type).toBe("memory");
    expect(body.payload.tags).toEqual([]);
    expect(typeof body.timestamp).toBe("string");
  });

  test("forwards tags when supplied", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, { ok: true, server_id: "srv-2" }),
    );
    await apiCreateMemory({
      client_id: "client-tagged",
      content: "tagged note",
      kind: "memory",
      tags: ["work", "idea"],
    });
    const { init } = lastFetchCall();
    const body = JSON.parse(init.body as string) as { payload: { tags: string[] } };
    expect(body.payload.tags).toEqual(["work", "idea"]);
  });

  test("throws CaptureLimitReachedError on 402 + FREE_TIER_CAPTURE_LIMIT", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(402, {
        error: "Daily capture limit reached",
        code: SERVER_CAPTURE_LIMIT_CODE,
        limit: FREE_DAILY_CAPTURE_LIMIT,
        remaining: 0,
      }),
    );

    await expect(
      apiCreateMemory({
        client_id: "client-over",
        content: "blocked",
        kind: "memory",
      }),
    ).rejects.toBeInstanceOf(CaptureLimitReachedError);
  });

  test("uses the server-provided limit on the thrown CaptureLimitReachedError", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(402, { code: SERVER_CAPTURE_LIMIT_CODE, limit: 25 }),
    );
    try {
      await apiCreateMemory({
        client_id: "client-over-2",
        content: "blocked",
        kind: "memory",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CaptureLimitReachedError);
      expect((err as CaptureLimitReachedError).limit).toBe(25);
    }
  });

  test("falls back to the constant limit when server omits limit", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(402, { code: SERVER_CAPTURE_LIMIT_CODE }),
    );
    try {
      await apiCreateMemory({
        client_id: "client-default-limit",
        content: "blocked",
        kind: "memory",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CaptureLimitReachedError);
      expect((err as CaptureLimitReachedError).limit).toBe(
        FREE_DAILY_CAPTURE_LIMIT,
      );
    }
  });

  // Task #121: server returns HTTP 429 + code "CAPTURE_BLOCKED_ABUSE"
  // when an account has been auto-blocked for the rest of the UTC day
  // after repeated cap-bypass attempts. The translation MUST yield a
  // distinct CaptureBlockedError (not CaptureLimitReachedError) so the
  // outbox classifies it as "blocked" and MemoriesContext shows the
  // cooldown alert instead of routing the user to /subscription.
  test("throws CaptureBlockedError on 429 + CAPTURE_BLOCKED_ABUSE", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(429, {
        error: "Capture temporarily blocked",
        code: SERVER_CAPTURE_BLOCKED_CODE,
      }),
    );

    let caught: unknown;
    try {
      await apiCreateMemory({
        client_id: "client-blocked",
        content: "blocked",
        kind: "memory",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CaptureBlockedError);
    // Crucial: NOT a cap-reached. Conflating these would either send
    // an abuse-blocked attacker into the upsell flow (wrong — they
    // can't pay their way out) or surface the cooldown copy to a
    // regular user who's just out of free captures (wrong — they can
    // upgrade).
    expect(caught).not.toBeInstanceOf(CaptureLimitReachedError);
  });

  test("throws AuthError(429) — NOT CaptureBlocked — for an unknown 429 code", async () => {
    // Mirror of the unknown-402 case: an unfamiliar 429 must surface
    // as a generic AuthError so the outbox marks the row failed
    // (retryable) instead of silently dropping it as "blocked". A
    // future server change that introduces a new 429 code MUST be
    // observed by the client, not swallowed.
    fetchMock.mockResolvedValueOnce(
      makeResponse(429, { code: "RATE_LIMITED_GENERIC", error: "slow down" }),
    );
    let caught: unknown;
    try {
      await apiCreateMemory({
        client_id: "client-unknown-429",
        content: "x",
        kind: "memory",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect(caught).not.toBeInstanceOf(CaptureBlockedError);
    expect((caught as AuthError).status).toBe(429);
  });

  test("throws AuthError(402) — NOT CaptureLimitReached — for an unknown 402 code", async () => {
    // We must surface, not silently swallow, an unfamiliar 402: the
    // outbox needs to mark the row failed (not just classify as cap
    // and drop) so the user sees something is off.
    fetchMock.mockResolvedValueOnce(
      makeResponse(402, { code: "SOMETHING_ELSE", error: "weird" }),
    );
    try {
      await apiCreateMemory({
        client_id: "client-unknown-402",
        content: "x",
        kind: "memory",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect(err).not.toBeInstanceOf(CaptureLimitReachedError);
      expect((err as AuthError).status).toBe(402);
    }
  });

  test("throws AuthError on a 5xx response (retryable)", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(502, { error: "upstream" }));
    await expect(
      apiCreateMemory({
        client_id: "client-5xx",
        content: "x",
        kind: "memory",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  test("throws AuthError on a network failure (retryable)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(
      apiCreateMemory({
        client_id: "client-offline",
        content: "x",
        kind: "memory",
      }),
    ).rejects.toBeInstanceOf(AuthError);
    // Crucial: the request must have been attempted (so the test
    // fails if a future refactor accidentally short-circuits to a
    // silent success).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("throws AuthError(401) and skips the network call when no token is stored", async () => {
    mockedAuth.getToken.mockResolvedValueOnce(null);
    try {
      await apiCreateMemory({
        client_id: "client-no-token",
        content: "x",
        kind: "memory",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("returns the proxy's body verbatim on 2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, { ok: true, server_id: "srv-abc" }),
    );
    const res = await apiCreateMemory({
      client_id: "client-200",
      content: "x",
      kind: "memory",
    });
    expect(res).toEqual({ ok: true, server_id: "srv-abc" });
  });
});
