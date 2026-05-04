import { pickHomeInsight, _internals } from "./homeInsight";
import type { PatternsEnvelope } from "./aiEngine";

function envelope(
  overrides: Partial<PatternsEnvelope["data"]> = {},
  envOverrides: Partial<PatternsEnvelope> = {},
): PatternsEnvelope {
  return {
    version: 1,
    generated_at: "2026-04-30T00:00:00.000Z",
    window_days: 31,
    data: {
      cold_start: false,
      cold_start_min: 5,
      memory_count: 20,
      embedding_count: 20,
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
      ...overrides,
    },
    ...envOverrides,
  };
}

const NOW = new Date("2026-04-30T12:00:00Z");

describe("pickHomeInsight", () => {
  it("returns cold_start when patterns is null", () => {
    const insight = pickHomeInsight(null, NOW);
    expect(insight.kind).toBe("cold_start");
    expect(insight.template).toMatch(/still getting to know you/i);
    expect(insight.highlight).toBe("");
  });

  it("returns cold_start when envelope flags cold_start", () => {
    const env = envelope({ cold_start: true });
    expect(pickHomeInsight(env, NOW).kind).toBe("cold_start");
  });

  it("returns cold_start when no candidate passes threshold", () => {
    // tags_30d top count = 1 (below MIN_THEME_COUNT=2),
    // top_people top count = 1 (below MIN_PERSON_COUNT=2),
    // only one weekday rated (below MIN_WEEKDAY_RATINGS=2),
    // mood_trend = "steady" (not improving/declining),
    // recurring_theme = null. Nothing passes.
    const env = envelope({
      tags_30d: [{ tag: "solo", count: 1 }],
      top_people: [{ person: "Alex", count: 1 }],
      weekday_mood: {
        Sun: null,
        Mon: 4,
        Tue: null,
        Wed: null,
        Thu: null,
        Fri: null,
        Sat: null,
      },
      mood_trend: "steady",
    });
    expect(pickHomeInsight(env, NOW).kind).toBe("cold_start");
  });

  it("returns top_theme when tags_30d has a clear top tag", () => {
    const env = envelope({
      tags_30d: [
        { tag: "family", count: 6 },
        { tag: "work", count: 2 },
      ],
    });
    const insight = pickHomeInsight(env, NOW);
    expect(insight.kind).toBe("top_theme");
    expect(insight.highlight).toBe("family");
    expect(insight.template).toContain("{HL}");
  });

  it("returns weekday_best when weekday_mood has a clear winner", () => {
    const env = envelope({
      weekday_mood: {
        Sun: 2,
        Mon: 3,
        Tue: 3,
        Wed: 5,
        Thu: 3,
        Fri: 4,
        Sat: 2,
      },
    });
    const candidates = _internals.buildCandidates(env);
    const wd = candidates.find((c) => c.kind === "weekday_best");
    expect(wd).toBeDefined();
    expect(wd!.highlight).toBe("Wednesdays");
  });

  it("rejects weekday_best when the gap is too small", () => {
    const env = envelope({
      weekday_mood: {
        Sun: null,
        Mon: 4.0,
        Tue: 3.9,
        Wed: 3.8,
        Thu: null,
        Fri: null,
        Sat: null,
      },
    });
    const candidates = _internals.buildCandidates(env);
    expect(candidates.find((c) => c.kind === "weekday_best")).toBeUndefined();
  });

  it("returns top_person when top_people[0] has count ≥ 2", () => {
    const env = envelope({
      top_people: [
        { person: "Sarah", count: 4 },
        { person: "Mom", count: 2 },
      ],
    });
    const candidates = _internals.buildCandidates(env);
    const tp = candidates.find((c) => c.kind === "top_person");
    expect(tp).toBeDefined();
    expect(tp!.highlight).toBe("Sarah");
  });

  it("returns mood_trend for improving and declining only", () => {
    const improving = _internals.buildCandidates(
      envelope({ mood_trend: "improving" }),
    );
    expect(improving.find((c) => c.kind === "mood_trend")?.highlight).toBe(
      "trending upward",
    );

    const declining = _internals.buildCandidates(
      envelope({ mood_trend: "declining" }),
    );
    expect(declining.find((c) => c.kind === "mood_trend")?.highlight).toBe(
      "trending downward",
    );

    const steady = _internals.buildCandidates(
      envelope({ mood_trend: "steady" }),
    );
    expect(steady.find((c) => c.kind === "mood_trend")).toBeUndefined();
  });

  it("returns recurring_theme when set and not duplicated by top_theme", () => {
    const env = envelope({
      tags_30d: [{ tag: "work", count: 3 }],
      recurring_theme: "growth",
    });
    const candidates = _internals.buildCandidates(env);
    const rt = candidates.find((c) => c.kind === "recurring_theme");
    expect(rt).toBeDefined();
    expect(rt!.highlight).toBe("growth");
  });

  it("suppresses recurring_theme when it duplicates top_theme", () => {
    const env = envelope({
      tags_30d: [{ tag: "family", count: 5 }],
      recurring_theme: "family",
    });
    const candidates = _internals.buildCandidates(env);
    expect(
      candidates.find((c) => c.kind === "recurring_theme"),
    ).toBeUndefined();
    expect(candidates.find((c) => c.kind === "top_theme")).toBeDefined();
  });

  it("rotates deterministically across consecutive days", () => {
    const env = envelope({
      tags_30d: [{ tag: "family", count: 5 }],
      top_people: [{ person: "Sarah", count: 4 }],
      weekday_mood: {
        Sun: 2,
        Mon: 3,
        Tue: 3,
        Wed: 5,
        Thu: 3,
        Fri: 4,
        Sat: 2,
      },
      mood_trend: "improving",
      recurring_theme: "growth",
    });
    const days = [
      new Date("2026-04-30T08:00:00Z"),
      new Date("2026-05-01T08:00:00Z"),
      new Date("2026-05-02T08:00:00Z"),
      new Date("2026-05-03T08:00:00Z"),
      new Date("2026-05-04T08:00:00Z"),
    ];
    const seen = new Set(days.map((d) => pickHomeInsight(env, d).kind));
    // With 5 candidates we should see at least 3 different kinds
    // across 5 consecutive days — proves rotation, not "stuck on
    // first candidate".
    expect(seen.size).toBeGreaterThanOrEqual(3);

    // Same day twice → same insight (stability within a day).
    const a = pickHomeInsight(env, new Date("2026-04-30T07:00:00Z"));
    const b = pickHomeInsight(env, new Date("2026-04-30T22:00:00Z"));
    expect(a.kind).toBe(b.kind);
    expect(a.highlight).toBe(b.highlight);
  });
});
