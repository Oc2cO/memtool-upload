/**
 * Tests for the client side of the illustration thumbnail system
 * (Task #212 added the small thumbnail variant on the api-server;
 * this suite locks the mobile client's plumbing for that variant).
 *
 * The two contracts under test:
 *
 *   1. `apiFetchIllustrations` — when the bulk endpoint returns a
 *      `thumb_url` for a record, the parsed map entry must expose
 *      it as an absolute `thumbUrl`. A missing `thumb_url` (legacy
 *      record) must leave `thumbUrl` undefined so the polaroid
 *      falls back to the full-resolution `url`.
 *
 *   2. `mergeIllustrations` — when the map entry has a `thumbUrl`,
 *      the merged memory record must surface it as
 *      `illustrationThumbUrl`. Without that field on the merged
 *      record, the Archive polaroids would silently fall back to
 *      the 1MB full-resolution PNG and lose the scroll-perf win
 *      the thumbnail variant was added for.
 */

import React from "react";
import { render } from "@testing-library/react-native";

import {
  absoluteIllustrationUrl,
  apiDeleteIllustration,
  apiFetchIllustrations,
  apiIllustrateMemory,
  mergeIllustrations,
  type IllustrationMap,
} from "./illustrations";

// End-to-end flow test mocks below need stubs for the same modules
// the IllustrationPolaroid component test mocks. Declared here (not
// in a beforeEach) because jest.mock calls are hoisted to the top
// of the file regardless of placement.
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#000",
    primaryForeground: "#fff",
    mutedForeground: "#888",
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-image", () => {
  const ReactActual = require("react");
  const { View } = require("react-native");
  return {
    Image: (props: { source?: { uri?: string }; accessibilityLabel?: string }) =>
      ReactActual.createElement(View, {
        testID: "expo-image",
        accessibilityLabel: props.accessibilityLabel,
        "data-uri": props.source?.uri,
      }),
  };
});

jest.mock("./auth", () => {
  const actual = jest.requireActual("./auth");
  return {
    ...actual,
    getToken: jest.fn(() => Promise.resolve("polsia-token-xyz")),
  };
});

// Pin the device-local day key so the URL we assert against is
// deterministic. The thumbnail plumbing doesn't care what the key
// is — only that the request carries one — but the test reads
// cleaner with a fixed value.
jest.mock("./captureLimits", () => {
  const actual = jest.requireActual("./captureLimits");
  return {
    ...actual,
    getLocalDayKey: jest.fn(() => "2026-05-01"),
  };
});

const mockedAuth = jest.requireMock("./auth") as { getToken: jest.Mock };

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

function makeJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("apiFetchIllustrations — thumbnail URL plumbing", () => {
  test("resolves thumb_url to an absolute URL when present", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        items: {
          "mem-1": {
            url: "/api/illustrations/abc/full.png",
            thumb_url: "/api/illustrations/abc/thumb.png",
            prompt: "a quiet morning",
            generated_at: "2026-05-01T08:00:00.000Z",
          },
        },
        usedToday: 1,
        limit: 3,
      }),
    );

    const result = await apiFetchIllustrations();

    const entry = result.items["mem-1"];
    expect(entry).toBeDefined();
    // Both URLs must be absolute — the mobile <Image> can't fetch
    // server-relative paths, so a regression here would render the
    // Archive polaroids as broken-image placeholders.
    expect(entry?.url).toBe(
      absoluteIllustrationUrl("/api/illustrations/abc/full.png"),
    );
    expect(entry?.thumbUrl).toBe(
      absoluteIllustrationUrl("/api/illustrations/abc/thumb.png"),
    );
    // Sanity: the absolute resolver must produce a fully-qualified
    // URL (it's how the server-relative path becomes fetchable on
    // the device).
    expect(entry?.thumbUrl).toMatch(/^https?:\/\//);
    expect(entry?.generatedAt).toBe("2026-05-01T08:00:00.000Z");
  });

  test("leaves thumbUrl undefined when the server omits thumb_url (legacy record)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        items: {
          "mem-legacy": {
            url: "/api/illustrations/old/full.png",
            prompt: "legacy",
            generated_at: "2024-12-01T00:00:00.000Z",
          },
        },
        usedToday: 0,
        limit: 1,
      }),
    );

    const result = await apiFetchIllustrations();

    const entry = result.items["mem-legacy"];
    expect(entry).toBeDefined();
    expect(entry?.url).toBe(
      absoluteIllustrationUrl("/api/illustrations/old/full.png"),
    );
    // The polaroid's fallback only kicks in when `thumbUrl` is
    // strictly undefined; an empty string would render a broken
    // image. Lock both halves of that contract here.
    expect(entry?.thumbUrl).toBeUndefined();
  });

  test("treats an empty-string thumb_url as missing (no broken-image renders)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        items: {
          "mem-empty": {
            url: "/api/illustrations/x/full.png",
            thumb_url: "",
            prompt: "p",
            generated_at: "2026-05-01T08:00:00.000Z",
          },
        },
        usedToday: 0,
        limit: 1,
      }),
    );

    const result = await apiFetchIllustrations();

    const entry = result.items["mem-empty"];
    expect(entry?.thumbUrl).toBeUndefined();
  });

  test("preserves an already-absolute thumb_url unchanged", async () => {
    const absolute = "https://cdn.example.com/illos/abc/thumb.png";
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        items: {
          "mem-cdn": {
            url: "https://cdn.example.com/illos/abc/full.png",
            thumb_url: absolute,
            prompt: "p",
            generated_at: "2026-05-01T08:00:00.000Z",
          },
        },
        usedToday: 0,
        limit: 1,
      }),
    );

    const result = await apiFetchIllustrations();
    expect(result.items["mem-cdn"]?.thumbUrl).toBe(absolute);
  });
});

describe("mergeIllustrations — illustrationThumbUrl propagation", () => {
  type Memory = {
    id: string;
    illustrationUrl?: string;
    illustrationThumbUrl?: string;
    illustratedAt?: string;
  };

  test("populates illustrationThumbUrl from the map entry's thumbUrl", () => {
    const memories: Memory[] = [{ id: "mem-1" }];
    const map: IllustrationMap = {
      "mem-1": {
        url: "https://api.example.com/illos/full.png",
        thumbUrl: "https://api.example.com/illos/thumb.png",
        generatedAt: "2026-05-01T08:00:00.000Z",
      },
    };

    const merged = mergeIllustrations(memories, map);

    expect(merged[0]?.illustrationUrl).toBe(
      "https://api.example.com/illos/full.png",
    );
    expect(merged[0]?.illustrationThumbUrl).toBe(
      "https://api.example.com/illos/thumb.png",
    );
    expect(merged[0]?.illustratedAt).toBe("2026-05-01T08:00:00.000Z");
  });

  test("leaves illustrationThumbUrl undefined when the map entry has no thumbUrl", () => {
    const memories: Memory[] = [{ id: "mem-2" }];
    const map: IllustrationMap = {
      "mem-2": {
        url: "https://api.example.com/illos/full.png",
        generatedAt: "2026-05-01T08:00:00.000Z",
      },
    };

    const merged = mergeIllustrations(memories, map);

    expect(merged[0]?.illustrationUrl).toBe(
      "https://api.example.com/illos/full.png",
    );
    // Without a server-side thumb the merged record stays
    // thumb-less; the polaroid will fall back to the full-res URL.
    expect(merged[0]?.illustrationThumbUrl).toBeUndefined();
  });

  test("preserves a pre-existing illustrationThumbUrl when the map entry omits one", () => {
    // A memory may already carry a thumb URL from a previous merge
    // (e.g. cached state). A later bulk fetch that doesn't include
    // a thumb for that record must NOT clobber the existing value
    // back to undefined — that would cause a flicker from the cached
    // thumbnail back to the full-res URL.
    const memories: Memory[] = [
      {
        id: "mem-3",
        illustrationThumbUrl: "https://api.example.com/illos/cached-thumb.png",
      },
    ];
    const map: IllustrationMap = {
      "mem-3": {
        url: "https://api.example.com/illos/full.png",
        generatedAt: "2026-05-01T08:00:00.000Z",
      },
    };

    const merged = mergeIllustrations(memories, map);

    expect(merged[0]?.illustrationThumbUrl).toBe(
      "https://api.example.com/illos/cached-thumb.png",
    );
  });

  test("leaves memories without a map entry untouched", () => {
    const memories: Memory[] = [
      { id: "mem-1" },
      { id: "mem-2", illustrationThumbUrl: "https://api.example.com/keep.png" },
    ];
    const map: IllustrationMap = {
      "mem-1": {
        url: "https://api.example.com/illos/full.png",
        thumbUrl: "https://api.example.com/illos/thumb.png",
        generatedAt: "2026-05-01T08:00:00.000Z",
      },
    };

    const merged = mergeIllustrations(memories, map);

    expect(merged[0]?.illustrationThumbUrl).toBe(
      "https://api.example.com/illos/thumb.png",
    );
    // The second memory has no entry in the map, so its existing
    // thumb URL must survive verbatim.
    expect(merged[1]?.illustrationThumbUrl).toBe(
      "https://api.example.com/keep.png",
    );
    expect(merged[1]?.illustrationUrl).toBeUndefined();
  });
});

describe("apiIllustrateMemory — single-memory generate parsing", () => {
  // The lightbox/painting-loader UX hinges on this function returning
  // the right discriminated `kind`. A regression that, for example,
  // misclassifies a 402 as a generic server_error would skip the
  // paywall and leave the user staring at an error toast instead.

  const input = {
    clientId: "mem-1",
    content: "a quiet morning",
    tags: ["calm"],
    person: "alex",
  };

  test("200 with thumb_url resolves to absolute thumbUrl on the success result", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        illustration: {
          url: "/api/illustrations/abc/full.png",
          thumb_url: "/api/illustrations/abc/thumb.png",
          prompt: "p",
          generated_at: "2026-05-01T08:00:00.000Z",
        },
        isPro: true,
        usedToday: 2,
        limit: null,
      }),
    );

    const result = await apiIllustrateMemory(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.url).toBe(
      absoluteIllustrationUrl("/api/illustrations/abc/full.png"),
    );
    expect(result.thumbUrl).toBe(
      absoluteIllustrationUrl("/api/illustrations/abc/thumb.png"),
    );
    // A pro user has a `null` limit; the success branch must round-trip
    // it verbatim so the caller can distinguish "unlimited" from a
    // numeric quota.
    expect(result.isPro).toBe(true);
    expect(result.usedToday).toBe(2);
    expect(result.limit).toBeNull();
    expect(result.generatedAt).toBe("2026-05-01T08:00:00.000Z");
  });

  test("200 without thumb_url leaves thumbUrl undefined (legacy server)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        illustration: {
          url: "/api/illustrations/old/full.png",
          prompt: "p",
          generated_at: "2024-12-01T00:00:00.000Z",
        },
        isPro: false,
        usedToday: 1,
        limit: 3,
      }),
    );

    const result = await apiIllustrateMemory(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.thumbUrl).toBeUndefined();
    expect(result.isPro).toBe(false);
    expect(result.limit).toBe(3);
  });

  test("402 maps to limit with parsed limit/used (drives the paywall)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(402, { limit: 1, used: 1, error: "Daily limit" }),
    );

    const result = await apiIllustrateMemory(input);

    expect(result).toEqual({ kind: "limit", limit: 1, used: 1 });
  });

  test("402 with a malformed body falls back to default limit/used", async () => {
    // The paywall must still render even when the server forgets to
    // include the quota fields — defaults of `1/1` keep the UI honest.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: () => Promise.reject(new Error("not json")),
    } as unknown as Response);

    const result = await apiIllustrateMemory(input);

    expect(result).toEqual({ kind: "limit", limit: 1, used: 1 });
  });

  test("401 maps to auth_error", async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(401, { error: "nope" }));
    const result = await apiIllustrateMemory(input);
    expect(result).toEqual({ kind: "auth_error" });
  });

  test("403 maps to auth_error", async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(403, { error: "nope" }));
    const result = await apiIllustrateMemory(input);
    expect(result).toEqual({ kind: "auth_error" });
  });

  test("missing token short-circuits to auth_error without a network call", async () => {
    mockedAuth.getToken.mockResolvedValueOnce(null);
    const result = await apiIllustrateMemory(input);
    expect(result).toEqual({ kind: "auth_error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("5xx maps to server_error and surfaces the server's error message", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(500, { error: "image model timeout" }),
    );
    const result = await apiIllustrateMemory(input);
    expect(result).toEqual({
      kind: "server_error",
      message: "image model timeout",
    });
  });

  test("5xx with no parseable body falls back to a generic HTTP message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("not json")),
    } as unknown as Response);
    const result = await apiIllustrateMemory(input);
    expect(result).toEqual({ kind: "server_error", message: "HTTP 503" });
  });

  test("network failure (fetch rejects) maps to server_error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await apiIllustrateMemory(input);
    expect(result).toEqual({ kind: "server_error", message: "network down" });
  });

  test("200 with no illustration in payload maps to server_error", async () => {
    // Defensive: if the server ever returns 200 without the expected
    // shape, the caller must NOT see a `kind: "ok"` with an empty URL
    // — that would render the painting loader as a permanent blank.
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, { isPro: false, usedToday: 0, limit: 1 }),
    );
    const result = await apiIllustrateMemory(input);
    expect(result.kind).toBe("server_error");
  });
});

describe("apiDeleteIllustration — lightbox remove action parsing", () => {
  test("happy path returns ok with removed=true", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, { removed: true }),
    );
    const result = await apiDeleteIllustration("mem-1");
    expect(result).toEqual({ kind: "ok", removed: true });
  });

  test("idempotent second delete returns ok with removed=false", async () => {
    // The server treats a delete-of-already-deleted as success with
    // `removed: false`. The client must propagate that flag verbatim
    // so the UI can stay quiet on the second tap rather than
    // surfacing an error.
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, { removed: false }),
    );
    const result = await apiDeleteIllustration("mem-1");
    expect(result).toEqual({ kind: "ok", removed: false });
  });

  test("issues a DELETE against the per-memory endpoint with the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, { removed: true }),
    );
    await apiDeleteIllustration("mem-with/slash");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The clientId is URL-encoded so a memory id containing a slash
    // doesn't accidentally route to a different path segment.
    expect(url).toContain("/api/memories/mem-with%2Fslash/illustrate");
    expect(init.method).toBe("DELETE");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer polsia-token-xyz");
  });

  test("401 maps to auth_error", async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(401, { error: "nope" }));
    const result = await apiDeleteIllustration("mem-1");
    expect(result).toEqual({ kind: "auth_error" });
  });

  test("403 maps to auth_error", async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(403, { error: "nope" }));
    const result = await apiDeleteIllustration("mem-1");
    expect(result).toEqual({ kind: "auth_error" });
  });

  test("missing token short-circuits to auth_error without a network call", async () => {
    mockedAuth.getToken.mockResolvedValueOnce(null);
    const result = await apiDeleteIllustration("mem-1");
    expect(result).toEqual({ kind: "auth_error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("5xx maps to server_error and surfaces the server's error message", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(500, { error: "boom" }),
    );
    const result = await apiDeleteIllustration("mem-1");
    expect(result).toEqual({ kind: "server_error", message: "boom" });
  });

  test("5xx with no parseable body falls back to a generic HTTP message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error("not json")),
    } as unknown as Response);
    const result = await apiDeleteIllustration("mem-1");
    expect(result).toEqual({ kind: "server_error", message: "HTTP 502" });
  });

  test("network failure (fetch rejects) maps to server_error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const result = await apiDeleteIllustration("mem-1");
    expect(result).toEqual({ kind: "server_error", message: "offline" });
  });

  test("200 with an unparseable body still returns ok (treated as removed=false)", async () => {
    // Server changed the response shape but the call succeeded —
    // the client must not flip a successful delete into an error
    // toast just because the body wasn't JSON.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("not json")),
    } as unknown as Response);
    const result = await apiDeleteIllustration("mem-1");
    expect(result).toEqual({ kind: "ok", removed: false });
  });
});

describe("end-to-end: bulk fetch → merge → polaroid render", () => {
  // The full flow that the Archive screen exercises every time it
  // pulls a fresh illustration map: hit the bulk endpoint, parse
  // thumb_url to absolute thumbUrl, merge the map onto the memory
  // list to populate illustrationThumbUrl, then render the polaroid
  // with that field. A single test that walks the whole pipe is the
  // closest thing this suite has to an end-to-end guard — a break
  // anywhere from the network parser down to the <Image> source
  // would surface here as a wrong (or missing) URI on the rendered
  // polaroid.

  // Lazy-require so the jest.mock("expo-image", ...) hoist above is
  // already in effect when the component module loads.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { IllustrationPolaroid } = require("@/components/IllustrationPolaroid");

  test("thumb_url from the bulk response ends up as the <Image> URI on the polaroid", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        items: {
          "mem-1": {
            url: "/api/illustrations/abc/full.png",
            thumb_url: "/api/illustrations/abc/thumb.png",
            prompt: "p",
            generated_at: "2026-05-01T08:00:00.000Z",
          },
        },
        usedToday: 1,
        limit: 3,
      }),
    );

    // 1. Network: parse the bulk response.
    const fetched = await apiFetchIllustrations();

    // 2. Merge: stamp the map onto the memory list.
    const memories = mergeIllustrations(
      [{ id: "mem-1" } as { id: string; illustrationThumbUrl?: string; illustrationUrl?: string; illustratedAt?: string }],
      fetched.items,
    );

    const merged = memories[0];
    expect(merged?.illustrationThumbUrl).toBeDefined();

    // 3. Render: the polaroid should hand the merged thumb URL to
    //    expo-image, not the full-resolution URL.
    const view = render(
      React.createElement(IllustrationPolaroid, {
        imageUrl: merged?.illustrationUrl ?? "",
        thumbUrl: merged?.illustrationThumbUrl,
        caption: "a quiet morning",
      }),
    );

    const imageNode = view.getByTestId("expo-image");
    const renderedUri = imageNode.props["data-uri"] as string | undefined;

    expect(renderedUri).toBe(
      absoluteIllustrationUrl("/api/illustrations/abc/thumb.png"),
    );
    // Defensive: also confirm the URI is NOT the full-res URL — a
    // regression in any layer (parser, merge, polaroid) would land
    // here with the full-res URL instead.
    expect(renderedUri).not.toBe(
      absoluteIllustrationUrl("/api/illustrations/abc/full.png"),
    );
  });

  test("legacy bulk response (no thumb_url) renders the polaroid with the full-res URL", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        items: {
          "mem-1": {
            url: "/api/illustrations/old/full.png",
            prompt: "p",
            generated_at: "2024-12-01T00:00:00.000Z",
          },
        },
        usedToday: 0,
        limit: 1,
      }),
    );

    const fetched = await apiFetchIllustrations();
    const memories = mergeIllustrations(
      [{ id: "mem-1" } as { id: string; illustrationThumbUrl?: string; illustrationUrl?: string; illustratedAt?: string }],
      fetched.items,
    );
    const merged = memories[0];

    // The merged record carries no thumb URL when the server omits
    // one — the polaroid's `thumbUrl ?? imageUrl` fallback is what
    // keeps the Archive row from going blank for legacy records.
    expect(merged?.illustrationThumbUrl).toBeUndefined();

    const view = render(
      React.createElement(IllustrationPolaroid, {
        imageUrl: merged?.illustrationUrl ?? "",
        thumbUrl: merged?.illustrationThumbUrl,
        caption: "legacy",
      }),
    );

    const imageNode = view.getByTestId("expo-image");
    expect(imageNode.props["data-uri"]).toBe(
      absoluteIllustrationUrl("/api/illustrations/old/full.png"),
    );
  });
});
