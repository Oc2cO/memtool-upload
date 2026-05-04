import React from "react";
import { act, render } from "@testing-library/react-native";

import {
  MoodSparkline,
  SPARKLINE_HEIGHT,
  SPARKLINE_PADDING_X,
  SPARKLINE_PADDING_Y,
} from "./MoodSparkline";
import type {
  MonthRecap,
  MonthRecapMoodPoint,
} from "@/lib/recapMonth";

// MoodSparkline measures its container width via onLayout before
// rendering the SVG (Polyline coordinates depend on `width`). The
// react-native testing-library doesn't fire layout events on its own,
// so we walk the tree once and call any onLayout handler we find with
// the requested width — same trick the CaptureHeatmap strip-mode tests
// use to coax the bucketed rail into rendering.
function setSparklineWidth(
  view: ReturnType<typeof render>,
  width: number,
): void {
  act(() => {
    view.UNSAFE_root.findAll((node) => {
      if (typeof node.props.onLayout === "function") {
        node.props.onLayout({
          nativeEvent: { layout: { x: 0, y: 0, width, height: SPARKLINE_HEIGHT } },
        });
      }
      return false;
    });
  });
}

/**
 * Build a minimal MonthRecap fixture with just the fields MoodSparkline
 * reads. Other fields are filled with empty / zero defaults so the
 * type checker stays happy without us having to maintain a parallel
 * mock of the full aggregator output.
 */
function makeRecap(
  points: MonthRecapMoodPoint[],
  opts: {
    moodTrendLabel?: string;
    windowDays?: number;
    /** Override the raw moodSparkline length so isBucketed flips on. */
    rawSparklineLength?: number;
  } = {},
): MonthRecap {
  const windowDays = opts.windowDays ?? points.length;
  const rawLength = opts.rawSparklineLength ?? points.length;
  // `moodSparkline` only matters for the `isBucketed` comparison
  // (`points.length < recap.moodSparkline.length`), so we just need an
  // array of the right length — the contents are irrelevant.
  const moodSparkline: MonthRecapMoodPoint[] = Array.from(
    { length: rawLength },
    (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, rating: null }),
  );
  return {
    windowDays,
    windowStart: points[0]?.date ?? "2026-01-01",
    windowEnd: points[points.length - 1]?.date ?? "2026-01-01",
    totalCaptures: 0,
    daysWithCaptures: 0,
    topTags: [],
    topPeople: [],
    moodSparkline,
    displayMoodSparkline: points,
    dailyCaptureCounts: [],
    moodTrend: "steady",
    moodTrendLabel: opts.moodTrendLabel ?? "fairly steady",
    recurringTheme: null,
    isColdStart: false,
  };
}

/**
 * Pull the (x, y) coordinate pairs out of a rendered Polyline.
 * react-native-svg compiles `<Polyline points="x,y x,y …" />` down to
 * a Path whose `d` attribute looks like `M x0 y0 x1 y1 …` (the leading
 * `M` is followed by all coordinates space-separated, using SVG's
 * implicit-lineto rule). We strip the `M` and read flat number pairs.
 */
function readPolylineCoords(node: {
  props: { d?: string; points?: string };
}): Array<[number, number]> {
  const raw = node.props.d ?? node.props.points ?? "";
  const tokens = raw
    .replace(/^M\s*/, "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((n) => Number(n));
  if (tokens.length === 0 || tokens.length % 2 !== 0) {
    throw new Error(
      `Unexpected polyline coordinate string: ${JSON.stringify(raw)}`,
    );
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < tokens.length; i += 2) {
    pairs.push([tokens[i], tokens[i + 1]]);
  }
  return pairs;
}

describe("MoodSparkline", () => {
  describe("null-rating handling", () => {
    test("null-rating points are skipped from the polyline string", () => {
      // 5 days, only the 1st and 5th are rated. The polyline should
      // contain exactly two coordinate pairs — one per rated day.
      const points: MonthRecapMoodPoint[] = [
        { date: "2026-01-01", rating: 5 },
        { date: "2026-01-02", rating: null },
        { date: "2026-01-03", rating: null },
        { date: "2026-01-04", rating: null },
        { date: "2026-01-05", rating: 5 },
      ];
      const view = render(<MoodSparkline recap={makeRecap(points)} />);
      setSparklineWidth(view, 340);

      const polyline = view.getByTestId("mood-sparkline-polyline");
      const pairs = readPolylineCoords(polyline);
      expect(pairs).toHaveLength(2);

      // And there should be exactly two dot markers, keyed by the
      // original day index (0 and 4) — confirming nulls don't get a
      // dot either.
      expect(view.getByTestId("mood-sparkline-dot-0")).toBeTruthy();
      expect(view.getByTestId("mood-sparkline-dot-4")).toBeTruthy();
      expect(view.queryByTestId("mood-sparkline-dot-1")).toBeNull();
      expect(view.queryByTestId("mood-sparkline-dot-2")).toBeNull();
      expect(view.queryByTestId("mood-sparkline-dot-3")).toBeNull();
    });

    test("null-rating points still consume their x-step slot (gap is preserved)", () => {
      // Rated days at indices 0 and 4 of a 5-point series. With three
      // nulls in between, the second rated point must land four
      // x-steps to the right of the first — not one. If the renderer
      // ever forgets to skip nulls in the *index* (only filtering
      // them out of the rendered list), the two dots would collapse
      // adjacent and the gap would visually disappear.
      const points: MonthRecapMoodPoint[] = [
        { date: "2026-01-01", rating: 3 },
        { date: "2026-01-02", rating: null },
        { date: "2026-01-03", rating: null },
        { date: "2026-01-04", rating: null },
        { date: "2026-01-05", rating: 3 },
      ];
      const width = 340;
      const view = render(<MoodSparkline recap={makeRecap(points)} />);
      setSparklineWidth(view, width);

      const polyline = view.getByTestId("mood-sparkline-polyline");
      const pairs = readPolylineCoords(polyline);
      expect(pairs).toHaveLength(2);

      const chartWidth = width - SPARKLINE_PADDING_X * 2;
      const stepX = chartWidth / (points.length - 1);
      const expectedX0 = SPARKLINE_PADDING_X + stepX * 0;
      const expectedX4 = SPARKLINE_PADDING_X + stepX * 4;
      expect(pairs[0][0]).toBeCloseTo(expectedX0, 1);
      expect(pairs[1][0]).toBeCloseTo(expectedX4, 1);
      // And the gap on screen should be the full chart span (idx 0
      // → idx 4 = 4 steps), not a single step. This is the key
      // regression-guard for the null-skipping bug described in the
      // task.
      expect(pairs[1][0] - pairs[0][0]).toBeCloseTo(stepX * 4, 1);
    });

    test("when no day in the window has a rating, no polyline is rendered at all", () => {
      const points: MonthRecapMoodPoint[] = [
        { date: "2026-01-01", rating: null },
        { date: "2026-01-02", rating: null },
        { date: "2026-01-03", rating: null },
      ];
      const view = render(<MoodSparkline recap={makeRecap(points)} />);
      setSparklineWidth(view, 340);

      // Polyline is conditional on at least one rated point, so it
      // should be absent. The dashed midpoint baseline still renders.
      expect(view.queryByTestId("mood-sparkline-polyline")).toBeNull();
      expect(view.getByTestId("mood-sparkline-baseline")).toBeTruthy();
    });
  });

  describe("rating-to-y mapping", () => {
    // Chart spans SPARKLINE_PADDING_Y..SPARKLINE_PADDING_Y+chartHeight.
    // 1 → bottom (y = padding + chartHeight), 3 → midpoint
    // (y = padding + chartHeight/2), 5 → top (y = padding).
    const chartHeight = SPARKLINE_HEIGHT - SPARKLINE_PADDING_Y * 2;
    const yTop = SPARKLINE_PADDING_Y;
    const yMid = SPARKLINE_PADDING_Y + chartHeight / 2;
    const yBottom = SPARKLINE_PADDING_Y + chartHeight;

    test("rating 1 maps to the bottom of the chart", () => {
      const points: MonthRecapMoodPoint[] = [
        { date: "2026-01-01", rating: 1 },
        { date: "2026-01-02", rating: 1 },
      ];
      const view = render(<MoodSparkline recap={makeRecap(points)} />);
      setSparklineWidth(view, 340);

      const polyline = view.getByTestId("mood-sparkline-polyline");
      const pairs = readPolylineCoords(polyline);
      expect(pairs[0][1]).toBeCloseTo(yBottom, 1);
      expect(pairs[1][1]).toBeCloseTo(yBottom, 1);
    });

    test("rating 5 maps to the top of the chart", () => {
      const points: MonthRecapMoodPoint[] = [
        { date: "2026-01-01", rating: 5 },
        { date: "2026-01-02", rating: 5 },
      ];
      const view = render(<MoodSparkline recap={makeRecap(points)} />);
      setSparklineWidth(view, 340);

      const polyline = view.getByTestId("mood-sparkline-polyline");
      const pairs = readPolylineCoords(polyline);
      expect(pairs[0][1]).toBeCloseTo(yTop, 1);
      expect(pairs[1][1]).toBeCloseTo(yTop, 1);
    });

    test("rating 3 sits exactly on the midpoint baseline", () => {
      const points: MonthRecapMoodPoint[] = [
        { date: "2026-01-01", rating: 3 },
        { date: "2026-01-02", rating: 3 },
      ];
      const view = render(<MoodSparkline recap={makeRecap(points)} />);
      setSparklineWidth(view, 340);

      const polyline = view.getByTestId("mood-sparkline-polyline");
      const pairs = readPolylineCoords(polyline);
      expect(pairs[0][1]).toBeCloseTo(yMid, 1);
      expect(pairs[1][1]).toBeCloseTo(yMid, 1);

      // And the baseline line itself is drawn at the same y, so a
      // rating-3 dot visually sits on top of it.
      const baseline = view.getByTestId("mood-sparkline-baseline");
      expect(Number(baseline.props.y1)).toBeCloseTo(yMid, 5);
      expect(Number(baseline.props.y2)).toBeCloseTo(yMid, 5);
    });

    test("rating 2 and rating 4 sit symmetrically around the midpoint", () => {
      // 2 → 0.75 of the way down from the top (one quarter above
      // bottom); 4 → 0.25 of the way down (one quarter below top).
      // Sanity-checks that the linear mapping is monotone.
      const points: MonthRecapMoodPoint[] = [
        { date: "2026-01-01", rating: 2 },
        { date: "2026-01-02", rating: 4 },
      ];
      const view = render(<MoodSparkline recap={makeRecap(points)} />);
      setSparklineWidth(view, 340);

      const polyline = view.getByTestId("mood-sparkline-polyline");
      const pairs = readPolylineCoords(polyline);
      const y2 = pairs[0][1];
      const y4 = pairs[1][1];
      // y2 is below the midpoint, y4 is above it (smaller y is
      // higher on screen in SVG coords).
      expect(y2).toBeGreaterThan(yMid);
      expect(y4).toBeLessThan(yMid);
      // Distance from midpoint should match (y2 below ≈ y4 above).
      expect(Math.abs(y2 - yMid)).toBeCloseTo(Math.abs(yMid - y4), 1);
    });
  });

  describe("trend label", () => {
    test("renders the moodTrendLabel string verbatim", () => {
      const points: MonthRecapMoodPoint[] = [
        { date: "2026-01-01", rating: 3 },
      ];
      const view = render(
        <MoodSparkline
          recap={makeRecap(points, { moodTrendLabel: "trending upward" })}
        />,
      );
      setSparklineWidth(view, 340);
      expect(view.getByText("trending upward")).toBeTruthy();
    });

    test("each MoodTrend descriptor flows through to the rendered label", () => {
      // The aggregator hands us one of four descriptors via
      // `describeMoodTrend`. The renderer should be a pass-through
      // for each — no per-trend formatting tweaks.
      for (const label of [
        "trending upward",
        "trending downward",
        "fairly steady",
        "not enough data yet",
      ]) {
        const view = render(
          <MoodSparkline
            recap={makeRecap(
              [{ date: "2026-01-01", rating: 3 }],
              { moodTrendLabel: label },
            )}
          />,
        );
        setSparklineWidth(view, 340);
        expect(view.getByText(label)).toBeTruthy();
        view.unmount();
      }
    });

    test("label appends the bucket suffix when displayMoodSparkline is shorter than the raw series", () => {
      // Simulates the year view: 52 down-sampled buckets plotted
      // from a 365-day raw series. The renderer derives `isBucketed`
      // by comparing lengths and appends " · 7-day buckets".
      const displayPoints: MonthRecapMoodPoint[] = Array.from(
        { length: 4 },
        (_, i) => ({
          date: `2026-01-0${i + 1}`,
          rating: 3,
        }),
      );
      const view = render(
        <MoodSparkline
          recap={makeRecap(displayPoints, {
            moodTrendLabel: "trending upward",
            rawSparklineLength: 365,
          })}
        />,
      );
      setSparklineWidth(view, 340);
      expect(view.getByText("trending upward · 7-day buckets")).toBeTruthy();
    });

    test("label omits the bucket suffix when displayMoodSparkline matches the raw series length", () => {
      const points: MonthRecapMoodPoint[] = Array.from(
        { length: 5 },
        (_, i) => ({ date: `2026-01-0${i + 1}`, rating: 3 }),
      );
      const view = render(
        <MoodSparkline
          recap={makeRecap(points, {
            moodTrendLabel: "fairly steady",
            rawSparklineLength: points.length,
          })}
        />,
      );
      setSparklineWidth(view, 340);
      // Verbatim — no " · 7-day buckets" appended.
      expect(view.getByText("fairly steady")).toBeTruthy();
      expect(view.queryByText(/7-day buckets/)).toBeNull();
    });
  });

  describe("section header", () => {
    test("renders the windowDays in the section label", () => {
      const points: MonthRecapMoodPoint[] = [
        { date: "2026-01-01", rating: 3 },
      ];
      const view = render(
        <MoodSparkline recap={makeRecap(points, { windowDays: 90 })} />,
      );
      setSparklineWidth(view, 340);
      expect(view.getByText("MOOD OVER 90 DAYS")).toBeTruthy();
    });
  });
});
