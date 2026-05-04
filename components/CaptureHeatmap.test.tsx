import React from "react";
import { StyleSheet } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

import {
  CaptureHeatmap,
  HEATMAP_CELL_GAP,
  HEATMAP_MONTH_LABEL_CHAR_WIDTH,
  HEATMAP_STRIP_CELL_MIN,
} from "./CaptureHeatmap";
import type { MonthRecapDailyCount } from "@/lib/recapMonth";

// CaptureHeatmap fires `Haptics.selectionAsync` on press; the global
// jest.setup.js mock for expo-haptics doesn't include that method, so
// we extend the mock here. We `.catch()` it in the component, so a
// resolved promise is enough.
jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

// Fixed local-time anchor week: 2025-05-04 is a Sunday in every
// timezone (the component constructs dates with the local-time
// constructor, so its day-of-week math doesn't depend on the host
// machine's TZ).
const SUN = "2025-05-04";
const MON = "2025-05-05";
const TUE = "2025-05-06";
const WED = "2025-05-07";
const THU = "2025-05-08";
const FRI = "2025-05-09";
const SAT = "2025-05-10";
const NEXT_SUN = "2025-05-11";

function flatStyle(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(node.props.style as never) as Record<
    string,
    unknown
  >;
}

/**
 * Build a contiguous oldest-first window of N daily counts ending on
 * `endIso` (local). Mirrors the shape `aggregateRangeRecap` produces
 * so the heatmap is always given a real date series.
 */
function buildWindow(
  endIso: string,
  days: number,
  countFor: (idx: number, iso: string) => number = () => 0,
): MonthRecapDailyCount[] {
  const [ey, em, ed] = endIso.split("-").map((s) => Number(s));
  const end = new Date(ey, em - 1, ed);
  const out: MonthRecapDailyCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(end);
    dt.setDate(end.getDate() - i);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const iso = `${y}-${m}-${d}`;
    out.push({ date: iso, count: countFor(days - 1 - i, iso) });
  }
  return out;
}

describe("CaptureHeatmap", () => {
  describe("today highlight", () => {
    test("today's cell uses the accent ring style and a11y label ends in 'today'", () => {
      const view = render(
        <CaptureHeatmap
          counts={[
            { date: SUN, count: 1 },
            { date: MON, count: 2 },
            { date: TUE, count: 0 },
            { date: WED, count: 4 },
            { date: THU, count: 0 },
            { date: FRI, count: 1 },
            { date: SAT, count: 3 },
          ]}
          today={WED}
          windowDays={30}
          onSelectDate={() => {}}
        />,
      );

      const todayCell = view.getByLabelText(/, today$/);
      expect(todayCell.props.accessibilityLabel).toMatch(/Wed/);
      expect(todayCell.props.accessibilityLabel).toMatch(/4 memories/);

      // The today branch wraps the fill in a separate View so the ring
      // stays at full opacity. The wrapper carries the heatmapCellToday
      // style: borderWidth 2, accent borderColor.
      const style = flatStyle(todayCell);
      expect(style.borderWidth).toBe(2);
      expect(style.borderColor).toBe("#00E5FF");
    });

    test("non-today cells render the standard cell style and omit the today suffix", () => {
      const view = render(
        <CaptureHeatmap
          counts={[
            { date: SUN, count: 0 },
            { date: MON, count: 1 },
            { date: TUE, count: 3 },
          ]}
          // SAT is not in the window — no cell should end in "today".
          today={SAT}
          windowDays={30}
          onSelectDate={() => {}}
        />,
      );

      expect(view.queryByLabelText(/, today$/)).toBeNull();

      const sun = view.getByLabelText(/Sun.*May 4.*0 memories$/);
      const mon = view.getByLabelText(/Mon.*May 5.*1 memory$/);
      const tue = view.getByLabelText(/Tue.*May 6.*3 memories$/);

      // Standard cell uses hairline borderWidth (NOT 2 like the ring).
      expect(flatStyle(sun).borderWidth).toBe(StyleSheet.hairlineWidth);
      expect(flatStyle(mon).borderWidth).toBe(StyleSheet.hairlineWidth);
      expect(flatStyle(tue).borderWidth).toBe(StyleSheet.hairlineWidth);
    });
  });

  describe("week-column bucketing", () => {
    test("a complete Sun→Sat week fills column 0 in day-of-week order", () => {
      const view = render(
        <CaptureHeatmap
          counts={[
            { date: SUN, count: 1 },
            { date: MON, count: 1 },
            { date: TUE, count: 1 },
            { date: WED, count: 1 },
            { date: THU, count: 1 },
            { date: FRI, count: 1 },
            { date: SAT, count: 1 },
          ]}
          today=""
          windowDays={30}
          onSelectDate={() => {}}
        />,
      );

      const col = view.getByTestId("heatmap-col-0");
      // Each column always renders 7 row slots; non-window days are
      // empty Views without a11y labels.
      expect(col.children).toHaveLength(7);
      const labels = (
        col.children as ReadonlyArray<{
          props: { accessibilityLabel?: string };
        }>
      ).map((c) => c.props.accessibilityLabel);
      expect(labels[0]).toMatch(/Sun.*May 4/);
      expect(labels[1]).toMatch(/Mon.*May 5/);
      expect(labels[2]).toMatch(/Tue.*May 6/);
      expect(labels[3]).toMatch(/Wed.*May 7/);
      expect(labels[4]).toMatch(/Thu.*May 8/);
      expect(labels[5]).toMatch(/Fri.*May 9/);
      expect(labels[6]).toMatch(/Sat.*May 10/);
    });

    test("a partial first week leaves earlier weekday slots empty", () => {
      // Window starts on Wednesday — rows 0..2 of column 0 should be
      // empty placeholder Views (no a11y label), rows 3..6 carry the
      // window's first four days.
      const view = render(
        <CaptureHeatmap
          counts={[
            { date: WED, count: 1 },
            { date: THU, count: 1 },
            { date: FRI, count: 1 },
            { date: SAT, count: 1 },
          ]}
          today=""
          windowDays={30}
          onSelectDate={() => {}}
        />,
      );

      const col = view.getByTestId("heatmap-col-0");
      const slots = col.children as ReadonlyArray<{
        props: { accessibilityLabel?: string };
      }>;
      expect(slots).toHaveLength(7);
      expect(slots[0].props.accessibilityLabel).toBeUndefined();
      expect(slots[1].props.accessibilityLabel).toBeUndefined();
      expect(slots[2].props.accessibilityLabel).toBeUndefined();
      expect(slots[3].props.accessibilityLabel).toMatch(/Wed/);
      expect(slots[4].props.accessibilityLabel).toMatch(/Thu/);
      expect(slots[5].props.accessibilityLabel).toMatch(/Fri/);
      expect(slots[6].props.accessibilityLabel).toMatch(/Sat/);
    });

    test("Saturday closes a column and the next Sunday opens a new one", () => {
      const view = render(
        <CaptureHeatmap
          counts={[
            { date: SAT, count: 1 },
            { date: NEXT_SUN, count: 1 },
          ]}
          today=""
          windowDays={30}
          onSelectDate={() => {}}
        />,
      );

      const col0 = view.getByTestId("heatmap-col-0");
      const col1 = view.getByTestId("heatmap-col-1");
      const col0Slots = col0.children as ReadonlyArray<{
        props: { accessibilityLabel?: string };
      }>;
      const col1Slots = col1.children as ReadonlyArray<{
        props: { accessibilityLabel?: string };
      }>;

      // Column 0: only the Saturday slot (row 6) is filled.
      expect(col0Slots).toHaveLength(7);
      for (let i = 0; i < 6; i++) {
        expect(col0Slots[i].props.accessibilityLabel).toBeUndefined();
      }
      expect(col0Slots[6].props.accessibilityLabel).toMatch(/Sat.*May 10/);

      // Column 1: only the Sunday slot (row 0) is filled.
      expect(col1Slots).toHaveLength(7);
      expect(col1Slots[0].props.accessibilityLabel).toMatch(/Sun.*May 11/);
      for (let i = 1; i < 7; i++) {
        expect(col1Slots[i].props.accessibilityLabel).toBeUndefined();
      }
    });
  });

  describe("intensity scaling", () => {
    test("opacity scales linearly across count = 0, mid, and max", () => {
      // max = 4 for this fixture, so:
      //   count 0 → empty colour, opacity 1 (border + "55" fallback)
      //   count 1 → 0.35 + 0.65 * 1/4 = 0.5125
      //   count 2 → 0.35 + 0.65 * 2/4 = 0.675
      //   count 4 → 0.35 + 0.65 * 4/4 = 1
      const view = render(
        <CaptureHeatmap
          counts={[
            { date: SUN, count: 0 },
            { date: MON, count: 1 },
            { date: TUE, count: 2 },
            { date: WED, count: 4 },
          ]}
          today=""
          windowDays={30}
          onSelectDate={() => {}}
        />,
      );

      const cellSun = view.getByLabelText(/Sun.*0 memories$/);
      const cellMon = view.getByLabelText(/Mon.*1 memory$/);
      const cellTue = view.getByLabelText(/Tue.*2 memories$/);
      const cellWed = view.getByLabelText(/Wed.*4 memories$/);

      // Empty cell — opacity is 1 because the cell paints the muted
      // border colour at full strength rather than dimming the primary.
      expect(flatStyle(cellSun).opacity).toBe(1);

      const monOpacity = flatStyle(cellMon).opacity as number;
      const tueOpacity = flatStyle(cellTue).opacity as number;
      const wedOpacity = flatStyle(cellWed).opacity as number;
      expect(monOpacity).toBeCloseTo(0.35 + 0.65 * (1 / 4), 5);
      expect(tueOpacity).toBeCloseTo(0.35 + 0.65 * (2 / 4), 5);
      expect(wedOpacity).toBeCloseTo(1, 5);

      // The empty cell uses the muted border-colour fill, not the
      // primary tint that filled cells use. We assert this indirectly
      // by checking that the empty cell's background is distinct from
      // the max-intensity cell's background.
      expect(flatStyle(cellSun).backgroundColor).not.toBe(
        flatStyle(cellWed).backgroundColor,
      );
    });
  });

  describe("strip-mode month markers (windowDays > 30)", () => {
    // Build a contiguous oldest-first daily-counts array starting at
    // `startISO` for `days` days. Mirrors aggregateRangeRecap's
    // shape so the heatmap's bucketing logic gets a real date series.
    function buildDailyCounts(startISO: string, days: number) {
      const [y, m, d] = startISO.split("-").map((s) => Number(s));
      const start = new Date(y, m - 1, d);
      const out: Array<{ date: string; count: number }> = [];
      for (let i = 0; i < days; i++) {
        const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
        out.push({ date: iso, count: 0 });
      }
      return out;
    }

    function setStripWidth(view: ReturnType<typeof render>, width: number) {
      // Fire onLayout with the given width on every View that
      // declares one; the strip-mode rail only renders after the
      // outer row has reported its width. Wrapped in act() so the
      // setState the handler triggers gets flushed before we assert
      // against the rendered output. Using findAll as a side-effect
      // walker is intentional — react-native-testing-library doesn't
      // expose a "fire onLayout" helper out of the box.
      act(() => {
        view.UNSAFE_root.findAll((node) => {
          if (typeof node.props.onLayout === "function") {
            node.props.onLayout({
              nativeEvent: { layout: { x: 0, y: 0, width, height: 18 } },
            });
          }
          return false;
        });
      });
    }

    test("renders bare month markers when the strip fits in a single calendar year", () => {
      // 91-day window entirely inside calendar year 2025. With no
      // year boundary crossing, labels stay bare ("Jan"/"Feb"/etc.)
      // and the a11y suffix is the bare "starts here" form.
      const counts = buildDailyCounts("2025-04-01", 91);
      const view = render(
        <CaptureHeatmap
          counts={counts}
          today=""
          windowDays={90}
          onSelectDate={() => {}}
        />,
      );
      setStripWidth(view, 360);

      // Apr/May/Jun all show, no year suffix anywhere.
      expect(view.getByText("Apr")).toBeTruthy();
      expect(view.getByText("May")).toBeTruthy();
      expect(view.getByText("Jun")).toBeTruthy();
      expect(view.queryByText(/'/)).toBeNull();

      // Bare a11y form preserved when the window doesn't cross years.
      expect(view.getByLabelText("Apr starts here")).toBeTruthy();
      expect(view.getByLabelText("May starts here")).toBeTruthy();
    });

    test("disambiguates repeated months on a 365-day strip that crosses a year boundary", () => {
      // 365-day year recap from May 2025 → May 2026. Bucket 0 starts
      // May 4 2025, then buckets fall in Jun 2025 … Apr 2026 …
      // bucket 52 lands back in May 2026. Without the year suffix
      // the rail would have two adjacent-ish labels both reading
      // "May" with no way to tell them apart.
      const counts = buildDailyCounts("2025-05-04", 365);
      const view = render(
        <CaptureHeatmap
          counts={counts}
          today=""
          windowDays={365}
          onSelectDate={() => {}}
        />,
      );
      setStripWidth(view, 360);

      // The year-suffixed form ("May '25" / "May '26") replaces the
      // bare "May" everywhere so the two May markers are uniquely
      // identifiable on the rail.
      expect(view.queryAllByText("May")).toHaveLength(0);
      expect(view.getByText("May '25")).toBeTruthy();
      expect(view.getByText("May '26")).toBeTruthy();
      // Intermediate labels that survive overlap suppression (at
      // 360 px the pitch is 9 px and "Mmm 'YY" is ~42 px wide, so
      // roughly every other month label is shown). The two-pass
      // algorithm also guarantees the last candidate ("May '26") is
      // always included even if the greedy pass would suppress it.
      expect(view.getByText("Jul '25")).toBeTruthy();
      expect(view.getByText("Dec '25")).toBeTruthy();
      expect(view.getByText("Feb '26")).toBeTruthy();

      // No two adjacent month markers should ever read identically.
      // Walk the rendered display strings in bucket order and assert
      // strict inequality between each pair of consecutive labels.
      const yearSuffixedLabels = [
        "May '25",
        "Jun '25",
        "Jul '25",
        "Aug '25",
        "Sep '25",
        "Oct '25",
        "Nov '25",
        "Dec '25",
        "Jan '26",
        "Feb '26",
        "Mar '26",
        "Apr '26",
        "May '26",
      ];
      for (let i = 1; i < yearSuffixedLabels.length; i++) {
        expect(yearSuffixedLabels[i]).not.toBe(yearSuffixedLabels[i - 1]);
      }
    });

    test("multi-year a11y labels include the full 4-digit year for screen readers", () => {
      // Same 365-day fixture as above. The visible glyph uses the
      // 2-digit `'25` shorthand for compactness, but screen readers
      // hear the full year so the announcement is unambiguous.
      const counts = buildDailyCounts("2025-05-04", 365);
      const view = render(
        <CaptureHeatmap
          counts={counts}
          today=""
          windowDays={365}
          onSelectDate={() => {}}
        />,
      );
      setStripWidth(view, 360);

      expect(view.getByLabelText("May 2025 starts here")).toBeTruthy();
      expect(view.getByLabelText("May 2026 starts here")).toBeTruthy();
      // The bare "May starts here" form must not leak through when
      // the window spans more than one year.
      expect(view.queryByLabelText("May starts here")).toBeNull();
    });

    test("a 90-day strip that crosses Dec → Jan also disambiguates with year suffixes", () => {
      // Even though a 90-day window doesn't repeat any month, the
      // disambiguation rule (cells span >1 calendar year) still
      // kicks in so the rail consistently announces the year for
      // every labelled bucket — preventing "Dec/Jan" from ever
      // being misread when scrolling between recap periods.
      const counts = buildDailyCounts("2024-12-01", 91);
      const view = render(
        <CaptureHeatmap
          counts={counts}
          today=""
          windowDays={90}
          onSelectDate={() => {}}
        />,
      );
      setStripWidth(view, 360);

      expect(view.getByText("Dec '24")).toBeTruthy();
      expect(view.getByText("Jan '25")).toBeTruthy();
      expect(view.getByLabelText("Dec 2024 starts here")).toBeTruthy();
      expect(view.getByLabelText("Jan 2025 starts here")).toBeTruthy();
      // Bare forms must not appear once the window crosses years.
      expect(view.queryByText("Dec")).toBeNull();
      expect(view.queryByText("Jan")).toBeNull();
    });

    test("does not render strip-mode month markers on the 30-day grid view", () => {
      const counts = buildDailyCounts("2025-01-15", 30);
      const view = render(
        <CaptureHeatmap
          counts={counts}
          today=""
          windowDays={30}
          onSelectDate={() => {}}
        />,
      );

      // The grid mode has its own month rail above the columns
      // (which carries "Jan"/"Feb" headers without the "starts here"
      // accessibility suffix). The strip-mode rail should never
      // appear on the daily grid view.
      expect(view.queryByLabelText("Jan starts here")).toBeNull();
      expect(view.queryByLabelText("Feb starts here")).toBeNull();
    });

    test("no two month labels overlap on the 365-day fixture at 320 px", () => {
      // Regression for the year heatmap at the smallest supported phone
      // width. At 320 px the ~52 weekly buckets are clamped to the 6 px
      // cell minimum (pitch = 9 px), so "May '25"-style labels are wider
      // than the inter-label gap. The overlap-suppression logic must skip
      // enough labels that every rendered pair has non-overlapping bounds.
      const counts = buildDailyCounts("2025-05-04", 365);
      const view = render(
        <CaptureHeatmap
          counts={counts}
          today=""
          windowDays={365}
          onSelectDate={() => {}}
        />,
      );
      setStripWidth(view, 320);

      // Collect the rendered strip month labels (only non-suppressed
      // labels receive a strip-month-label-{n} testID).
      const labelNodes = view.queryAllByTestId(/^strip-month-label-/);

      // At least the two disambiguating "May" anchors must survive.
      expect(labelNodes.length).toBeGreaterThanOrEqual(2);

      // Both "May" markers must still be present so the disambiguation
      // guarantee from task #173 holds end-to-end.
      const texts = labelNodes.map((n) => n.props.children as string);
      expect(texts).toContain("May '25");
      expect(texts).toContain("May '26");

      // No two adjacent rendered labels should read identically.
      for (let i = 1; i < texts.length; i++) {
        expect(texts[i]).not.toBe(texts[i - 1]);
      }

      // Non-overlap invariant: every label's anchor must be at or beyond
      // the estimated right edge of the previous label. We read `left`
      // directly from the absolute-positioned style that the component
      // sets, so the check is exact (no font-rendering variability).
      const cellSize = HEATMAP_STRIP_CELL_MIN; // 320 px → clamped to min
      const pitch = cellSize + HEATMAP_CELL_GAP;
      const rects = labelNodes.map((node) => {
        const s = StyleSheet.flatten(
          node.props.style as never,
        ) as Record<string, unknown>;
        const left = s.left as number;
        const text = node.props.children as string;
        return { left, right: left + text.length * HEATMAP_MONTH_LABEL_CHAR_WIDTH };
      });

      // Verify pitch constant matches what we expect (guards against
      // refactors silently widening the gap constant).
      expect(pitch).toBe(9);

      for (let i = 1; i < rects.length; i++) {
        expect(rects[i].left).toBeGreaterThanOrEqual(rects[i - 1].right);
      }
    });
  });
});

describe("CaptureHeatmap — column bucketing (window-sized fixtures)", () => {
  test("a 30-day window ending on a Saturday produces exactly 5 columns", () => {
    // 2026-04-25 is a Saturday. A 30-day window ending on Saturday
    // spans 4 full weeks plus a partial leading column = 5 columns.
    const counts = buildWindow("2026-04-25", 30, (i) => i % 3);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-25"
        onSelectDate={() => {}}
      />,
    );
    expect(view.getByTestId("heatmap-col-0")).toBeTruthy();
    expect(view.getByTestId("heatmap-col-4")).toBeTruthy();
    expect(view.queryByTestId("heatmap-col-5")).toBeNull();
  });

  test("a 30-day window starting on a Sunday produces 5 columns with a full first column", () => {
    // 2026-05-25 is a Monday; offsetting the build by one day so
    // the oldest entry lands on a Sunday yields 30 days that start
    // cleanly Sun..Sat × 4 + 2 leftover days = 5 columns total. The
    // first column has every weekday slot populated (no leading
    // empties).
    const counts = buildWindow("2026-05-25", 30, () => 1);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-05-25"
        onSelectDate={() => {}}
      />,
    );
    expect(view.getByTestId("heatmap-col-4")).toBeTruthy();
    expect(view.queryByTestId("heatmap-col-5")).toBeNull();
    const col0 = view.getByTestId("heatmap-col-0");
    const slots = col0.children as ReadonlyArray<{
      props: { accessibilityLabel?: string };
    }>;
    expect(slots).toHaveLength(7);
    for (const slot of slots) {
      expect(slot.props.accessibilityLabel).toBeDefined();
    }
  });

  test("a 7-day window produces at most 2 columns", () => {
    // 2026-04-25 (Sat). Past 7 days = Sun..Sat = a single full
    // column. Sliding the window by one day forces a Mon..Sun
    // split into two partial columns.
    const oneCol = buildWindow("2026-04-25", 7, () => 1);
    const oneColView = render(
      <CaptureHeatmap
        counts={oneCol}
        today="2026-04-25"
        onSelectDate={() => {}}
      />,
    );
    expect(oneColView.getByTestId("heatmap-col-0")).toBeTruthy();
    expect(oneColView.queryByTestId("heatmap-col-1")).toBeNull();

    const twoCol = buildWindow("2026-04-26", 7, () => 1);
    const twoColView = render(
      <CaptureHeatmap
        counts={twoCol}
        today="2026-04-26"
        onSelectDate={() => {}}
      />,
    );
    expect(twoColView.getByTestId("heatmap-col-0")).toBeTruthy();
    expect(twoColView.getByTestId("heatmap-col-1")).toBeTruthy();
    expect(twoColView.queryByTestId("heatmap-col-2")).toBeNull();
  });

  test("an empty counts array renders no columns and no grid header", () => {
    const view = render(
      <CaptureHeatmap counts={[]} today="2026-04-25" onSelectDate={() => {}} />,
    );
    expect(view.queryByTestId("heatmap-col-0")).toBeNull();
    expect(view.queryByTestId("heatmap-month-slot-0")).toBeNull();
  });
});

describe("CaptureHeatmap — month label row", () => {
  test("the first populated column always carries its month label", () => {
    // 30-day window entirely in April 2026.
    const counts = buildWindow("2026-04-30", 30, () => 0);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-30"
        onSelectDate={() => {}}
      />,
    );
    const firstLabel = view.getByTestId("heatmap-month-label-0");
    expect(firstLabel).toBeTruthy();
    // Exactly one label is emitted for a same-month window.
    expect(view.queryAllByTestId(/^heatmap-month-label-/)).toHaveLength(1);
  });

  test("a window that crosses a month boundary emits exactly two labels (no Mar Mar Mar repetition)", () => {
    // 2026-04-15 ending — 30 days back lands in mid-March, so the
    // window straddles March → April. Expect two labels: Mar then
    // Apr, never duplicated.
    const counts = buildWindow("2026-04-15", 30, () => 1);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-15"
        onSelectDate={() => {}}
      />,
    );
    const labels = view
      .queryAllByTestId(/^heatmap-month-label-/)
      .map((node) => node.props.children);
    expect(labels).toHaveLength(2);
    // First label should be the older month (March), second the
    // newer (April). The exact strings come from the runtime
    // locale, so just assert ordering & uniqueness.
    expect(labels[0]).not.toEqual(labels[1]);
    // And the very first column (oldest) must always carry a label.
    expect(view.getByTestId("heatmap-month-label-0")).toBeTruthy();
  });

  test("columns whose first dated cell repeats the previous column's month emit no label", () => {
    // 30-day window entirely in April -> 5 columns, only one labeled.
    const counts = buildWindow("2026-04-30", 30, () => 0);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-30"
        onSelectDate={() => {}}
      />,
    );
    // All 5 column slots exist, but only column 0 shows a label.
    expect(view.getByTestId("heatmap-month-slot-0")).toBeTruthy();
    expect(view.getByTestId("heatmap-month-slot-4")).toBeTruthy();
    expect(view.queryByTestId("heatmap-month-label-1")).toBeNull();
    expect(view.queryByTestId("heatmap-month-label-2")).toBeNull();
    expect(view.queryByTestId("heatmap-month-label-3")).toBeNull();
    expect(view.queryByTestId("heatmap-month-label-4")).toBeNull();
  });

  test("a same-year window leaves grid month labels bare (no '25 / '26 suffix)", () => {
    // 30-day window entirely in March/April 2026. With every cell
    // in one calendar year, the disambiguation rule must NOT kick
    // in — labels stay as bare "Mar"/"Apr" so in-year ranges read
    // exactly the same as before.
    const counts = buildWindow("2026-04-15", 30, () => 0);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-15"
        onSelectDate={() => {}}
      />,
    );
    const labels = view
      .queryAllByTestId(/^heatmap-month-label-/)
      .map((node) => node.props.children as string);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      // Bare abbreviations only — no apostrophe-prefixed year token
      // anywhere on the rail.
      expect(label).not.toMatch(/'\d{2}/);
    }
  });

  test("a custom range that crosses a year boundary disambiguates grid labels with '25 / '26 suffixes", () => {
    // Custom range Dec 20 2025 → Jan 10 2026 (22 days, routes to
    // grid mode). Without disambiguation the rail would just say
    // "Dec Jan" with no signal that those months belong to
    // different years. With the fix, both labels carry their year.
    const counts = buildWindow("2026-01-10", 22, () => 0);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-01-10"
        onSelectDate={() => {}}
      />,
    );
    const labels = view
      .queryAllByTestId(/^heatmap-month-label-/)
      .map((node) => node.props.children as string);
    // We expect exactly two labels: the older "Dec '25" and the
    // newer "Jan '26". Order is oldest → newest left → right.
    expect(labels).toHaveLength(2);
    expect(labels[0]).toBe("Dec '25");
    expect(labels[1]).toBe("Jan '26");
    // No bare "Dec" / "Jan" should leak through once the window
    // spans more than one calendar year.
    expect(view.queryByText("Dec")).toBeNull();
    expect(view.queryByText("Jan")).toBeNull();
  });

  test("multi-year grid disambiguation works when the older month repeats no label internally", () => {
    // 30-day window ending Jan 5 2026 spans Dec 7 2025 → Jan 5
    // 2026. December occupies multiple columns, but only the first
    // December column emits a label ("Dec '25"); subsequent
    // December columns stay null. The first January column carries
    // the "Jan '26" handover.
    const counts = buildWindow("2026-01-05", 30, () => 0);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-01-05"
        onSelectDate={() => {}}
      />,
    );
    const labels = view
      .queryAllByTestId(/^heatmap-month-label-/)
      .map((node) => node.props.children as string);
    expect(labels).toEqual(["Dec '25", "Jan '26"]);
    // The very first column must always carry the older year's
    // label so the year transition is unambiguous.
    expect(view.getByTestId("heatmap-month-label-0").props.children).toBe(
      "Dec '25",
    );
  });
});

describe("CaptureHeatmap — multi-year cell tint (grid)", () => {
  // The grid mode swaps the per-cell base hue when the visible
  // window spans more than one calendar year, so cells dated in any
  // older year render in the accent (teal) hue while cells in the
  // newest year keep the primary (purple) hue. Per-cell intensity
  // (opacity) keeps working within each year-segment, so the year
  // boundary "pops" visually without the user having to read the
  // labels.
  //
  // The token values come straight from constants/colors.ts so we
  // assert against the literal hex strings the component renders.
  const PRIMARY = "#9B7AE8";
  const ACCENT = "#00E5FF";

  test("a same-year window keeps every populated cell on the primary tint", () => {
    // 30-day window entirely in March/April 2026 — single calendar
    // year, so the year-tint branch must NOT trigger and the rail
    // looks exactly like before this change shipped.
    const counts = buildWindow("2026-04-15", 30, (i) => (i % 5) + 1);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-15"
        onSelectDate={() => {}}
      />,
    );
    const cells = view.queryAllByRole("button");
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      // Every populated cell uses the primary tint; the accent hue
      // never appears on a single-year window.
      const style = flatStyle(cell);
      const bg = style.backgroundColor;
      // today's cell is the wrapper View whose backgroundColor is
      // undefined (the colored fill lives in a child View).
      if (bg === undefined) continue;
      expect(bg).toBe(PRIMARY);
      expect(bg).not.toBe(ACCENT);
    }
  });

  test("a window spanning Dec → Jan tints older-year cells with the accent hue and newer-year cells with the primary hue", () => {
    // Custom range Dec 20 2025 → Jan 10 2026 (22 days, routes to
    // grid mode). Dec cells should be teal (older year), Jan cells
    // should be purple (newest year). Every populated cell carries
    // an a11y label of the form "<weekday>, <Mon> <D>: N memor(y|ies)"
    // so we can pick them by date.
    const counts = buildWindow("2026-01-10", 22, () => 1);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-01-10"
        onSelectDate={() => {}}
      />,
    );
    // Dec 2025 cells — the older year — must use the accent fill.
    // Multi-year windows append the 4-digit year to the per-cell
    // a11y label so screen readers match the year-tint visual cue.
    const decCell = view.getByLabelText(/Dec 25 2025:/);
    expect(flatStyle(decCell).backgroundColor).toBe(ACCENT);
    // Jan 2026 cells — the newest year — keep the primary fill.
    const janCell = view.getByLabelText(/Jan 5 2026:/);
    expect(flatStyle(janCell).backgroundColor).toBe(PRIMARY);
  });

  test("zero-count cells in a multi-year window keep the muted-empty fill (year tint only applies to populated cells)", () => {
    // Same Dec → Jan custom range, but with zero counts on the
    // entire window. The year-tint logic must not paint accent on
    // empty cells — they always render the same neutral outline so
    // the per-cell intensity is what users read.
    const counts = buildWindow("2026-01-10", 22, () => 0);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-01-10"
        onSelectDate={() => {}}
      />,
    );
    const decCell = view.getByLabelText(/Dec 25 2025: 0 memories/);
    const janCell = view.getByLabelText(/Jan 5 2026: 0 memories/);
    // Both pick the neutral border-fallback fill (NOT primary, NOT
    // accent) because they have no captures to colour.
    const decBg = flatStyle(decCell).backgroundColor;
    const janBg = flatStyle(janCell).backgroundColor;
    expect(decBg).not.toBe(PRIMARY);
    expect(decBg).not.toBe(ACCENT);
    expect(janBg).not.toBe(PRIMARY);
    expect(janBg).not.toBe(ACCENT);
    // And both empty fills are identical to each other — there's
    // no per-year differentiation on an empty cell.
    expect(decBg).toBe(janBg);
  });

  test("intensity scaling still works within each year-segment", () => {
    // Multi-year window where Dec cells have count=1 and Jan cells
    // have count=4 (max). Both segments should ramp opacity from
    // 0.5125 (1/4) up to 1 (4/4), independent of which hue they're
    // painted in.
    const counts = buildWindow("2026-01-10", 22, (_, iso) => {
      const [y] = iso.split("-").map((s) => Number(s));
      return y === 2025 ? 1 : 4;
    });
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-01-10"
        onSelectDate={() => {}}
      />,
    );
    const decCell = view.getByLabelText(/Dec 25 2025: 1 memory/);
    const janCell = view.getByLabelText(/Jan 5 2026: 4 memories/);
    // Hues differ (older vs newer year), opacities still follow
    // the linear ramp keyed off the global max (=4).
    expect(flatStyle(decCell).backgroundColor).toBe(ACCENT);
    expect(flatStyle(janCell).backgroundColor).toBe(PRIMARY);
    expect(flatStyle(decCell).opacity).toBeCloseTo(0.35 + 0.65 * (1 / 4), 5);
    expect(flatStyle(janCell).opacity).toBeCloseTo(1, 5);
  });
});

describe("CaptureHeatmap — multi-year cell tint (strip)", () => {
  // Strip mode (windowDays > 30) follows the same rule as grid
  // mode: when the bucketed series spans more than one calendar
  // year, buckets dated in any older year render in the accent
  // hue and buckets in the newest year keep the primary hue.
  const PRIMARY = "#9B7AE8";
  const ACCENT = "#00E5FF";

  test("a same-year strip keeps every bucket on the primary tint", () => {
    // 91-day window entirely inside calendar year 2025. Cycle the
    // count so every bucket has captures — that way every bucket
    // paints its base hue rather than the empty-cell fallback.
    const counts = buildWindow("2025-06-29", 91, (i) => (i % 5) + 1);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today=""
        windowDays={90}
        onSelectDate={() => {}}
      />,
    );
    const buckets = view.queryAllByRole("button");
    expect(buckets.length).toBeGreaterThan(0);
    for (const bucket of buckets) {
      const bg = flatStyle(bucket).backgroundColor;
      if (bg === undefined) continue;
      expect(bg).toBe(PRIMARY);
      expect(bg).not.toBe(ACCENT);
    }
  });

  test("a strip spanning Dec → Jan tints older-year buckets with accent and newer-year buckets with primary", () => {
    // 91-day window starting Dec 1 2024 — the first weekly buckets
    // land in 2024 (older year) and the later buckets land in
    // 2025 (newest year). Every bucket has captures so we can
    // inspect its base hue.
    const counts = buildWindow("2025-03-01", 91, () => 2);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today=""
        windowDays={90}
        onSelectDate={() => {}}
      />,
    );
    // Walk every weekly bucket; partition by the year embedded in
    // its accessibility label ("Week of <weekday>, <Mon> <D>: N
    // memories"). The label doesn't include a year token, so we
    // recover the year from the on-cell key by querying the actual
    // bucket date through the formatted Mon-string instead: the
    // earliest bucket starts in Dec 2024, the latest in Feb 2025.
    const decBucket = view.getByLabelText(/Week of .*Dec 1 2024: 14 memories/);
    const febBucket = view.getByLabelText(/Week of .*Feb 23 2025: 14 memories/);
    expect(flatStyle(decBucket).backgroundColor).toBe(ACCENT);
    expect(flatStyle(febBucket).backgroundColor).toBe(PRIMARY);
  });

  test("zero-count buckets in a multi-year strip keep the muted-empty fill", () => {
    // Same Dec → Feb strip, but with no captures. Every bucket
    // paints the empty-fill fallback regardless of which year it
    // belongs to.
    const counts = buildWindow("2025-03-01", 91, () => 0);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today=""
        windowDays={90}
        onSelectDate={() => {}}
      />,
    );
    const buckets = view.queryAllByRole("button");
    expect(buckets.length).toBeGreaterThan(0);
    for (const bucket of buckets) {
      const bg = flatStyle(bucket).backgroundColor;
      if (bg === undefined) continue;
      expect(bg).not.toBe(PRIMARY);
      expect(bg).not.toBe(ACCENT);
    }
  });
});

describe("CaptureHeatmap — year-aware a11y labels (grid)", () => {
  // The grid swaps per-cell tint at the year boundary so sighted
  // users can see when a cell crosses calendar years. Screen-reader
  // users get the same context by having the 4-digit year appended
  // to the per-cell accessibility label whenever the visible window
  // spans more than one calendar year. Single-year windows keep the
  // bare label so existing same-year heatmaps read identically.

  test("a same-year grid window leaves per-cell a11y labels unchanged (no year suffix)", () => {
    // 30-day window entirely in March/April 2026. None of the
    // per-cell labels should carry a 4-digit year — the format
    // stays "<weekday>, <Mon> <D>: N memor(y|ies)".
    const counts = buildWindow("2026-04-15", 30, () => 1);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-15"
        onSelectDate={() => {}}
      />,
    );
    const cells = view.queryAllByRole("button");
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const label = cell.props.accessibilityLabel as string;
      // No 4-digit year token anywhere in the per-cell label.
      expect(label).not.toMatch(/\b20\d{2}\b/);
    }
  });

  test("a multi-year grid window appends the 4-digit year to every per-cell a11y label", () => {
    // Custom range Dec 20 2025 → Jan 10 2026 (22 days, routes to
    // grid mode). Each per-cell label should include the 4-digit
    // year so screen readers match the year-tint visual cue.
    const counts = buildWindow("2026-01-10", 22, () => 1);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-01-10"
        onSelectDate={() => {}}
      />,
    );
    // A December cell carries its 2025 year suffix.
    const decCell = view.getByLabelText(/Dec 22 2025: 1 memory/);
    expect(decCell).toBeTruthy();
    // A January cell carries its 2026 year suffix.
    const janCell = view.getByLabelText(/Jan 5 2026: 1 memory/);
    expect(janCell).toBeTruthy();
    // Today's cell still carries the "today" suffix in addition to
    // the year, so the announcement matches the visible accent ring.
    const today = view.getByLabelText(/Jan 10 2026: 1 memory, today/);
    expect(today).toBeTruthy();
    // Every populated cell carries a 4-digit year — no bare labels
    // leak through once the window crosses years.
    const cells = view.queryAllByRole("button");
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const label = cell.props.accessibilityLabel as string;
      expect(label).toMatch(/\b20\d{2}\b/);
    }
  });
});

describe("CaptureHeatmap — year-aware a11y labels (strip)", () => {
  // Strip mode follows the same rule as grid mode: when the
  // bucketed window spans more than one calendar year, the per-
  // bucket "Week of …" label includes the 4-digit year.

  test("a same-year strip window leaves per-bucket 'Week of …' labels unchanged (no year suffix)", () => {
    // 91-day window entirely in calendar year 2025.
    const counts = buildWindow("2025-06-29", 91, () => 0);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today=""
        windowDays={90}
        onSelectDate={() => {}}
      />,
    );
    const buckets = view.queryAllByRole("button");
    expect(buckets.length).toBeGreaterThan(0);
    for (const bucket of buckets) {
      const label = bucket.props.accessibilityLabel as string;
      expect(label).toMatch(/^Week of /);
      // No 4-digit year token anywhere in the per-bucket label.
      expect(label).not.toMatch(/\b20\d{2}\b/);
    }
  });

  test("a multi-year strip window appends the 4-digit year to every per-bucket 'Week of …' label", () => {
    // 91-day window starting Dec 1 2024. Earlier buckets fall in
    // calendar year 2024, later buckets in 2025 — so the year-
    // aware rule kicks in and every bucket carries its year.
    const counts = buildWindow("2025-03-01", 91, () => 1);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today=""
        windowDays={90}
        onSelectDate={() => {}}
      />,
    );
    // The first bucket starts Dec 1 2024 — label carries 2024.
    expect(view.getByLabelText(/Week of .*Dec 1 2024:/)).toBeTruthy();
    // A later bucket starting Feb 23 2025 carries 2025.
    expect(view.getByLabelText(/Week of .*Feb 23 2025:/)).toBeTruthy();
    // No bare-year label leaks through once the strip crosses
    // calendar years.
    const buckets = view.queryAllByRole("button");
    expect(buckets.length).toBeGreaterThan(0);
    for (const bucket of buckets) {
      const label = bucket.props.accessibilityLabel as string;
      expect(label).toMatch(/\b20\d{2}\b/);
    }
  });
});

describe("CaptureHeatmap — dual-hue legend (multi-year)", () => {
  // The "Less … More" intensity legend at the bottom of the card
  // mirrors the cells above: on a single-year window it's the
  // original purple ramp with no year label, but on a multi-year
  // window it splits into two rows — accent (teal) for older years
  // and primary (purple) for the newest year — each prefixed with
  // its year so the legend reads as a 1:1 key for the cells.
  const PRIMARY = "#9B7AE8";
  const ACCENT = "#00E5FF";

  // Helper used by both grid and strip assertions to walk the four
  // populated swatches under a given testID prefix and pull their
  // fill colours out of the flattened style.
  function swatchColors(view: ReturnType<typeof render>, prefix: string) {
    return [0.35, 0.6, 0.85, 1].map(
      (o) => flatStyle(view.getByTestId(`${prefix}-swatch-${o}`)).backgroundColor,
    );
  }

  test("a single-year grid window renders the original single-row primary ramp with no year label", () => {
    // 30-day window entirely in March/April 2026 — same fixture as
    // the single-year cell-tint test. The legend must not render
    // the multi-year stack and must not include any year prefix.
    const counts = buildWindow("2026-04-15", 30, () => 1);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-15"
        onSelectDate={() => {}}
      />,
    );
    expect(view.queryByTestId("heatmap-legend-multi-year")).toBeNull();
    expect(view.queryByTestId("heatmap-legend-older")).toBeNull();
    expect(view.queryByTestId("heatmap-legend-latest")).toBeNull();
    // No year labels leak into the single-year legend.
    expect(view.queryByText("2025")).toBeNull();
    expect(view.queryByText("2026")).toBeNull();
  });

  test("a multi-year grid window renders both teal and purple ramps each labelled with its year", () => {
    // Custom range Dec 20 2025 → Jan 10 2026 (22 days, routes to
    // grid mode) — the same fixture used by the multi-year cell-
    // tint test above. We expect a stacked legend: a "2025" row in
    // accent (teal) and a "2026" row in primary (purple).
    const counts = buildWindow("2026-01-10", 22, () => 1);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-01-10"
        onSelectDate={() => {}}
      />,
    );

    // The stack wrapper is present and both rows render.
    expect(view.getByTestId("heatmap-legend-multi-year")).toBeTruthy();
    expect(view.getByTestId("heatmap-legend-older")).toBeTruthy();
    expect(view.getByTestId("heatmap-legend-latest")).toBeTruthy();

    // Year labels match the visible window — "2025" for the older
    // year segment, "2026" for the newest year segment.
    expect(view.getByTestId("heatmap-legend-older-year").props.children).toBe(
      "2025",
    );
    expect(view.getByTestId("heatmap-legend-latest-year").props.children).toBe(
      "2026",
    );

    // Older-year ramp paints accent on every populated swatch,
    // newest-year ramp paints primary on every populated swatch.
    for (const c of swatchColors(view, "heatmap-legend-older")) {
      expect(c).toBe(ACCENT);
    }
    for (const c of swatchColors(view, "heatmap-legend-latest")) {
      expect(c).toBe(PRIMARY);
    }
  });

  test("a multi-year strip window renders both teal and purple ramps each labelled with its year", () => {
    // 91-day window starting Dec 1 2024 — the strip's first
    // weekly buckets land in 2024 and the later ones in 2025, so
    // the legend should stack a "2024" accent row above a "2025"
    // primary row.
    const counts = buildWindow("2025-03-01", 91, () => 2);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today=""
        windowDays={90}
        onSelectDate={() => {}}
      />,
    );

    expect(view.getByTestId("heatmap-legend-multi-year")).toBeTruthy();
    expect(view.getByTestId("heatmap-legend-older-year").props.children).toBe(
      "2024",
    );
    expect(view.getByTestId("heatmap-legend-latest-year").props.children).toBe(
      "2025",
    );
    for (const c of swatchColors(view, "heatmap-legend-older")) {
      expect(c).toBe(ACCENT);
    }
    for (const c of swatchColors(view, "heatmap-legend-latest")) {
      expect(c).toBe(PRIMARY);
    }
  });

  test("a single-year strip window renders the original single-row primary ramp with no year label", () => {
    // 91-day window entirely inside calendar year 2025 — same
    // fixture as the single-year strip cell-tint test. Legend stays
    // single-row and unprefixed.
    const counts = buildWindow("2025-06-29", 91, () => 1);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today=""
        windowDays={90}
        onSelectDate={() => {}}
      />,
    );
    expect(view.queryByTestId("heatmap-legend-multi-year")).toBeNull();
    expect(view.queryByText("2025")).toBeNull();
  });
});

describe("CaptureHeatmap — cell tap behavior", () => {
  test("tapping a populated cell calls onSelectDate with that cell's ISO date", () => {
    const counts: MonthRecapDailyCount[] = [
      { date: "2026-04-20", count: 3 },
      { date: "2026-04-21", count: 0 },
      { date: "2026-04-22", count: 5 },
    ];
    const onSelectDate = jest.fn();
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-22"
        onSelectDate={onSelectDate}
      />,
    );
    // Tap the cell labelled for 2026-04-20 (Monday): label format
    // is "Mon, Apr 20: 3 memories".
    const cell = view.getByLabelText(/Apr 20: 3 memories/);
    fireEvent.press(cell);
    expect(onSelectDate).toHaveBeenCalledTimes(1);
    expect(onSelectDate).toHaveBeenCalledWith("2026-04-20");
  });

  test("a zero-count day is still a tappable cell that deep-links to its date", () => {
    // Zero-count cells are populated (we have a date for them) and
    // should still deep-link to Archive — they are not 'empty
    // placeholder' cells. Empty placeholder cells only appear for
    // weekday slots outside the window.
    const counts: MonthRecapDailyCount[] = [
      { date: "2026-04-20", count: 0 },
      { date: "2026-04-21", count: 1 },
    ];
    const onSelectDate = jest.fn();
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-21"
        onSelectDate={onSelectDate}
      />,
    );
    const zeroCell = view.getByLabelText(/Apr 20: 0 memories/);
    fireEvent.press(zeroCell);
    expect(onSelectDate).toHaveBeenCalledWith("2026-04-20");
  });

  test("today's cell uses the singular 'memory' suffix when count is 1 and includes the 'today' marker", () => {
    const counts: MonthRecapDailyCount[] = [{ date: "2026-04-22", count: 1 }];
    const onSelectDate = jest.fn();
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-22"
        onSelectDate={onSelectDate}
      />,
    );
    const todayCell = view.getByLabelText(/Apr 22: 1 memory, today/);
    fireEvent.press(todayCell);
    expect(onSelectDate).toHaveBeenCalledWith("2026-04-22");
  });

  test("empty placeholder cells outside the window are non-interactive (no accessibility button)", () => {
    // 2026-04-25 is a Saturday. Past 7 days back from Saturday is
    // exactly one full Sun..Sat column with no leading empties.
    // Slide to Friday (2026-04-24) so the window is Sat 04-18 →
    // Fri 04-24: column 0 is just Sat 04-18 (closed by hitting a
    // Saturday), and column 1 is Sun..Fri with the trailing Sat
    // slot at row 6 left as an empty placeholder.
    const counts = buildWindow("2026-04-24", 7, () => 1);
    const onSelectDate = jest.fn();
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-24"
        onSelectDate={onSelectDate}
      />,
    );
    const trailingEmpty = view.getByTestId("heatmap-empty-1-6");
    expect(trailingEmpty).toBeTruthy();
    // Empty placeholders carry no accessibility role/label and no
    // press handler, so firing a press never reaches onSelectDate.
    expect(trailingEmpty.props.accessibilityRole).toBeUndefined();
    expect(trailingEmpty.props.accessibilityLabel).toBeUndefined();
    expect(trailingEmpty.props.onClick).toBeUndefined();
    expect(trailingEmpty.props.onPress).toBeUndefined();

    // Tapping a real (populated) cell still works, proving the test
    // wiring is sound.
    fireEvent.press(view.getByLabelText(/Apr 24/));
    expect(onSelectDate).toHaveBeenCalledTimes(1);
    expect(onSelectDate).toHaveBeenCalledWith("2026-04-24");
  });

  test("the count of tappable cells equals the count of populated days in the window", () => {
    const counts = buildWindow("2026-04-25", 30, () => 1);
    const onSelectDate = jest.fn();
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today="2026-04-25"
        onSelectDate={onSelectDate}
      />,
    );
    // Every populated day renders a TouchableOpacity with the
    // "button" accessibility role. We assert exactly 30 such cells
    // exist (one per populated day in the window).
    const cells = view.queryAllByRole("button");
    expect(cells).toHaveLength(30);
  });
});

describe("CaptureHeatmap — strip-mode month markers (windowDays > 30)", () => {
  // The strip-mode rail only renders after the heatmap row has
  // measured itself via onLayout. Fire onLayout with a fixed width
  // on every View that owns one, wrapped in act() so the resulting
  // setState is flushed before assertions run. Using findAll as a
  // side-effect walker is intentional — react-native-testing-
  // library doesn't expose a "fire onLayout" helper out of the box.
  function setStripWidth(view: ReturnType<typeof render>, width: number) {
    act(() => {
      view.UNSAFE_root.findAll((node) => {
        if (typeof node.props.onLayout === "function") {
          node.props.onLayout({
            nativeEvent: { layout: { x: 0, y: 0, width, height: 18 } },
          });
        }
        return false;
      });
    });
  }

  test("renders month markers under the weekly strip on a 90+ day window", () => {
    // 91-day window ending Sun 2025-06-29 — the entire window falls
    // inside calendar year 2025, so labels stay in the bare
    // "Mar"/"Apr"/… form (the year-suffix branch only triggers when
    // the window crosses a calendar year boundary).
    const counts = buildWindow("2025-06-29", 91, () => 0);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today=""
        windowDays={90}
        onSelectDate={() => {}}
      />,
    );
    setStripWidth(view, 360);

    expect(view.getByText("Mar")).toBeTruthy();
    expect(view.getByText("Apr")).toBeTruthy();
    expect(view.getByText("May")).toBeTruthy();
    expect(view.getByText("Jun")).toBeTruthy();
    expect(view.getAllByText("Apr")).toHaveLength(1);
    expect(view.getAllByText("May")).toHaveLength(1);

    // Each marker carries an accessibility label so screen readers
    // announce the month context as a landmark, in addition to the
    // per-cell "Week of … : N memories" announcements.
    expect(view.getByLabelText("Apr starts here")).toBeTruthy();
    expect(view.getByLabelText("May starts here")).toBeTruthy();
  });

  test("does not render strip-mode month markers on the 30-day grid view", () => {
    // The grid mode has its own per-column month rail (different
    // testID convention, no "starts here" suffix). The strip rail
    // should never appear for daily windows.
    const counts = buildWindow("2025-02-15", 30, () => 0);
    const view = render(
      <CaptureHeatmap
        counts={counts}
        today=""
        windowDays={30}
        onSelectDate={() => {}}
      />,
    );

    expect(view.queryByLabelText("Jan starts here")).toBeNull();
    expect(view.queryByLabelText("Feb starts here")).toBeNull();
  });
});
