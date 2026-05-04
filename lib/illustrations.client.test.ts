/**
 * Client-side mutation coverage for `apiIllustrateMemory` and
 * `apiDeleteIllustration` (Task #189). The existing
 * `illustrations.test.ts` covers the bulk fetch + thumbnail merge
 * (Task #212); this suite covers the per-memory POST + DELETE
 * mutations the lightbox's Regenerate / Remove buttons rely on.
 *
 * The discriminated-union return shape (ok / auth_error / limit /
 * server_error) is what lets the lightbox render the right UI
 * without parsing prose error messages, so each branch needs a pin.
 */
import {
  apiDeleteIllustration,
  apiIllustrateMemory,
} from "./illustrations";

jest.mock("./auth", () => {
  const actual = jest.requireActual("./auth");
  return {
    ...actual,
    getToken: jest.fn(() => Promise.resolve("test-token")),
  };
});

jest.mock("./captureLimits", () => {
  const actual = jest.requireActual("./captureLimits");
  return {
    ...actual,
    getLocalDayKey: jest.fn(() => "2026-05-03"),
  };
});

jest.mock("./config", () => ({
  resolveReplitApiBase: () => "https://api.test",
}));

const mockedAuth = jest.requireMock("./auth") as { getToken: jest.Mock };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ORIGINAL_FETCH = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockedAuth.getToken.mockReset();
  mockedAuth.getToken.mockResolvedValue("test-token");
});

afterAll(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("apiIllustrateMemory — Regenerate button contract", () => {
  const INPUT = {
    clientId: "mem-1",
    content: "Had coffee with Alex this morning.",
    tags: ["social"],
  };

  it("returns auth_error when no token is available (no fetch fired)", async () => {
    mockedAuth.getToken.mockResolvedValueOnce(null);
    const res = await apiIllustrateMemory(INPUT);
    expect(res).toEqual({ kind: "auth_error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to /api/memories/:id/illustrate with the bearer token and parses an ok response with thumb fallback", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        illustration: {
          url: "/api/illustrations/abc/full.png",
          thumb_url: "/api/illustrations/abc/thumb.png",
          prompt: "p",
          generated_at: "2026-05-03T12:00:00Z",
        },
        isPro: true,
        usedToday: 1,
        limit: null,
      }),
    );

    const res = await apiIllustrateMemory(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/api/memories/mem-1/illustrate");
    expect((init as RequestInit).method).toBe("POST");
    expect(
      ((init as RequestInit).headers as Record<string, string>)[
        "Authorization"
      ],
    ).toBe("Bearer test-token");

    expect(res).toEqual({
      kind: "ok",
      url: "https://api.test/api/illustrations/abc/full.png",
      thumbUrl: "https://api.test/api/illustrations/abc/thumb.png",
      generatedAt: "2026-05-03T12:00:00Z",
      isPro: true,
      usedToday: 1,
      limit: null,
    });
  });

  it("maps 401 → auth_error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    expect(await apiIllustrateMemory(INPUT)).toEqual({ kind: "auth_error" });
  });

  it("maps 403 → auth_error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 403));
    expect(await apiIllustrateMemory(INPUT)).toEqual({ kind: "auth_error" });
  });

  it("maps 402 → limit with the server's reported limit/used", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ limit: 1, used: 1 }, 402));
    expect(await apiIllustrateMemory(INPUT)).toEqual({
      kind: "limit",
      limit: 1,
      used: 1,
    });
  });

  it("maps non-ok → server_error with the server's error message when present", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "image generator down" }, 503),
    );
    expect(await apiIllustrateMemory(INPUT)).toEqual({
      kind: "server_error",
      message: "image generator down",
    });
  });

  it("maps a network throw → server_error with the error message", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await apiIllustrateMemory(INPUT)).toEqual({
      kind: "server_error",
      message: "ECONNRESET",
    });
  });

  it("returns server_error when the response is missing a usable illustration url", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        illustration: { url: "", prompt: "", generated_at: "" },
      }),
    );
    const res = await apiIllustrateMemory(INPUT);
    expect(res.kind).toBe("server_error");
  });
});

describe("apiDeleteIllustration — Remove button contract", () => {
  it("returns auth_error when no token is available (no fetch fired)", async () => {
    mockedAuth.getToken.mockResolvedValueOnce(null);
    const res = await apiDeleteIllustration("mem-1");
    expect(res).toEqual({ kind: "auth_error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("DELETEs /api/memories/:id/illustrate with the bearer token and parses { removed: true }", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ removed: true }));

    const res = await apiDeleteIllustration("mem-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/api/memories/mem-1/illustrate");
    expect((init as RequestInit).method).toBe("DELETE");
    expect(
      ((init as RequestInit).headers as Record<string, string>)[
        "Authorization"
      ],
    ).toBe("Bearer test-token");
    expect(res).toEqual({ kind: "ok", removed: true });
  });

  it("treats { removed: false } (idempotent second-delete) as ok with removed:false", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ removed: false }));
    expect(await apiDeleteIllustration("mem-1")).toEqual({
      kind: "ok",
      removed: false,
    });
  });

  it("maps 401 → auth_error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    expect(await apiDeleteIllustration("mem-1")).toEqual({
      kind: "auth_error",
    });
  });

  it("maps non-ok → server_error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));
    expect(await apiDeleteIllustration("mem-1")).toEqual({
      kind: "server_error",
      message: "boom",
    });
  });

  it("maps a network throw → server_error with the error message", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await apiDeleteIllustration("mem-1")).toEqual({
      kind: "server_error",
      message: "offline",
    });
  });
});
