// Pure selector that turns the AI engine's PatternsEnvelope into a
// single rotating "Mem noticed…" insight for the Home screen card.
//
// Design:
//  - Pure & dependency-free so it's trivially unit-testable and can
//    run in Node (jest) without expo/react bootstrapping.
//  - Returns a stable shape `{ kind, template, highlight }`. The UI
//    renders the template as plain text and styles the {HL}
//    placeholder span as bold/coloured. This keeps the renderer dumb
//    and the selector typed.
//  - Day-stable rotation: we hash the calendar day to an integer
//    index, then pick `candidates[index % candidates.length]`. That
//    guarantees the user sees the same insight all day (no jitter on
//    re-mounts) AND the card visibly rotates day-to-day when the
//    envelope is rich enough to have multiple candidates.
//  - Cold-start fallback is intentional: if the envelope is missing,
//    flagged cold_start, or every candidate fails its signal
//    threshold, we surface a warm "Mem is still getting to know you"
//    message instead of a stale or empty insight.

import type { PatternsEnvelope } from "./aiEngine";

export type InsightKind =
  | "top_theme"
  | "weekday_best"
  | "top_person"
  | "mood_trend"
  | "recurring_theme"
  | "cold_start";

export interface HomeInsight {
  kind: InsightKind;
  /** Plain text with one optional `{HL}` placeholder marking the
   *  highlighted span. Cold-start has no placeholder. */
  template: string;
  /** Substring substituted into `{HL}` at render time. Empty string
   *  for cold-start. */
  highlight: string;
}

const WEEKDAY_FULL: Record<string, string> = {
  Sun: "Sundays",
  Mon: "Mondays",
  Tue: "Tuesdays",
  Wed: "Wednesdays",
  Thu: "Thursdays",
  Fri: "Fridays",
  Sat: "Saturdays",
};

const COLD_START: HomeInsight = {
  kind: "cold_start",
  template:
    "Mem is still getting to know you — capture a few more memories and patterns will start showing up here.",
  highlight: "",
};

// Thresholds tuned so the card never surfaces a coincidence:
//  - a single tag isn't a "theme"
//  - a single mention isn't a recurring person
//  - a 0.1-rating gap isn't a meaningful favourite weekday
const MIN_THEME_COUNT = 2;
const MIN_PERSON_COUNT = 2;
const MIN_WEEKDAY_RATINGS = 2;
const MIN_WEEKDAY_GAP = 0.4;

function buildTopTheme(env: PatternsEnvelope): HomeInsight | null {
  const top = env.data.tags_30d[0];
  if (!top || top.count < MIN_THEME_COUNT) return null;
  return {
    kind: "top_theme",
    template: "Your top theme this month is {HL}.",
    highlight: top.tag,
  };
}

function buildTopPerson(env: PatternsEnvelope): HomeInsight | null {
  const top = env.data.top_people[0];
  if (!top || top.count < MIN_PERSON_COUNT) return null;
  return {
    kind: "top_person",
    template: "{HL} has come up most often lately.",
    highlight: top.person,
  };
}

function buildWeekdayBest(env: PatternsEnvelope): HomeInsight | null {
  const entries = Object.entries(env.data.weekday_mood).filter(
    (e): e is [string, number] => typeof e[1] === "number",
  );
  if (entries.length < MIN_WEEKDAY_RATINGS) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const [bestDay, bestRating] = entries[0]!;
  const second = entries[1];
  // Need a clear gap or it's not a "best" day, just noise.
  if (second && bestRating - second[1] < MIN_WEEKDAY_GAP) return null;
  const full = WEEKDAY_FULL[bestDay] ?? bestDay;
  return {
    kind: "weekday_best",
    template: "You feel best on {HL}.",
    highlight: full,
  };
}

function buildMoodTrend(env: PatternsEnvelope): HomeInsight | null {
  const trend = env.data.mood_trend;
  if (trend !== "improving" && trend !== "declining") return null;
  const phrase =
    trend === "improving" ? "trending upward" : "trending downward";
  return {
    kind: "mood_trend",
    template: "Your mood is {HL} this week.",
    highlight: phrase,
  };
}

function buildRecurringTheme(env: PatternsEnvelope): HomeInsight | null {
  const theme = env.data.recurring_theme;
  if (!theme) return null;
  return {
    kind: "recurring_theme",
    template: "Mem keeps seeing {HL} across your memories.",
    highlight: theme,
  };
}

/** Day index from epoch UTC, used to rotate the card daily. Pure
 *  function of `now` so it's deterministic in tests. */
function dayIndex(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}

/** Build all insight candidates that pass their signal thresholds.
 *  Order is the priority used for tie-breaking — themes first,
 *  weekday/person/mood next, recurring-theme last (it's redundant
 *  with top_theme so it sits behind the others when both fire). */
function buildCandidates(env: PatternsEnvelope): HomeInsight[] {
  const out: HomeInsight[] = [];
  const t = buildTopTheme(env);
  if (t) out.push(t);
  const w = buildWeekdayBest(env);
  if (w) out.push(w);
  const p = buildTopPerson(env);
  if (p) out.push(p);
  const m = buildMoodTrend(env);
  if (m) out.push(m);
  const r = buildRecurringTheme(env);
  // Suppress recurring_theme when top_theme already names the same
  // tag — they'd carry identical highlight text and the rotation
  // would feel broken ("Mem keeps seeing X" right after "Your top
  // theme is X").
  if (r && !out.some((c) => c.kind === "top_theme" && c.highlight === r.highlight)) {
    out.push(r);
  }
  return out;
}

export function pickHomeInsight(
  patterns: PatternsEnvelope | null,
  now: Date = new Date(),
): HomeInsight {
  if (!patterns || patterns.data.cold_start) return COLD_START;
  const candidates = buildCandidates(patterns);
  if (candidates.length === 0) return COLD_START;
  const idx = ((dayIndex(now) % candidates.length) + candidates.length) %
    candidates.length;
  return candidates[idx]!;
}

// Exposed for tests so they can assert rotation and threshold logic
// without round-tripping through the public selector.
export const _internals = {
  buildCandidates,
  dayIndex,
  COLD_START,
  MIN_THEME_COUNT,
  MIN_PERSON_COUNT,
  MIN_WEEKDAY_RATINGS,
  MIN_WEEKDAY_GAP,
};
