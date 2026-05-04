// Pure aggregator that turns the user's cached memories, mood history, and
// stored AI patterns envelope into a rolling-window recap (used for the
// "Past 7 days", "Past 30 days", "Past 90 days", and "Past 365 days"
// views). No I/O, no React, no fetches — safe to call from any layer and
// trivial to unit test. The Recap screen renders the result; nothing
// else writes to the shape returned here.
//
// Window definition: a rolling N-day window ending at the device's local
// midnight (today inclusive). We use the same local-midnight notion the
// rest of the app uses (see `captureLimits.isTimestampToday`) so the
// window edges match what the user sees in Today / Archive.
//
// Data preference: we always compute counts and tallies from the local
// memory list. The patterns envelope is consulted ONLY for the
// AI-generated `recurring_theme` string, which the client cannot derive
// itself. This keeps the surface useful even before the AI engine has
// built its first envelope (cold-start) and means the view never blanks
// on an envelope-fetch miss.

import type { Memory } from "./memories";
import type { MoodLog } from "./mood";
import type { PatternsEnvelope } from "./aiEngine";

export const MONTH_RECAP_WINDOW_DAYS = 30;
/** Mirror of `aiEngine.PATTERNS_COLD_START_MIN` so the cold-start
 *  branch of this view matches the engine's own cold-start gate for the
 *  30-day window. We duplicate the constant rather than import it
 *  because the engine module pulls in network code (postJson / embed
 *  batchers) that we don't want loaded for this pure aggregator. The
 *  cold-start threshold for shorter windows is derived proportionally
 *  via `coldStartMinForWindow` below. */
export const MONTH_RECAP_COLD_START_MIN = 5;

export const TOP_TAGS_LIMIT = 5;
export const TOP_PEOPLE_LIMIT = 3;

/**
 * Soft cap on the number of mood points we hand to the renderer. The
 * sparkline only has ~340 px to work with on a typical phone, so once
 * the raw daily series gets longer than this we down-sample into
 * weekly buckets via `bucketMoodSparkline`. Picked at 30 so the
 * 30-day view (the original behaviour) keeps daily resolution while
 * the new 90- and 365-day views drop to weekly buckets and stay
 * legible. Exported so the renderer and tests share the same
 * threshold.
 */
export const MAX_SPARKLINE_DOTS = 30;
/** Bucket width (in days) used when down-sampling long-window
 *  sparklines. Weekly buckets keep the year view at 52 dots and the
 *  quarter view at 13 dots — both comfortable in the available
 *  width. */
export const SPARKLINE_BUCKET_DAYS = 7;

/**
 * Cold-start capture threshold for a given window length. The 30-day
 * window keeps its historical 5-capture floor; the 7-day window drops
 * to 2 captures so a daily-active user isn't gated for a full week. We
 * derive shorter windows proportionally and clamp at a minimum of 2 so
 * the surface never trips on a single capture (which carries no
 * pattern signal).
 */
export function coldStartMinForWindow(windowDays: number): number {
  const proportional = Math.round(
    (MONTH_RECAP_COLD_START_MIN * windowDays) / MONTH_RECAP_WINDOW_DAYS,
  );
  return Math.max(2, proportional);
}

export type MoodTrend = "upward" | "steady" | "downward" | "insufficient";

export interface MonthRecapTagCount {
  tag: string;
  count: number;
}
export interface MonthRecapPersonCount {
  person: string;
  count: number;
}
export interface MonthRecapMoodPoint {
  /** YYYY-MM-DD, local-timezone, oldest first. */
  date: string;
  /** 1..5 if rated, null if no log on that day. */
  rating: number | null;
}
export interface MonthRecapDailyCount {
  /** YYYY-MM-DD, local-timezone. */
  date: string;
  /** Number of captures on that local day (>= 0). */
  count: number;
}

export interface MonthRecap {
  /** The window length used to produce this recap. */
  windowDays: number;
  /** Inclusive window start (YYYY-MM-DD, local). */
  windowStart: string;
  /** Inclusive window end (YYYY-MM-DD, local — today). */
  windowEnd: string;
  totalCaptures: number;
  daysWithCaptures: number;
  topTags: MonthRecapTagCount[];
  topPeople: MonthRecapPersonCount[];
  /** Exactly `windowDays` entries, oldest first. The raw daily
   *  mood signal — useful for callers that want full resolution.
   *  Renderers should prefer `displayMoodSparkline` instead so the
   *  long-window views (quarter, year) don't try to plot hundreds
   *  of dots in a sliver of width. */
  moodSparkline: MonthRecapMoodPoint[];
  /** Down-sampled mood series intended for the on-screen sparkline.
   *  For windows of `MAX_SPARKLINE_DOTS` days or fewer this is
   *  identical to `moodSparkline` (one entry per day). For longer
   *  windows it's bucketed via `bucketMoodSparkline` into
   *  `SPARKLINE_BUCKET_DAYS`-wide buckets so a year view shows ~52
   *  dots instead of 365. Each bucket's `date` is the first day of
   *  the bucket; `rating` is the mean of the rated days inside the
   *  bucket, or null if no day in the bucket was rated. */
  displayMoodSparkline: MonthRecapMoodPoint[];
  /** Exactly `windowDays` entries, oldest first. One cell per day
   *  in the window with the number of captures that fell on that
   *  local day. Drives the heatmap row on the Past 30 days view;
   *  the renderer is responsible for any further down-sampling on
   *  the longer windows. */
  dailyCaptureCounts: MonthRecapDailyCount[];
  moodTrend: MoodTrend;
  moodTrendLabel: string;
  /** AI-generated theme line from the patterns envelope, or null if
   *  the engine has not yet produced one. */
  recurringTheme: string | null;
  /** True when fewer than `coldStartMinForWindow(windowDays)` captures
   *  exist in the window — the view should render the friendly nudge
   *  instead of the populated surface. */
  isColdStart: boolean;
}

export interface AggregateRangeRecapInput {
  memories: ReadonlyArray<Memory>;
  moodHistory: ReadonlyArray<MoodLog>;
  patterns: PatternsEnvelope | null;
  /** Window length in days. Defaults to MONTH_RECAP_WINDOW_DAYS (30). */
  windowDays?: number;
  /** Override "now" for testing. Defaults to `new Date()`. */
  now?: Date;
}

/** Backwards-compat alias preserved for older callers and tests. */
export type AggregateMonthRecapInput = AggregateRangeRecapInput;

function toLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function localMidnight(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

function normalizePerson(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

function describeMoodTrend(trend: MoodTrend): string {
  switch (trend) {
    case "upward":
      return "trending upward";
    case "downward":
      return "trending downward";
    case "steady":
      return "fairly steady";
    case "insufficient":
    default:
      return "not enough data yet";
  }
}

/**
 * Compare the mean rating of the older half of the window to the newer
 * half. We require at least 4 rated days total (2 per half) so a single
 * outlier can't flip the descriptor. The 0.3 threshold matches the
 * smallest gap a user is likely to feel as a real change on the 1–5
 * scale. This threshold is intentionally NOT scaled with window length
 * — a single rated day per half is too thin a signal regardless of
 * whether the window is a week or a month.
 */
function classifyMoodTrend(points: MonthRecapMoodPoint[]): MoodTrend {
  const rated = points
    .map((p, idx) => ({ idx, rating: p.rating }))
    .filter((p): p is { idx: number; rating: number } => p.rating !== null);
  if (rated.length < 4) return "insufficient";
  const mid = Math.floor(points.length / 2);
  const older = rated.filter((p) => p.idx < mid);
  const newer = rated.filter((p) => p.idx >= mid);
  if (older.length < 2 || newer.length < 2) return "insufficient";
  const olderMean =
    older.reduce((sum, p) => sum + p.rating, 0) / older.length;
  const newerMean =
    newer.reduce((sum, p) => sum + p.rating, 0) / newer.length;
  const delta = newerMean - olderMean;
  if (delta >= 0.3) return "upward";
  if (delta <= -0.3) return "downward";
  return "steady";
}

/**
 * Build the `windowDays` oldest-first day buckets for the sparkline.
 * Days without a mood log render as `null` (the view draws a gap).
 * Mood dates are matched on `YYYY-MM-DD`, which `MoodLog.date` already
 * is (local-timezone) — see `mood.todayLocalDate`.
 */
function buildSparkline(
  windowStart: Date,
  windowDays: number,
  moodHistory: ReadonlyArray<MoodLog>,
): MonthRecapMoodPoint[] {
  const byDate = new Map<string, number>();
  for (const log of moodHistory) {
    if (typeof log.date !== "string") continue;
    if (typeof log.rating !== "number") continue;
    if (log.rating <= 0) continue; // 0 = unset
    // If the same date appears twice (offline replay edge case),
    // the LAST one wins — server is expected to dedupe but the
    // local cache may briefly hold both. Same-day rating is what
    // the user most recently chose.
    byDate.set(log.date, log.rating);
  }
  const out: MonthRecapMoodPoint[] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(windowStart);
    d.setDate(d.getDate() + i);
    const key = toLocalDate(d);
    out.push({
      date: key,
      rating: byDate.has(key) ? (byDate.get(key) as number) : null,
    });
  }
  return out;
}

/**
 * Down-sample a per-day mood series into fixed-width buckets. Each
 * output bucket spans `bucketDays` consecutive points; the bucket's
 * `date` is the date of its first (oldest) day, and `rating` is the
 * mean of the rated days inside the bucket (or null if every day in
 * the bucket was unrated). The final bucket may be partial when
 * `points.length` isn't an exact multiple of `bucketDays` — that's
 * intentional so the most recent days never get dropped from the
 * series. Pure helper, exported for tests and any other caller that
 * wants the same down-sampling behaviour.
 */
export function bucketMoodSparkline(
  points: ReadonlyArray<MonthRecapMoodPoint>,
  bucketDays: number,
): MonthRecapMoodPoint[] {
  // No-ops: a degenerate bucket size (≤1) is a pure pass-through,
  // and there's nothing to gain from "bucketing" fewer points than
  // a single bucket would hold — keeping daily resolution in that
  // case is the less surprising behaviour.
  if (bucketDays <= 1 || points.length < bucketDays) {
    return points.slice();
  }
  const out: MonthRecapMoodPoint[] = [];
  for (let i = 0; i < points.length; i += bucketDays) {
    const slice = points.slice(i, i + bucketDays);
    if (slice.length === 0) continue;
    const rated = slice.filter(
      (p): p is MonthRecapMoodPoint & { rating: number } => p.rating !== null,
    );
    const rating =
      rated.length === 0
        ? null
        : rated.reduce((sum, p) => sum + p.rating, 0) / rated.length;
    out.push({ date: slice[0].date, rating });
  }
  return out;
}

function tallyTags(memories: ReadonlyArray<Memory>): MonthRecapTagCount[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const m of memories) {
    if (!Array.isArray(m.tags)) continue;
    // Dedupe within a single memory: a memory tagged ["Work","work"]
    // only contributes one to "work". Without this a noisy capture
    // could dominate the strip.
    const seen = new Set<string>();
    for (const raw of m.tags) {
      const norm = normalizeTag(raw);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      const existing = counts.get(norm);
      if (existing) {
        existing.count += 1;
      } else {
        // Preserve a display form (first non-empty original casing
        // wins) so chips don't render as all-lowercase when the user
        // typed "Work".
        const display = typeof raw === "string" ? raw.trim() : norm;
        counts.set(norm, { tag: display, count: 1 });
      }
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, TOP_TAGS_LIMIT);
}

function tallyPeople(
  memories: ReadonlyArray<Memory>,
): MonthRecapPersonCount[] {
  const counts = new Map<string, { person: string; count: number }>();
  for (const m of memories) {
    const p = normalizePerson(m.person);
    if (!p) continue;
    // Case-insensitive dedup so "Sam" and "sam" merge, but keep the
    // first-seen casing as the display form.
    const key = p.toLowerCase();
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { person: p, count: 1 });
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.person.localeCompare(b.person))
    .slice(0, TOP_PEOPLE_LIMIT);
}

export function aggregateRangeRecap(
  input: AggregateRangeRecapInput,
): MonthRecap {
  const windowDays =
    typeof input.windowDays === "number" && input.windowDays > 0
      ? Math.floor(input.windowDays)
      : MONTH_RECAP_WINDOW_DAYS;
  const now = input.now ?? new Date();
  const todayMidnight = localMidnight(now);
  const windowStartDate = new Date(todayMidnight);
  windowStartDate.setDate(windowStartDate.getDate() - (windowDays - 1));

  const inWindow = input.memories.filter((m) => {
    if (typeof m.timestamp !== "string") return false;
    const ts = new Date(m.timestamp);
    if (Number.isNaN(ts.getTime())) return false;
    return (
      ts >= windowStartDate &&
      ts < new Date(todayMidnight.getTime() + 24 * 60 * 60 * 1000)
    );
  });

  // Pre-seed every day in the window so the heatmap always has
  // exactly `windowDays` cells (oldest first), even on days with
  // zero captures. We keep insertion order on the Map so iteration
  // produces the cells in chronological order without a second
  // sort pass. Earlier versions hard-coded 30 here; that broke the
  // 7/90/365-day windows by either truncating the series or
  // padding it with future dates.
  const dailyCounts = new Map<string, number>();
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(windowStartDate);
    d.setDate(d.getDate() + i);
    dailyCounts.set(toLocalDate(d), 0);
  }
  for (const m of inWindow) {
    const key = toLocalDate(new Date(m.timestamp));
    // The window filter above already restricts to in-window
    // timestamps, so the key is guaranteed to be in the seed map;
    // the `?? 0` is defensive only.
    dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1);
  }
  const dailyCaptureCounts: MonthRecapDailyCount[] = Array.from(
    dailyCounts.entries(),
  ).map(([date, count]) => ({ date, count }));
  const distinctDays = dailyCaptureCounts.reduce(
    (n, c) => n + (c.count > 0 ? 1 : 0),
    0,
  );

  const topTags = tallyTags(inWindow);
  const topPeople = tallyPeople(inWindow);
  const moodSparkline = buildSparkline(
    windowStartDate,
    windowDays,
    input.moodHistory,
  );
  // The trend descriptor is always computed off the raw daily series
  // — bucketing here would smear the older-half / newer-half split
  // we use to pick "upward" vs "downward" and could swing the label
  // for a year window where the underlying signal is actually clear.
  const moodTrend = classifyMoodTrend(moodSparkline);
  // Down-sample for the renderer once the daily series gets too long
  // to plot legibly. The threshold and bucket width are exported so
  // the renderer doesn't have to reimplement (or guess at) the same
  // policy.
  const displayMoodSparkline =
    moodSparkline.length > MAX_SPARKLINE_DOTS
      ? bucketMoodSparkline(moodSparkline, SPARKLINE_BUCKET_DAYS)
      : moodSparkline;
  const recurringTheme =
    input.patterns &&
    typeof input.patterns.data?.recurring_theme === "string" &&
    input.patterns.data.recurring_theme.trim().length > 0
      ? input.patterns.data.recurring_theme.trim()
      : null;

  return {
    windowDays,
    windowStart: toLocalDate(windowStartDate),
    windowEnd: toLocalDate(todayMidnight),
    totalCaptures: inWindow.length,
    daysWithCaptures: distinctDays,
    topTags,
    topPeople,
    moodSparkline,
    displayMoodSparkline,
    dailyCaptureCounts,
    moodTrend,
    moodTrendLabel: describeMoodTrend(moodTrend),
    recurringTheme,
    isColdStart: inWindow.length < coldStartMinForWindow(windowDays),
  };
}

/**
 * Backwards-compat wrapper. Defaults to the 30-day window so existing
 * callers (and tests) that don't pass `windowDays` keep their original
 * behaviour. Prefer `aggregateRangeRecap` directly in new code.
 */
export function aggregateMonthRecap(
  input: AggregateRangeRecapInput,
): MonthRecap {
  return aggregateRangeRecap({
    ...input,
    windowDays: input.windowDays ?? MONTH_RECAP_WINDOW_DAYS,
  });
}
