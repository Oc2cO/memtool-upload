import {
  aggregateMonthRecap,
  aggregateRangeRecap,
  bucketMoodSparkline,
  coldStartMinForWindow,
  MAX_SPARKLINE_DOTS,
  MONTH_RECAP_COLD_START_MIN,
  MONTH_RECAP_WINDOW_DAYS,
  SPARKLINE_BUCKET_DAYS,
} from "./recapMonth";
import type { Memory } from "./memories";
import type { MoodLog } from "./mood";
import type { PatternsEnvelope } from "./aiEngine";

const NOW = new Date("2026-04-30T15:00:00");

function dateOffset(daysAgo: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timestampOffset(daysAgo: number, hour = 12): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function memory(partial: Partial<Memory> & { id: string }): Memory {
  return {
    id: partial.id,
    userId: partial.userId ?? "test@test.com",
    content: partial.content ?? "thought",
    timestamp: partial.timestamp ?? timestampOffset(0),
    kind: partial.kind ?? "memory",
    tags: partial.tags,
    person: partial.person,
  };
}

function moodLog(date: string, rating: number): MoodLog {
  return { date, rating, client_id: `c-${date}` };
}

function patternsWithTheme(theme: string | null): PatternsEnvelope {
  return {
    version: 1,
    generated_at: NOW.toISOString(),
    window_days: 30,
    data: {
      cold_start: false,
      cold_start_min: 5,
      memory_count: 0,
      embedding_count: 0,
      tags_30d: [],
      tags_90d: [],
      top_people: [],
      recurring_kinds: [],
      weekday_mood: {},
      recurring_theme: theme,
      mood_trend: null,
      today_centroid: null,
      centroid: null,
    },
  };
}

describe("aggregateMonthRecap", () => {
  it("returns an empty/cold-start shape when there are no memories", () => {
    const recap = aggregateMonthRecap({
      memories: [],
      moodHistory: [],
      patterns: null,
      now: NOW,
    });
    expect(recap.totalCaptures).toBe(0);
    expect(recap.daysWithCaptures).toBe(0);
    expect(recap.topTags).toEqual([]);
    expect(recap.topPeople).toEqual([]);
    expect(recap.isColdStart).toBe(true);
    expect(recap.moodSparkline).toHaveLength(MONTH_RECAP_WINDOW_DAYS);
    expect(recap.moodSparkline.every((p) => p.rating === null)).toBe(true);
    expect(recap.moodTrend).toBe("insufficient");
    expect(recap.recurringTheme).toBeNull();
    expect(recap.windowEnd).toBe(dateOffset(0));
    expect(recap.windowStart).toBe(
      dateOffset(MONTH_RECAP_WINDOW_DAYS - 1),
    );
  });

  it("flags cold start when fewer than the minimum captures exist", () => {
    const memories = Array.from({ length: MONTH_RECAP_COLD_START_MIN - 1 }).map(
      (_, i) => memory({ id: `m${i}`, timestamp: timestampOffset(i) }),
    );
    const recap = aggregateMonthRecap({
      memories,
      moodHistory: [],
      patterns: null,
      now: NOW,
    });
    expect(recap.totalCaptures).toBe(MONTH_RECAP_COLD_START_MIN - 1);
    expect(recap.isColdStart).toBe(true);
  });

  it("clears cold start once the threshold is reached", () => {
    const memories = Array.from({ length: MONTH_RECAP_COLD_START_MIN }).map(
      (_, i) => memory({ id: `m${i}`, timestamp: timestampOffset(i) }),
    );
    const recap = aggregateMonthRecap({
      memories,
      moodHistory: [],
      patterns: null,
      now: NOW,
    });
    expect(recap.totalCaptures).toBe(MONTH_RECAP_COLD_START_MIN);
    expect(recap.isColdStart).toBe(false);
  });

  it("excludes captures older than the 30-day window", () => {
    const recap = aggregateMonthRecap({
      memories: [
        memory({ id: "in", timestamp: timestampOffset(29) }),
        memory({ id: "edge-out", timestamp: timestampOffset(30) }),
        memory({ id: "ancient", timestamp: timestampOffset(120) }),
      ],
      moodHistory: [],
      patterns: null,
      now: NOW,
    });
    expect(recap.totalCaptures).toBe(1);
    expect(recap.daysWithCaptures).toBe(1);
  });

  it("counts distinct days correctly when multiple captures share a day", () => {
    const recap = aggregateMonthRecap({
      memories: [
        memory({ id: "a1", timestamp: timestampOffset(0, 9) }),
        memory({ id: "a2", timestamp: timestampOffset(0, 14) }),
        memory({ id: "a3", timestamp: timestampOffset(0, 21) }),
        memory({ id: "b1", timestamp: timestampOffset(2, 10) }),
        memory({ id: "c1", timestamp: timestampOffset(10, 11) }),
      ],
      moodHistory: [],
      patterns: null,
      now: NOW,
    });
    expect(recap.totalCaptures).toBe(5);
    expect(recap.daysWithCaptures).toBe(3);
  });

  it("dedupes tags across memories case-insensitively and within a single memory", () => {
    const recap = aggregateMonthRecap({
      memories: [
        memory({
          id: "m1",
          timestamp: timestampOffset(1),
          tags: ["Work", "work", "  Focus  "],
        }),
        memory({
          id: "m2",
          timestamp: timestampOffset(2),
          tags: ["work", "side-project"],
        }),
        memory({
          id: "m3",
          timestamp: timestampOffset(3),
          tags: ["focus", ""],
        }),
      ],
      moodHistory: [],
      patterns: null,
      now: NOW,
    });
    const tagMap = Object.fromEntries(
      recap.topTags.map((t) => [t.tag.toLowerCase(), t.count]),
    );
    expect(tagMap["work"]).toBe(2);
    expect(tagMap["focus"]).toBe(2);
    expect(tagMap["side-project"]).toBe(1);
    expect(recap.topTags.find((t) => t.tag === "")).toBeUndefined();
  });

  it("dedupes people case-insensitively and ranks by count then name", () => {
    const recap = aggregateMonthRecap({
      memories: [
        memory({ id: "p1", timestamp: timestampOffset(1), person: "Sam" }),
        memory({ id: "p2", timestamp: timestampOffset(2), person: "sam" }),
        memory({ id: "p3", timestamp: timestampOffset(3), person: "Alex" }),
        memory({ id: "p4", timestamp: timestampOffset(4), person: "Jordan" }),
        memory({ id: "p5", timestamp: timestampOffset(5), person: "" }),
        memory({ id: "p6", timestamp: timestampOffset(6) }),
      ],
      moodHistory: [],
      patterns: null,
      now: NOW,
    });
    expect(recap.topPeople).toEqual([
      { person: "Sam", count: 2 },
      { person: "Alex", count: 1 },
      { person: "Jordan", count: 1 },
    ]);
  });

  it("limits people to the top three", () => {
    const recap = aggregateMonthRecap({
      memories: [
        memory({ id: "1", timestamp: timestampOffset(1), person: "Alex" }),
        memory({ id: "2", timestamp: timestampOffset(2), person: "Alex" }),
        memory({ id: "3", timestamp: timestampOffset(3), person: "Alex" }),
        memory({ id: "4", timestamp: timestampOffset(4), person: "Bea" }),
        memory({ id: "5", timestamp: timestampOffset(5), person: "Bea" }),
        memory({ id: "6", timestamp: timestampOffset(6), person: "Cam" }),
        memory({ id: "7", timestamp: timestampOffset(7), person: "Dee" }),
      ],
      moodHistory: [],
      patterns: null,
      now: NOW,
    });
    expect(recap.topPeople).toHaveLength(3);
    expect(recap.topPeople.map((p) => p.person)).toEqual(["Alex", "Bea", "Cam"]);
  });

  it("limits tags to the top five", () => {
    const recap = aggregateMonthRecap({
      memories: [
        memory({ id: "1", timestamp: timestampOffset(1), tags: ["a", "b", "c", "d", "e", "f"] }),
        memory({ id: "2", timestamp: timestampOffset(2), tags: ["a", "b", "c", "d", "e"] }),
      ],
      moodHistory: [],
      patterns: null,
      now: NOW,
    });
    expect(recap.topTags).toHaveLength(5);
  });

  it("classifies mood as upward when the second half averages clearly higher", () => {
    const moodHistory: MoodLog[] = [];
    for (let i = 0; i < MONTH_RECAP_WINDOW_DAYS; i++) {
      // i=0 is 29 days ago, i=29 is today
      const date = dateOffset(MONTH_RECAP_WINDOW_DAYS - 1 - i);
      moodHistory.push(moodLog(date, i < 15 ? 2 : 5));
    }
    const recap = aggregateMonthRecap({
      memories: [],
      moodHistory,
      patterns: null,
      now: NOW,
    });
    expect(recap.moodTrend).toBe("upward");
    expect(recap.moodTrendLabel).toMatch(/upward/);
  });

  it("classifies mood as downward when the second half averages clearly lower", () => {
    const moodHistory: MoodLog[] = [];
    for (let i = 0; i < MONTH_RECAP_WINDOW_DAYS; i++) {
      const date = dateOffset(MONTH_RECAP_WINDOW_DAYS - 1 - i);
      moodHistory.push(moodLog(date, i < 15 ? 5 : 2));
    }
    const recap = aggregateMonthRecap({
      memories: [],
      moodHistory,
      patterns: null,
      now: NOW,
    });
    expect(recap.moodTrend).toBe("downward");
    expect(recap.moodTrendLabel).toMatch(/downward/);
  });

  it("classifies mood as steady when both halves average similarly", () => {
    const moodHistory: MoodLog[] = [];
    for (let i = 0; i < MONTH_RECAP_WINDOW_DAYS; i++) {
      const date = dateOffset(MONTH_RECAP_WINDOW_DAYS - 1 - i);
      moodHistory.push(moodLog(date, 3));
    }
    const recap = aggregateMonthRecap({
      memories: [],
      moodHistory,
      patterns: null,
      now: NOW,
    });
    expect(recap.moodTrend).toBe("steady");
  });

  it("returns insufficient when fewer than four rated days exist", () => {
    const recap = aggregateMonthRecap({
      memories: [],
      moodHistory: [
        moodLog(dateOffset(0), 4),
        moodLog(dateOffset(1), 5),
        moodLog(dateOffset(2), 0), // unset, ignored
      ],
      patterns: null,
      now: NOW,
    });
    expect(recap.moodTrend).toBe("insufficient");
  });

  it("surfaces the recurring theme from the patterns envelope when present", () => {
    const recap = aggregateMonthRecap({
      memories: [
        memory({ id: "x", timestamp: timestampOffset(1) }),
      ],
      moodHistory: [],
      patterns: patternsWithTheme("You write most about focus on Mondays."),
      now: NOW,
    });
    expect(recap.recurringTheme).toBe(
      "You write most about focus on Mondays.",
    );
  });

  it("ignores empty or whitespace recurring themes", () => {
    const recap = aggregateMonthRecap({
      memories: [],
      moodHistory: [],
      patterns: patternsWithTheme("   "),
      now: NOW,
    });
    expect(recap.recurringTheme).toBeNull();
  });

  describe("dailyCaptureCounts (heatmap)", () => {
    it("returns an all-zero 30-cell oldest-first series when there are no captures", () => {
      const recap = aggregateMonthRecap({
        memories: [],
        moodHistory: [],
        patterns: null,
        now: NOW,
      });
      expect(recap.dailyCaptureCounts).toHaveLength(MONTH_RECAP_WINDOW_DAYS);
      expect(recap.dailyCaptureCounts.every((c) => c.count === 0)).toBe(true);
      // Oldest first: cell[0] is windowStart, cell[last] is windowEnd.
      expect(recap.dailyCaptureCounts[0].date).toBe(recap.windowStart);
      expect(
        recap.dailyCaptureCounts[recap.dailyCaptureCounts.length - 1].date,
      ).toBe(recap.windowEnd);
    });

    it("counts captures per local day with empty cells for quiet days", () => {
      const recap = aggregateMonthRecap({
        memories: [
          // Today: 3 captures
          memory({ id: "t1", timestamp: timestampOffset(0, 8) }),
          memory({ id: "t2", timestamp: timestampOffset(0, 14) }),
          memory({ id: "t3", timestamp: timestampOffset(0, 22) }),
          // 2 days ago: 1 capture
          memory({ id: "y1", timestamp: timestampOffset(2, 11) }),
          // 29 days ago (oldest in window): 1 capture
          memory({ id: "o1", timestamp: timestampOffset(29, 9) }),
          // Out of window — should NOT contribute
          memory({ id: "old", timestamp: timestampOffset(45) }),
        ],
        moodHistory: [],
        patterns: null,
        now: NOW,
      });
      const cells = recap.dailyCaptureCounts;
      expect(cells).toHaveLength(MONTH_RECAP_WINDOW_DAYS);
      const byDate = Object.fromEntries(cells.map((c) => [c.date, c.count]));
      expect(byDate[dateOffset(0)]).toBe(3);
      expect(byDate[dateOffset(2)]).toBe(1);
      expect(byDate[dateOffset(29)]).toBe(1);
      // A quiet day in between should be 0.
      expect(byDate[dateOffset(5)]).toBe(0);
      // Total across cells equals totalCaptures (in-window only).
      const cellTotal = cells.reduce((n, c) => n + c.count, 0);
      expect(cellTotal).toBe(recap.totalCaptures);
      expect(cellTotal).toBe(5);
      // Days with non-zero cells equals daysWithCaptures.
      const nonZero = cells.reduce(
        (n, c) => n + (c.count > 0 ? 1 : 0),
        0,
      );
      expect(nonZero).toBe(recap.daysWithCaptures);
    });

    it("returns cells in chronological order with no duplicate dates", () => {
      const recap = aggregateMonthRecap({
        memories: [
          memory({ id: "x", timestamp: timestampOffset(10) }),
        ],
        moodHistory: [],
        patterns: null,
        now: NOW,
      });
      const dates = recap.dailyCaptureCounts.map((c) => c.date);
      const sorted = [...dates].sort();
      expect(dates).toEqual(sorted);
      expect(new Set(dates).size).toBe(dates.length);
    });
  });
});

describe("coldStartMinForWindow", () => {
  it("returns the historical 5-capture floor for the 30-day window", () => {
    expect(coldStartMinForWindow(30)).toBe(MONTH_RECAP_COLD_START_MIN);
  });

  it("drops to 2 captures for the 7-day window", () => {
    // The proportional value (5 * 7 / 30 ≈ 1.17 → 1) is clamped up to
    // the documented minimum of 2 so a single capture never satisfies
    // the gate.
    expect(coldStartMinForWindow(7)).toBe(2);
  });

  it("never drops below 2 captures regardless of how short the window is", () => {
    expect(coldStartMinForWindow(1)).toBe(2);
    expect(coldStartMinForWindow(3)).toBe(2);
  });
});

describe("aggregateRangeRecap (7-day window)", () => {
  const WEEK = 7;

  it("returns a sparkline of exactly windowDays entries", () => {
    const recap = aggregateRangeRecap({
      memories: [],
      moodHistory: [],
      patterns: null,
      windowDays: WEEK,
      now: NOW,
    });
    expect(recap.windowDays).toBe(WEEK);
    expect(recap.moodSparkline).toHaveLength(WEEK);
    expect(recap.windowEnd).toBe(dateOffset(0));
    expect(recap.windowStart).toBe(dateOffset(WEEK - 1));
  });

  it("flags cold start when fewer than 2 captures exist in the past 7 days", () => {
    const recap = aggregateRangeRecap({
      memories: [memory({ id: "m1", timestamp: timestampOffset(0) })],
      moodHistory: [],
      patterns: null,
      windowDays: WEEK,
      now: NOW,
    });
    expect(recap.totalCaptures).toBe(1);
    expect(recap.isColdStart).toBe(true);
  });

  it("clears cold start once two captures land inside the 7-day window", () => {
    const recap = aggregateRangeRecap({
      memories: [
        memory({ id: "m1", timestamp: timestampOffset(0) }),
        memory({ id: "m2", timestamp: timestampOffset(2) }),
      ],
      moodHistory: [],
      patterns: null,
      windowDays: WEEK,
      now: NOW,
    });
    expect(recap.totalCaptures).toBe(2);
    expect(recap.isColdStart).toBe(false);
  });

  it("excludes captures older than the 7-day window even if they are within 30 days", () => {
    const recap = aggregateRangeRecap({
      memories: [
        memory({ id: "in", timestamp: timestampOffset(6) }),
        memory({ id: "edge-out", timestamp: timestampOffset(7) }),
        memory({ id: "month-but-not-week", timestamp: timestampOffset(20) }),
      ],
      moodHistory: [],
      patterns: null,
      windowDays: WEEK,
      now: NOW,
    });
    expect(recap.totalCaptures).toBe(1);
    expect(recap.daysWithCaptures).toBe(1);
  });

  it("classifies mood across the 7-day window using the same ≥4 rated-day rule", () => {
    // Four rated days: two in the older half (low) and two in the
    // newer half (high). Trend should be upward.
    const recap = aggregateRangeRecap({
      memories: [],
      moodHistory: [
        moodLog(dateOffset(6), 2),
        moodLog(dateOffset(5), 2),
        moodLog(dateOffset(1), 5),
        moodLog(dateOffset(0), 5),
      ],
      patterns: null,
      windowDays: WEEK,
      now: NOW,
    });
    expect(recap.moodTrend).toBe("upward");
    expect(recap.moodSparkline).toHaveLength(WEEK);
  });

  it("returns insufficient when fewer than four rated days exist in the 7-day window", () => {
    const recap = aggregateRangeRecap({
      memories: [],
      moodHistory: [
        moodLog(dateOffset(0), 4),
        moodLog(dateOffset(1), 5),
        moodLog(dateOffset(2), 3),
      ],
      patterns: null,
      windowDays: WEEK,
      now: NOW,
    });
    expect(recap.moodTrend).toBe("insufficient");
  });

  it("still surfaces the recurring theme from the patterns envelope on the 7-day view", () => {
    const recap = aggregateRangeRecap({
      memories: [
        memory({ id: "x", timestamp: timestampOffset(1) }),
        memory({ id: "y", timestamp: timestampOffset(2) }),
      ],
      moodHistory: [],
      patterns: patternsWithTheme("Lots of focus this week."),
      windowDays: WEEK,
      now: NOW,
    });
    expect(recap.recurringTheme).toBe("Lots of focus this week.");
  });

  it("defaults to the 30-day window when windowDays is omitted", () => {
    const recap = aggregateRangeRecap({
      memories: [],
      moodHistory: [],
      patterns: null,
      now: NOW,
    });
    expect(recap.windowDays).toBe(MONTH_RECAP_WINDOW_DAYS);
    expect(recap.moodSparkline).toHaveLength(MONTH_RECAP_WINDOW_DAYS);
  });
});

describe("aggregateRangeRecap (90-day quarter window)", () => {
  const QUARTER = 90;

  it("returns sparkline + heatmap series of exactly windowDays entries", () => {
    const recap = aggregateRangeRecap({
      memories: [],
      moodHistory: [],
      patterns: null,
      windowDays: QUARTER,
      now: NOW,
    });
    expect(recap.windowDays).toBe(QUARTER);
    expect(recap.moodSparkline).toHaveLength(QUARTER);
    // Regression guard: earlier versions hard-coded 30 here, which
    // truncated the heatmap series for the new quarter view.
    expect(recap.dailyCaptureCounts).toHaveLength(QUARTER);
    expect(recap.windowEnd).toBe(dateOffset(0));
    expect(recap.windowStart).toBe(dateOffset(QUARTER - 1));
    expect(recap.dailyCaptureCounts[0].date).toBe(recap.windowStart);
    expect(
      recap.dailyCaptureCounts[recap.dailyCaptureCounts.length - 1].date,
    ).toBe(recap.windowEnd);
  });

  it("uses the proportional 15-capture cold-start floor for 90 days", () => {
    expect(coldStartMinForWindow(QUARTER)).toBe(15);
    const memories = Array.from({ length: 14 }).map((_, i) =>
      memory({ id: `m${i}`, timestamp: timestampOffset(i * 6) }),
    );
    const recap = aggregateRangeRecap({
      memories,
      moodHistory: [],
      patterns: null,
      windowDays: QUARTER,
      now: NOW,
    });
    expect(recap.totalCaptures).toBe(14);
    expect(recap.isColdStart).toBe(true);
  });

  it("clears cold start once 15 captures land inside the 90-day window", () => {
    const memories = Array.from({ length: 15 }).map((_, i) =>
      memory({ id: `m${i}`, timestamp: timestampOffset(i * 5) }),
    );
    const recap = aggregateRangeRecap({
      memories,
      moodHistory: [],
      patterns: null,
      windowDays: QUARTER,
      now: NOW,
    });
    expect(recap.totalCaptures).toBe(15);
    expect(recap.isColdStart).toBe(false);
  });

  it("excludes captures older than 90 days even if they are within a year", () => {
    const recap = aggregateRangeRecap({
      memories: [
        memory({ id: "in", timestamp: timestampOffset(89) }),
        memory({ id: "edge-out", timestamp: timestampOffset(90) }),
        memory({ id: "year-but-not-quarter", timestamp: timestampOffset(200) }),
      ],
      moodHistory: [],
      patterns: null,
      windowDays: QUARTER,
      now: NOW,
    });
    expect(recap.totalCaptures).toBe(1);
    expect(recap.daysWithCaptures).toBe(1);
  });

  it("down-samples the display sparkline into weekly buckets", () => {
    const recap = aggregateRangeRecap({
      memories: [],
      moodHistory: [],
      patterns: null,
      windowDays: QUARTER,
      now: NOW,
    });
    expect(recap.moodSparkline).toHaveLength(QUARTER);
    // 90 / 7 = 12.86 → 13 buckets (the final bucket is partial so the
    // most recent days are never dropped).
    expect(recap.displayMoodSparkline).toHaveLength(
      Math.ceil(QUARTER / SPARKLINE_BUCKET_DAYS),
    );
    expect(recap.displayMoodSparkline.length).toBeLessThanOrEqual(
      MAX_SPARKLINE_DOTS,
    );
  });
});

describe("aggregateRangeRecap (365-day year window)", () => {
  const YEAR = 365;

  it("returns sparkline + heatmap series of exactly windowDays entries", () => {
    const recap = aggregateRangeRecap({
      memories: [],
      moodHistory: [],
      patterns: null,
      windowDays: YEAR,
      now: NOW,
    });
    expect(recap.windowDays).toBe(YEAR);
    expect(recap.moodSparkline).toHaveLength(YEAR);
    expect(recap.dailyCaptureCounts).toHaveLength(YEAR);
    expect(recap.windowEnd).toBe(dateOffset(0));
    expect(recap.windowStart).toBe(dateOffset(YEAR - 1));
  });

  it("uses the proportional 61-capture cold-start floor for 365 days", () => {
    expect(coldStartMinForWindow(YEAR)).toBe(61);
    const memories = Array.from({ length: 60 }).map((_, i) =>
      memory({ id: `m${i}`, timestamp: timestampOffset(i * 6) }),
    );
    const recap = aggregateRangeRecap({
      memories,
      moodHistory: [],
      patterns: null,
      windowDays: YEAR,
      now: NOW,
    });
    expect(recap.isColdStart).toBe(true);
  });

  it("excludes captures older than 365 days", () => {
    const recap = aggregateRangeRecap({
      memories: [
        memory({ id: "in", timestamp: timestampOffset(364) }),
        memory({ id: "edge-out", timestamp: timestampOffset(365) }),
        memory({ id: "ancient", timestamp: timestampOffset(800) }),
      ],
      moodHistory: [],
      patterns: null,
      windowDays: YEAR,
      now: NOW,
    });
    expect(recap.totalCaptures).toBe(1);
  });

  it("down-samples the display sparkline into ~52 weekly buckets", () => {
    const recap = aggregateRangeRecap({
      memories: [],
      moodHistory: [],
      patterns: null,
      windowDays: YEAR,
      now: NOW,
    });
    expect(recap.moodSparkline).toHaveLength(YEAR);
    // 365 / 7 = 52.14 → 53 buckets (final bucket is partial so the
    // most recent days are never dropped).
    expect(recap.displayMoodSparkline).toHaveLength(
      Math.ceil(YEAR / SPARKLINE_BUCKET_DAYS),
    );
  });

  it("classifies the year-window mood trend off the raw daily series, not the buckets", () => {
    // 365 days where the older half (oldest 182 days) averages 2 and
    // the newer half (most recent 183 days) averages 5. Bucketing
    // first would smear the boundary; classifying off the raw series
    // gives a clean 'upward' label.
    const moodHistory: MoodLog[] = [];
    for (let i = 0; i < YEAR; i++) {
      const date = dateOffset(YEAR - 1 - i);
      moodHistory.push(moodLog(date, i < YEAR / 2 ? 2 : 5));
    }
    const recap = aggregateRangeRecap({
      memories: [],
      moodHistory,
      patterns: null,
      windowDays: YEAR,
      now: NOW,
    });
    expect(recap.moodTrend).toBe("upward");
  });

  it("still surfaces the recurring theme on the year view", () => {
    const recap = aggregateRangeRecap({
      memories: [
        memory({ id: "x", timestamp: timestampOffset(1) }),
        memory({ id: "y", timestamp: timestampOffset(100) }),
      ],
      moodHistory: [],
      patterns: patternsWithTheme("A year of focus on ship dates."),
      windowDays: YEAR,
      now: NOW,
    });
    expect(recap.recurringTheme).toBe("A year of focus on ship dates.");
  });
});

describe("displayMoodSparkline gating", () => {
  it("equals moodSparkline at the 30-day window (no bucketing)", () => {
    const recap = aggregateRangeRecap({
      memories: [],
      moodHistory: [],
      patterns: null,
      windowDays: 30,
      now: NOW,
    });
    expect(recap.displayMoodSparkline).toEqual(recap.moodSparkline);
  });

  it("equals moodSparkline at the 7-day window (no bucketing)", () => {
    const recap = aggregateRangeRecap({
      memories: [],
      moodHistory: [],
      patterns: null,
      windowDays: 7,
      now: NOW,
    });
    expect(recap.displayMoodSparkline).toEqual(recap.moodSparkline);
  });

  it("is shorter than moodSparkline once the window exceeds the soft cap", () => {
    const recap = aggregateRangeRecap({
      memories: [],
      moodHistory: [],
      patterns: null,
      windowDays: MAX_SPARKLINE_DOTS + 1,
      now: NOW,
    });
    expect(recap.displayMoodSparkline.length).toBeLessThan(
      recap.moodSparkline.length,
    );
  });
});

describe("bucketMoodSparkline", () => {
  it("returns the input unchanged when the bucket size is 1", () => {
    const points = [
      { date: "2026-01-01", rating: 3 },
      { date: "2026-01-02", rating: null },
    ];
    expect(bucketMoodSparkline(points, 1)).toEqual(points);
  });

  it("returns the input unchanged when fewer than bucketDays points exist", () => {
    const points = [
      { date: "2026-01-01", rating: 3 },
      { date: "2026-01-02", rating: 4 },
    ];
    expect(bucketMoodSparkline(points, 7)).toEqual(points);
  });

  it("groups points into bucketDays-wide buckets keyed by the first day of the bucket", () => {
    const points = Array.from({ length: 14 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      rating: i < 7 ? 2 : 4,
    }));
    const buckets = bucketMoodSparkline(points, 7);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toEqual({ date: "2026-01-01", rating: 2 });
    expect(buckets[1]).toEqual({ date: "2026-01-08", rating: 4 });
  });

  it("averages only the rated days in each bucket and keeps null when the whole bucket is unrated", () => {
    const points = [
      { date: "2026-01-01", rating: 4 },
      { date: "2026-01-02", rating: null },
      { date: "2026-01-03", rating: 2 },
      { date: "2026-01-04", rating: null },
      { date: "2026-01-05", rating: null },
      { date: "2026-01-06", rating: null },
      { date: "2026-01-07", rating: null },
    ];
    const [bucket] = bucketMoodSparkline(points, 7);
    // Mean of 4 and 2 (the only rated days) is 3.
    expect(bucket).toEqual({ date: "2026-01-01", rating: 3 });

    const allNull = Array.from({ length: 7 }).map((_, i) => ({
      date: `2026-02-${String(i + 1).padStart(2, "0")}`,
      rating: null as number | null,
    }));
    const [emptyBucket] = bucketMoodSparkline(allNull, 7);
    expect(emptyBucket).toEqual({ date: "2026-02-01", rating: null });
  });

  it("keeps the final partial bucket so the most recent days are not dropped", () => {
    // 9 daily points with bucket size 7 → 2 buckets (7 + 2). The
    // second bucket is partial but must be present so the newest
    // days still influence the chart.
    const points = Array.from({ length: 9 }).map((_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, "0")}`,
      rating: 5,
    }));
    const buckets = bucketMoodSparkline(points, 7);
    expect(buckets).toHaveLength(2);
    expect(buckets[1].date).toBe("2026-03-08");
    expect(buckets[1].rating).toBe(5);
  });
});
