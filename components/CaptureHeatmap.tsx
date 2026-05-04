import React, { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";

import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import {
  SPARKLINE_BUCKET_DAYS,
  type MonthRecapDailyCount,
} from "@/lib/recapMonth";

export interface CaptureHeatmapProps {
  counts: MonthRecapDailyCount[];
  /** YYYY-MM-DD local date used to render today's accent ring on
   *  the GitHub-style grid (only relevant for short windows). */
  today: string;
  /** Window length in days. Used to decide whether to plot the
   *  GitHub-style 7-row × N-column calendar grid (≤ HEATMAP_DAILY_MAX)
   *  or to bucket into a single-row weekly strip for longer windows
   *  so the row stays single-line and legible. Defaults to the
   *  length of `counts`, so callers and tests that don't care about
   *  the dispatcher routing keep the grid render. */
  windowDays?: number;
  onSelectDate: (date: string) => void;
}

/**
 * Calendar-style capture heatmap. Has two render modes that share
 * the same intensity scale, legend, and tap-to-deep-link behaviour:
 *
 * - **Grid mode** (windowDays ≤ HEATMAP_DAILY_MAX): GitHub-style
 *   7-row × N-column grid for Today / Past 7 days / Past 30 days.
 *   Each column is a calendar week (oldest → newest, left → right),
 *   each row is a fixed weekday (Sun at the top, Sat at the bottom).
 *   Cells outside the window stay empty placeholders. A weekday
 *   label rail and per-column month abbreviations turn weekly
 *   rhythms ("nothing on weekends") into an at-a-glance read, and
 *   today's cell gets an accent ring.
 *
 * - **Strip mode** (windowDays > HEATMAP_DAILY_MAX): single-row
 *   strip of weekly buckets for Past 90 days / Past 365 days. The
 *   GitHub grid would either need 13–52 columns of 6 px cells or
 *   spill onto multiple visual blocks, so we bucket via
 *   `SPARKLINE_BUCKET_DAYS` and render ~13 cells (quarter) or ~52
 *   cells (year) instead. Tapping a bucket deep-links Archive to
 *   the bucket's first day.
 *
 * Intensity scaling is linear in `count / max`, mapped into the
 * 0.35..1 opacity range so a single-capture cell is still clearly
 * darker than an empty cell — even a quiet user with `max=2` gets
 * useful visual differentiation. Empty cells render as a faint
 * outline using the border color rather than a hole.
 */
export const HEATMAP_CELL_GAP = 3;
export const HEATMAP_CELL_MAX = 18;
/** Floor for the GitHub-style grid (short windows). 10 px keeps
 *  weekday labels and the today ring legible. */
export const HEATMAP_GRID_CELL_MIN = 10;
/** Floor for the bucketed strip (long windows). 6 px is the
 *  minimum tappable area; the year view's ~52 cells need this to
 *  fit on a phone-width row. */
export const HEATMAP_STRIP_CELL_MIN = 6;
export const HEATMAP_LABEL_RAIL_WIDTH = 14;
export const HEATMAP_LABEL_RAIL_GAP = 6;
/** Approximate rendered width per character (px) at the 10 px / 500-Medium
 *  font used by the strip-mode month rail. Used to estimate each label's
 *  right edge so the overlap-suppression logic can skip labels that would
 *  collide with the previous rendered one. Conservative at 6 px/char so
 *  tight year-view cells (pitch ≈ 9 px) never render two overlapping 7-char
 *  labels while looser 90-day cells (pitch ≈ 21 px) still show every label
 *  that genuinely fits. */
export const HEATMAP_MONTH_LABEL_CHAR_WIDTH = 6;
// Sunday-first to match common US/iOS calendar convention. Every
// row is labelled so weekly rhythms are unambiguous at a glance —
// the duplicate S/T/T/S follows the standard single-letter calendar
// header convention used in iOS Calendar and most date pickers.
export const HEATMAP_WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
/** Above this window length we switch from the GitHub-style grid
 *  to the bucketed weekly strip. Matches the daily views (Today,
 *  Past 7, Past 30) one-cell-per-day grid behaviour. */
export const HEATMAP_DAILY_MAX = 30;

/**
 * Determine which strip-mode month label bucket indices to render so that
 * no two consecutive rendered labels visually overlap.
 *
 * **Forward greedy pass** (left → right): a label is included only if its
 * anchor `left = idx × pitch` falls at or after the estimated right edge of
 * the previously included label (`prev.left + prev.display.length × CHAR_WIDTH`).
 * This ensures every included pair satisfies the non-overlap invariant.
 *
 * **Post-process — last-candidate guarantee**: the rightmost candidate is
 * always included so the rail is anchored at both ends. This matters for the
 * 365-day year view where the final "May '26" label (which provides the
 * disambiguation anchor for a repeated month) can otherwise be suppressed by
 * the "Apr '26" label just before it. If the last candidate was not already
 * selected, we pop the last selected label (it necessarily overlaps) and
 * append the last candidate; the non-overlap invariant with the label before
 * the popped one is guaranteed because the greedy pass already accepted that
 * label.
 */
function selectStripMonthLabelIndices(
  labels: ReadonlyArray<{ display: string; a11y: string } | null>,
  pitch: number,
): Set<number> {
  const candidates: { idx: number; display: string }[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== null) candidates.push({ idx: i, display: labels[i]!.display });
  }
  if (candidates.length === 0) return new Set();

  const selected: { idx: number; display: string }[] = [];
  let lastRight = -Infinity;
  for (const c of candidates) {
    const left = c.idx * pitch;
    if (left >= lastRight) {
      selected.push(c);
      lastRight = left + c.display.length * HEATMAP_MONTH_LABEL_CHAR_WIDTH;
    }
  }

  // Ensure the last candidate is always included.
  const lastCandidate = candidates[candidates.length - 1];
  if (selected[selected.length - 1].idx !== lastCandidate.idx) {
    const lastLeft = lastCandidate.idx * pitch;
    while (
      selected.length > 0 &&
      lastLeft <
        selected[selected.length - 1].idx * pitch +
          selected[selected.length - 1].display.length * HEATMAP_MONTH_LABEL_CHAR_WIDTH
    ) {
      selected.pop();
    }
    selected.push(lastCandidate);
  }

  return new Set(selected.map((s) => s.idx));
}

function bucketHeatmapCounts(
  counts: ReadonlyArray<MonthRecapDailyCount>,
  bucketDays: number,
): MonthRecapDailyCount[] {
  if (bucketDays <= 1 || counts.length <= bucketDays) {
    return counts.slice();
  }
  const out: MonthRecapDailyCount[] = [];
  for (let i = 0; i < counts.length; i += bucketDays) {
    const slice = counts.slice(i, i + bucketDays);
    if (slice.length === 0) continue;
    const total = slice.reduce((n, c) => n + c.count, 0);
    out.push({ date: slice[0].date, count: total });
  }
  return out;
}

/**
 * Map a count to an opacity in [0, 1]. 0 stays at 0 (cell is the
 * muted "empty" color), then we scale into 0.35..1 so even a
 * single-capture day is visibly darker than an empty one.
 */
function heatmapOpacityFor(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  return 0.35 + 0.65 * ratio;
}

/**
 * Pick the base fill colour for a populated cell. When the visible
 * window spans more than one calendar year, cells dated in any year
 * older than the newest visible year render in the accent (teal)
 * hue, while cells in the newest year keep the primary (purple)
 * hue. Same-year windows always use the primary hue, so single-year
 * heatmaps are visually unchanged. Per-cell intensity scaling
 * (opacity) is applied on top of whichever base colour we pick, so
 * the per-year intensity ramp keeps working within each segment.
 */
function yearTintBaseColor(
  iso: string,
  multiYear: boolean,
  latestYear: number,
  primary: string,
  accent: string,
): string {
  if (!multiYear) return primary;
  const [y] = iso.split("-").map((s) => Number(s));
  return y < latestYear ? accent : primary;
}

/**
 * Build the visible label for the older-year ramp on a multi-year
 * legend. With exactly one older year (the typical Dec → Jan case)
 * the label is just that year ("2025"). When the visible window
 * spans three or more calendar years, every year older than the
 * newest collapses into a single accent-tinted row, so we render a
 * range like "2023–2025" so the legend still maps 1:1 to what the
 * cells above it are doing.
 */
function olderYearRampLabel(oldestYear: number, latestYear: number): string {
  const olderEnd = latestYear - 1;
  if (oldestYear >= olderEnd) return String(olderEnd);
  return `${oldestYear}–${olderEnd}`;
}

/**
 * Single intensity ramp: an optional year prefix, "Less", an empty-
 * cell swatch, four populated swatches at the same opacity stops the
 * cells above use, and "More". `color` is the base hue painted into
 * the four populated swatches — accent for older-year rows, primary
 * otherwise — so the legend visually matches the cells above it.
 */
function HeatmapLegendRamp({
  year,
  color,
  testID,
}: {
  year?: string;
  color: string;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.heatmapLegend} testID={testID}>
      {year !== undefined && (
        <Text
          style={[
            styles.heatmapLegendYearLabel,
            { color: colors.mutedForeground },
          ]}
          testID={testID ? `${testID}-year` : undefined}
        >
          {year}
        </Text>
      )}
      <Text
        style={[styles.heatmapLegendText, { color: colors.mutedForeground }]}
      >
        Less
      </Text>
      <View
        style={[
          styles.heatmapLegendCell,
          { backgroundColor: colors.border + "55" },
        ]}
      />
      {[0.35, 0.6, 0.85, 1].map((o) => (
        <View
          key={o}
          testID={testID ? `${testID}-swatch-${o}` : undefined}
          style={[
            styles.heatmapLegendCell,
            { backgroundColor: color, opacity: o },
          ]}
        />
      ))}
      <Text
        style={[styles.heatmapLegendText, { color: colors.mutedForeground }]}
      >
        More
      </Text>
    </View>
  );
}

/**
 * Shared legend ("Less … More") used by both render modes so they
 * read the same regardless of cell density.
 *
 * On a single-year window we render the original single-row purple
 * ramp (no year label) so nothing changes for the daily / past-7 /
 * past-30 views or any in-year custom range.
 *
 * On a multi-year window the cells above split into two hues
 * (accent/teal for older years, primary/purple for the newest year),
 * so we stack two ramps — one per hue — each prefixed with its year
 * label so the legend reads as a 1:1 key for the cells. The accent
 * row sits on top to match the chronological top-to-bottom reading
 * order of the year transition (older year above newer year).
 */
function HeatmapLegend({
  multiYear = false,
  oldestYear,
  latestYear,
}: {
  multiYear?: boolean;
  oldestYear?: number;
  latestYear?: number;
} = {}) {
  const colors = useColors();
  if (
    !multiYear ||
    oldestYear === undefined ||
    latestYear === undefined ||
    oldestYear >= latestYear
  ) {
    return <HeatmapLegendRamp color={colors.primary} />;
  }
  return (
    <View style={styles.heatmapLegendStack} testID="heatmap-legend-multi-year">
      <HeatmapLegendRamp
        year={olderYearRampLabel(oldestYear, latestYear)}
        color={colors.accent}
        testID="heatmap-legend-older"
      />
      <HeatmapLegendRamp
        year={String(latestYear)}
        color={colors.primary}
        testID="heatmap-legend-latest"
      />
    </View>
  );
}

export function CaptureHeatmap(props: CaptureHeatmapProps) {
  const dispatchWindow = props.windowDays ?? props.counts.length;
  if (dispatchWindow > HEATMAP_DAILY_MAX) {
    return <CaptureHeatmapStrip {...props} />;
  }
  return <CaptureHeatmapGrid {...props} />;
}

/**
 * GitHub-style 7-row × N-column grid render for Today / Past 7 /
 * Past 30 day windows. See CaptureHeatmap doc comment for
 * background.
 */
function CaptureHeatmapGrid({
  counts,
  today,
  onSelectDate,
}: CaptureHeatmapProps) {
  const colors = useColors();
  const [rowWidth, setRowWidth] = useState(0);
  const max = counts.reduce((m, c) => (c.count > m ? c.count : m), 0);

  // Bucket the oldest-first daily counts into calendar-week
  // columns. Each column is a length-7 array indexed by getDay()
  // (0 = Sun … 6 = Sat); slots outside the window stay null. We
  // close a column whenever we see a Saturday or hit the last
  // entry, so the first and last columns may be partial.
  const columns = useMemo(() => {
    const cols: (MonthRecapDailyCount | null)[][] = [];
    if (counts.length === 0) return cols;
    let current: (MonthRecapDailyCount | null)[] = Array(7).fill(null);
    counts.forEach((cell, i) => {
      const [y, m, d] = cell.date.split("-").map((s) => Number(s));
      const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
      const dow = dt.getDay();
      current[dow] = cell;
      if (dow === 6 || i === counts.length - 1) {
        cols.push(current);
        current = Array(7).fill(null);
      }
    });
    return cols;
  }, [counts]);

  // Set of distinct calendar years in the window and the newest one.
  // Reused by both the month-label disambiguator and the per-cell
  // year-tint logic so cells from any older year render in the
  // accent hue while cells in the newest year stay on the primary
  // hue — letting the year boundary "pop" without having to read
  // the labels.
  const yearStats = useMemo(() => {
    const years = new Set<number>();
    for (const col of columns) {
      for (const cell of col) {
        if (cell === null) continue;
        const [y] = cell.date.split("-").map((s) => Number(s));
        years.add(y);
      }
    }
    let latestYear = 0;
    let oldestYear = Number.POSITIVE_INFINITY;
    for (const y of years) {
      if (y > latestYear) latestYear = y;
      if (y < oldestYear) oldestYear = y;
    }
    return { multiYear: years.size > 1, latestYear, oldestYear };
  }, [columns]);

  // Per-column month abbreviation. We label a column only when its
  // first non-null cell falls in a different calendar month than the
  // previous labelled column — so a 30-day window that spans
  // March → April shows "Mar" once and "Apr" once, never "Mar Mar
  // Mar". Columns whose first dated cell is in the same month as
  // the previous column return null and render an empty slot, which
  // keeps the header row aligned 1:1 with the grid columns below.
  //
  // When the visible window crosses a calendar-year boundary (e.g.
  // a custom range Dec 20 → Jan 10 routed to grid mode), bare
  // abbreviations would be ambiguous: the year context disappears
  // entirely on a label like "Dec Jan". We append a 2-digit year
  // suffix ("Dec '25" / "Jan '26") to every labelled column in that
  // case so the year transition is always obvious. Mirrors the
  // strip-mode disambiguation rule for consistency between the two
  // render modes.
  const columnMonthLabels = useMemo(() => {
    const { multiYear } = yearStats;
    let prevMonthKey: string | null = null;
    return columns.map((col) => {
      const firstCell = col.find(
        (c): c is MonthRecapDailyCount => c !== null,
      );
      if (!firstCell) return null;
      const [y, m] = firstCell.date.split("-").map((s) => Number(s));
      const monthIndex = (m ?? 1) - 1;
      const key = `${y}-${monthIndex}`;
      if (key === prevMonthKey) return null;
      prevMonthKey = key;
      const dt = new Date(y, monthIndex, 1);
      const monthShort = dt.toLocaleDateString([], { month: "short" });
      if (!multiYear) return monthShort;
      return `${monthShort} '${String(y).slice(-2)}`;
    });
  }, [columns, yearStats]);

  // Compute a square cell size from the available width so the
  // grid never wraps onto a second visual block. The label rail
  // takes a fixed slice; the rest is split across the week
  // columns. We floor to a sane minimum so cells stay tappable and
  // cap at 18 so wider tablets don't blow the grid out.
  const cellSize = (() => {
    if (rowWidth <= 0 || columns.length === 0) return HEATMAP_CELL_MAX;
    const available =
      rowWidth - HEATMAP_LABEL_RAIL_WIDTH - HEATMAP_LABEL_RAIL_GAP;
    const totalGap = HEATMAP_CELL_GAP * (columns.length - 1);
    const raw = (available - totalGap) / columns.length;
    return Math.max(
      HEATMAP_GRID_CELL_MIN,
      Math.min(HEATMAP_CELL_MAX, Math.floor(raw)),
    );
  })();

  const formatLabel = (iso: string, count: number): string => {
    // iso is YYYY-MM-DD local. Build a Date in local time so
    // toLocaleDateString gives the correct day-of-month and
    // weekday. Including the weekday up front means the screen
    // reader announces the same calendar context the visible rail
    // gives sighted users. When the cell is today, append "today"
    // so screen readers match the visible accent ring.
    //
    // When the visible window spans more than one calendar year,
    // append the 4-digit year to the date portion so screen-reader
    // users get the same year context the year-tint hue gives
    // sighted users. Same-year windows keep the bare label so
    // single-year heatmaps read exactly the same as before.
    const [y, m, d] = iso.split("-").map((s) => Number(s));
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    const label = dt.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const datePart = yearStats.multiYear ? `${label} ${y}` : label;
    const noun = count === 1 ? "memory" : "memories";
    const todaySuffix = iso === today ? ", today" : "";
    return `${datePart}: ${count} ${noun}${todaySuffix}`;
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          marginBottom: 12,
        },
      ]}
    >
      <Text style={[styles.sectionLabel, { color: colors.primary }]}>
        CAPTURE ACTIVITY
      </Text>
      {/* Month header row. Sits directly above the grid so each
          label lines up with the column where its month begins. We
          offset by the weekday rail's width + gap so column 0's
          label sits exactly above column 0's cells. The label
          containers share the same width and gap rules as the
          columns below; labels themselves are allowed to overflow
          their slot horizontally so a 3-letter abbreviation stays
          legible even when the cells are at their minimum size. */}
      {columns.length > 0 && (
        <View style={styles.heatmapMonthRail}>
          <View
            style={{
              width: HEATMAP_LABEL_RAIL_WIDTH + HEATMAP_LABEL_RAIL_GAP,
            }}
          />
          {columns.map((_, colIdx) => (
            <View
              key={colIdx}
              testID={`heatmap-month-slot-${colIdx}`}
              style={{
                width: cellSize,
                marginRight:
                  colIdx < columns.length - 1 ? HEATMAP_CELL_GAP : 0,
              }}
            >
              {columnMonthLabels[colIdx] !== null && (
                <Text
                  style={[
                    styles.heatmapMonthLabel,
                    { color: colors.mutedForeground },
                  ]}
                  numberOfLines={1}
                  testID={`heatmap-month-label-${colIdx}`}
                >
                  {columnMonthLabels[colIdx]}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
      <View
        style={styles.heatmapGrid}
        onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
        testID="heatmap-grid"
      >
        {/* Weekday label rail. We render all seven slots so the
            row baselines line up with the cells next to them. */}
        <View
          style={[
            styles.heatmapLabelRail,
            {
              width: HEATMAP_LABEL_RAIL_WIDTH,
              marginRight: HEATMAP_LABEL_RAIL_GAP,
            },
          ]}
        >
          {HEATMAP_WEEKDAY_LABELS.map((label, idx) => (
            <View
              key={idx}
              style={{
                height: cellSize,
                marginBottom: idx < 6 ? HEATMAP_CELL_GAP : 0,
                justifyContent: "center",
              }}
            >
              {label.length > 0 && (
                <Text
                  style={[
                    styles.heatmapDayLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {label}
                </Text>
              )}
            </View>
          ))}
        </View>
        {columns.map((col, colIdx) => (
          <View
            key={colIdx}
            testID={`heatmap-col-${colIdx}`}
            style={{
              marginRight:
                colIdx < columns.length - 1 ? HEATMAP_CELL_GAP : 0,
            }}
          >
            {col.map((cell, rowIdx) => {
              if (cell === null) {
                return (
                  <View
                    key={rowIdx}
                    testID={`heatmap-empty-${colIdx}-${rowIdx}`}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      marginBottom: rowIdx < 6 ? HEATMAP_CELL_GAP : 0,
                    }}
                  />
                );
              }
              const opacity = heatmapOpacityFor(cell.count, max);
              const isToday = cell.date === today;
              const baseTint = yearTintBaseColor(
                cell.date,
                yearStats.multiYear,
                yearStats.latestYear,
                colors.primary,
                colors.accent,
              );
              const fillColor =
                opacity > 0 ? baseTint : colors.border + "55";
              const fillOpacity = opacity > 0 ? opacity : 1;
              const marginBottom = rowIdx < 6 ? HEATMAP_CELL_GAP : 0;
              // Today's cell wraps the colored fill in an extra
              // View so the accent ring stays at full opacity while
              // the fill keeps its per-cell intensity. Other cells
              // collapse to a single View as before.
              if (isToday) {
                return (
                  <TouchableOpacity
                    key={rowIdx}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      onSelectDate(cell.date);
                    }}
                    style={[
                      styles.heatmapCellToday,
                      {
                        width: cellSize,
                        height: cellSize,
                        borderColor: colors.accent,
                        marginBottom,
                      },
                    ]}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={formatLabel(cell.date, cell.count)}
                  >
                    <View
                      style={{
                        flex: 1,
                        backgroundColor: fillColor,
                        opacity: fillOpacity,
                        borderRadius: 1,
                      }}
                    />
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={rowIdx}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    onSelectDate(cell.date);
                  }}
                  style={[
                    styles.heatmapCell,
                    {
                      width: cellSize,
                      height: cellSize,
                      backgroundColor: fillColor,
                      opacity: fillOpacity,
                      borderColor: colors.border,
                      marginBottom,
                    },
                  ]}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={formatLabel(cell.date, cell.count)}
                />
              );
            })}
          </View>
        ))}
      </View>
      <HeatmapLegend
        multiYear={yearStats.multiYear}
        oldestYear={yearStats.oldestYear}
        latestYear={yearStats.latestYear}
      />
    </View>
  );
}

/**
 * Single-row weekly-bucket render for Past 90 / Past 365 day
 * windows. See CaptureHeatmap doc comment for background.
 *
 * Underneath the cells we render a month rail: a per-bucket strip of
 * "Jan", "Feb", … abbreviations that mark the bucket whose first
 * day starts a new calendar month, so a year of unlabelled bars
 * becomes scannable by season. Labels are absolutely positioned
 * (anchored to the bucket's left edge) instead of constrained to
 * the cell width — at 6 px cells "Jan" would otherwise be clipped
 * to nothing on the year view.
 */
function CaptureHeatmapStrip({
  counts,
  onSelectDate,
}: CaptureHeatmapProps) {
  const colors = useColors();
  const [rowWidth, setRowWidth] = useState(0);
  // Always bucket here — the dispatcher only routes to this
  // component when windowDays > HEATMAP_DAILY_MAX.
  const cells = useMemo(
    () => bucketHeatmapCounts(counts, SPARKLINE_BUCKET_DAYS),
    [counts],
  );
  const max = cells.reduce((m, c) => (c.count > m ? c.count : m), 0);

  // Set of distinct calendar years on the bucketed strip and the
  // newest one. Reused both by the month-label disambiguator and by
  // the per-bucket year-tint logic — see grid mode's `yearStats`
  // for the full rationale.
  const yearStats = useMemo(() => {
    const years = new Set<number>();
    for (const cell of cells) {
      const [y] = cell.date.split("-").map((s) => Number(s));
      years.add(y);
    }
    let latestYear = 0;
    let oldestYear = Number.POSITIVE_INFINITY;
    for (const y of years) {
      if (y > latestYear) latestYear = y;
      if (y < oldestYear) oldestYear = y;
    }
    return { multiYear: years.size > 1, latestYear, oldestYear };
  }, [cells]);

  // Per-bucket month abbreviation. Mirrors the grid-mode labelling
  // rule: a bucket gets a label only when its first day falls in a
  // different calendar month than the previous labelled bucket, so
  // a year shows "Jan" once, "Feb" once, etc. — never "Jan Jan
  // Jan". Buckets in the same month as the previous label return
  // null and render no marker.
  //
  // When the strip spans more than one calendar year (the 365-day
  // year recap, or any custom range that crosses Dec→Jan), bare
  // abbreviations would be ambiguous: e.g. "May" appears at both
  // ends of a May 2025 → May 2026 window. We append a 2-digit year
  // suffix ("May '25" / "May '26") to every labelled bucket in
  // that case so adjacent labels can never read identically. The
  // accessibility label always carries the full 4-digit year so
  // screen readers announce the year context, not just the
  // abbreviation glyph.
  const cellMonthLabels = useMemo(() => {
    const { multiYear } = yearStats;
    let prevMonthKey: string | null = null;
    return cells.map((cell) => {
      const [y, m] = cell.date.split("-").map((s) => Number(s));
      const monthIndex = (m ?? 1) - 1;
      const key = `${y}-${monthIndex}`;
      if (key === prevMonthKey) return null;
      prevMonthKey = key;
      const dt = new Date(y, monthIndex, 1);
      const monthShort = dt.toLocaleDateString([], { month: "short" });
      if (!multiYear) {
        return { display: monthShort, a11y: `${monthShort} starts here` };
      }
      const yearShort = String(y).slice(-2);
      return {
        display: `${monthShort} '${yearShort}`,
        a11y: `${monthShort} ${y} starts here`,
      };
    });
  }, [cells, yearStats]);

  const cellSize = (() => {
    if (rowWidth <= 0 || cells.length === 0) return HEATMAP_CELL_MAX;
    const totalGap = HEATMAP_CELL_GAP * (cells.length - 1);
    const raw = (rowWidth - totalGap) / cells.length;
    return Math.max(
      HEATMAP_STRIP_CELL_MIN,
      Math.min(HEATMAP_CELL_MAX, Math.floor(raw)),
    );
  })();

  const formatLabel = (iso: string, count: number): string => {
    // Same year-context rule as grid mode: when the bucketed strip
    // spans more than one calendar year, append the 4-digit year
    // so screen readers match the year-tint visual cue. Single-year
    // strips keep the bare "Week of …" label unchanged.
    const [y, m, d] = iso.split("-").map((s) => Number(s));
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    const label = dt.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const datePart = yearStats.multiYear ? `${label} ${y}` : label;
    const noun = count === 1 ? "memory" : "memories";
    return `Week of ${datePart}: ${count} ${noun}`;
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          marginBottom: 12,
        },
      ]}
    >
      <Text style={[styles.sectionLabel, { color: colors.primary }]}>
        CAPTURE ACTIVITY (WEEKLY)
      </Text>
      <View
        style={styles.heatmapStrip}
        onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
      >
        {cells.map((cell, idx) => {
          const opacity = heatmapOpacityFor(cell.count, max);
          const baseTint = yearTintBaseColor(
            cell.date,
            yearStats.multiYear,
            yearStats.latestYear,
            colors.primary,
            colors.accent,
          );
          const fillColor =
            opacity > 0 ? baseTint : colors.border + "55";
          const fillOpacity = opacity > 0 ? opacity : 1;
          return (
            <TouchableOpacity
              key={cell.date}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onSelectDate(cell.date);
              }}
              style={[
                styles.heatmapCell,
                {
                  width: cellSize,
                  height: cellSize,
                  backgroundColor: fillColor,
                  opacity: fillOpacity,
                  borderColor: colors.border,
                  marginRight: idx < cells.length - 1 ? HEATMAP_CELL_GAP : 0,
                },
              ]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={formatLabel(cell.date, cell.count)}
            />
          );
        })}
      </View>
      {/* Month rail. Sits directly under the weekly cells so each
          marker visually anchors the bucket where a new calendar
          month begins. We use absolute positioning (left = bucket
          index × column pitch) instead of fixed-width slots because
          on the year view cells are as small as 6 px — a width-
          clipped "Jan" in a 6 px slot would render as nothing.
          Skipped until we have a measured width so the offsets
          match the actual cell pitch.

          Overlap suppression: on narrow screens (year view, ~52
          buckets, 6 px cells, 9 px pitch) the suffixed labels
          "May '25" are ~42 px wide but consecutive month-change
          buckets can sit only ~36 px apart. `selectStripMonthLabelIndices`
          returns only the subset of candidate indices that are
          spaced far enough apart (forward greedy), while always
          preserving the last candidate so the final
          disambiguation anchor ("May '26") is never dropped. */}
      {rowWidth > 0 && cells.length > 0 && (() => {
        const pitch = cellSize + HEATMAP_CELL_GAP;
        const visibleIndices = selectStripMonthLabelIndices(
          cellMonthLabels,
          pitch,
        );
        return (
          <View style={styles.heatmapMonthRailUnder}>
            {cellMonthLabels.map((label, idx) => {
              if (label === null || !visibleIndices.has(idx)) return null;
              const left = idx * pitch;
              return (
                <Text
                  key={cells[idx].date}
                  testID={`strip-month-label-${idx}`}
                  style={[
                    styles.heatmapMonthLabel,
                    {
                      color: colors.mutedForeground,
                      position: "absolute",
                      left,
                    },
                  ]}
                  numberOfLines={1}
                  accessibilityLabel={label.a11y}
                >
                  {label.display}
                </Text>
              );
            })}
          </View>
        );
      })()}
      <HeatmapLegend
        multiYear={yearStats.multiYear}
        oldestYear={yearStats.oldestYear}
        latestYear={yearStats.latestYear}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lgCard,
  },
  sectionLabel: {
    // 800-weight one-off — Inter only ships up to 700 in the bundle, so
    // family stays pinned to Inter_700Bold.
    fontSize: 12,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  heatmapGrid: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  // Single-row layout used by the bucketed weekly strip on long
  // (90 / 365 day) windows. Same vertical rhythm as the grid so the
  // legend below sits at the same offset for both modes.
  heatmapStrip: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  heatmapMonthRail: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 4,
  },
  // Strip-mode (90 / 365 day) month rail. Rendered under the cells
  // with absolutely-positioned children (anchored by `left:` to the
  // bucket's pixel offset), so only `position: 'relative'` and a
  // fixed height matter here.
  heatmapMonthRailUnder: {
    position: "relative",
    height: 14,
    marginTop: 4,
    marginBottom: 6,
  },
  heatmapMonthLabel: {
    ...text.tiny,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    lineHeight: 12,
  },
  heatmapLabelRail: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  heatmapDayLabel: {
    ...text.tiny,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    lineHeight: 12,
  },
  heatmapCell: {
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Today's cell uses a thicker accent ring on a wrapper View so
  // the ring stays at full opacity even when the inner fill is
  // dimmed by the per-cell intensity.
  heatmapCellToday: {
    borderRadius: 4,
    borderWidth: 2,
    padding: 1,
  },
  heatmapLegend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-end",
  },
  // Wraps two `heatmapLegend` rows on multi-year windows so each
  // year's intensity ramp gets its own line. We keep the rows
  // right-aligned to match the single-row legend's `alignSelf:
  // 'flex-end'` so both modes anchor identically inside the card.
  heatmapLegendStack: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
    gap: 4,
  },
  heatmapLegendText: {
    // 11: deliberate one-off, sized down from text.caption (12).
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
  // Year prefix on a multi-year ramp row (e.g. "2025"). Same
  // typography as the rest of the legend, just with a tiny right
  // margin so the swatches don't crowd it.
  heatmapLegendYearLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    marginRight: 2,
  },
  heatmapLegendCell: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
});
