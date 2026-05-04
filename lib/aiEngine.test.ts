/**
 * Tests for the patterns-aggregation tag derivation in `aiEngine.ts`.
 *
 * Task #276 swapped the home/recap "patterns envelope" inputs from
 * the legacy keyword `tags` array to the on-device facets extracted
 * by Apple's FoundationModels bridge (Task #195). These tests cover
 * both branches of `derivePatternTags` plus the integration into
 * `refreshPatternsIfDue` so we can be confident:
 *
 *   1. Memories with `facets` send the model's tags + theme to the
 *      server (the high-quality path).
 *   2. Memories without `facets` (legacy rows, or devices that
 *      can't run the model) keep using their `tags` keyword path.
 *
 * The `refreshPatternsIfDue` test exercises the full payload
 * construction by mocking the underlying `fetch` and the
 * AsyncStorage-backed `aiEngineStorage` helpers — we assert on the
 * `tags` array the server is asked to tally, which is the only
 * observable shape change from this refactor.
 */

import {
  derivePatternTags,
  refreshPatternsIfDue,
  type EngineMemoryInput,
  type PatternsEnvelope,
} from "./aiEngine";

jest.mock("./aiEngineStorage", () => {
  const actual = jest.requireActual("./aiEngineStorage");
  return {
    ...actual,
    loadPatternsMeta: jest.fn(() =>
      Promise.resolve({ last_built_at: "", memories_seen: 0 }),
    ),
    writePatternsMeta: jest.fn(() => Promise.resolve()),
    loadStoredPatterns: jest.fn(() => Promise.resolve(null)),
    writeStoredPatterns: jest.fn(() => Promise.resolve()),
  };
});

const originalFetch = global.fetch;
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
});

describe("derivePatternTags", () => {
  describe("facets-present codepath", () => {
    it("uses facets.tags and appends facets.theme as an additional tag", () => {
      const result = derivePatternTags({
        tags: ["legacy-keyword"],
        facets: {
          tags: ["work", "focus", "deep-work"],
          theme: "morning routine",
          mood: "calm",
        },
      });
      expect(result).toEqual([
        "work",
        "focus",
        "deep-work",
        "morning routine",
      ]);
    });

    it("ignores the legacy `tags` field when `facets` is present", () => {
      const result = derivePatternTags({
        tags: ["should-not-appear"],
        facets: { tags: ["family"], theme: "", mood: "" },
      });
      expect(result).toEqual(["family"]);
      expect(result).not.toContain("should-not-appear");
    });

    it("lowercases facet tags so capitalisation doesn't split buckets", () => {
      const result = derivePatternTags({
        facets: { tags: ["Work", "WORK", "work"], theme: "", mood: "" },
      });
      expect(result).toEqual(["work", "work", "work"]);
    });

    it("drops empty strings and non-string entries from facet tags", () => {
      const result = derivePatternTags({
        facets: {
          tags: [
            "  ",
            "",
            "family",
            // simulate a malformed payload
            null as unknown as string,
            "fitness",
          ],
          theme: "  ",
          mood: "",
        },
      });
      expect(result).toEqual(["family", "fitness"]);
    });

    it("returns an empty array when facets are present but vacuous", () => {
      const result = derivePatternTags({
        tags: ["ignored-keyword"],
        facets: { tags: [], theme: "", mood: "" },
      });
      expect(result).toEqual([]);
    });
  });

  describe("facets-absent codepath", () => {
    it("falls back to the legacy `tags` field when facets are missing", () => {
      const result = derivePatternTags({
        tags: ["work", "family"],
      });
      expect(result).toEqual(["work", "family"]);
    });

    it("returns an empty array when neither facets nor tags are present", () => {
      expect(derivePatternTags({})).toEqual([]);
    });

    it("preserves legacy tag casing (server already groups them as-is)", () => {
      const result = derivePatternTags({ tags: ["Work", "Family"] });
      expect(result).toEqual(["Work", "Family"]);
    });

    it("filters empty/whitespace-only legacy tags", () => {
      const result = derivePatternTags({
        tags: ["work", "", "  ", "family"],
      });
      expect(result).toEqual(["work", "family"]);
    });
  });
});

describe("refreshPatternsIfDue payload construction", () => {
  function envelope(): PatternsEnvelope {
    return {
      version: 1,
      generated_at: "2026-05-01T00:00:00.000Z",
      window_days: 31,
      data: {
        cold_start: false,
        cold_start_min: 5,
        memory_count: 0,
        embedding_count: 0,
        tags_30d: [],
        tags_90d: [],
        top_people: [],
        recurring_kinds: [],
        weekday_mood: {
          Sun: null,
          Mon: null,
          Tue: null,
          Wed: null,
          Thu: null,
          Fri: null,
          Sat: null,
        },
        recurring_theme: null,
        mood_trend: null,
        today_centroid: null,
        centroid: null,
      },
    };
  }

  it("sends facet-derived tags for memories with facets and legacy tags for memories without", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(envelope()),
      text: () => Promise.resolve(""),
    });

    const memories: EngineMemoryInput[] = [
      {
        id: "m1",
        content: "Walked the dog at sunrise",
        timestamp: "2026-04-30T07:00:00.000Z",
        kind: "memory",
        tags: ["legacy-walk"],
        facets: {
          tags: ["dog", "walk", "morning"],
          theme: "sunrise rituals",
          mood: "calm",
        },
      },
      {
        id: "m2",
        content: "Coffee with Alex",
        timestamp: "2026-04-29T10:00:00.000Z",
        kind: "memory",
        tags: ["coffee", "Alex"],
        // No facets — legacy row from before the bridge shipped.
      },
    ];

    await refreshPatternsIfDue("user@example.com", true, memories);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [, init] = call as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      memories: { id: string; tags: string[] }[];
    };

    const m1 = body.memories.find((m) => m.id === "m1");
    const m2 = body.memories.find((m) => m.id === "m2");

    // Facets-present: model-derived tags + theme, no legacy tag.
    expect(m1?.tags).toEqual([
      "dog",
      "walk",
      "morning",
      "sunrise rituals",
    ]);
    expect(m1?.tags).not.toContain("legacy-walk");

    // Facets-absent: untouched legacy tags pass through.
    expect(m2?.tags).toEqual(["coffee", "Alex"]);
  });
});
