/**
 * Daily selfie ritual (Task #375).
 *
 * A "daily selfie" is just an ordinary photo memory tagged with
 * `DAILY_SELFIE_TAG`. We deliberately reuse Task #372's photo
 * pipeline (memory + photoUrl + thumb) rather than introduce a
 * second storage path — the only thing this layer adds is the
 * one-per-local-day discipline and the recap surfaces.
 *
 * Persistence:
 *   - The tag rides with the memory through the existing /sync
 *     endpoint, so the selfie marker survives a fresh install /
 *     account restore without needing a server schema change.
 *   - On read we *also* recover a `dailySelfieDate` (YYYY-MM-DD,
 *     local) derived from the memory's `timestamp`. Stored
 *     separately on the Memory so callers don't have to recompute
 *     the local-day bucket on every render. Local-day means the
 *     same wall-clock notion the daily capture cap uses (see
 *     `isTimestampToday` / `getLocalDayKey`).
 *
 * One-per-local-day:
 *   - Enforced by the capture flow via `findSelfieForDay` — when
 *     a same-day selfie already exists we prompt the user to
 *     replace it (delete the old, create the new) instead of
 *     silently stacking two selfies for a single calendar day.
 *
 * Recap surfaces (`buildSelfieStrip`):
 *   - Returns one cell per day in [windowStart, windowEnd] in
 *     chronological order, each tagged either `present` (with
 *     the memory) or `missed` (a gap). Renderers use this to
 *     paint a continuous strip without having to rederive the
 *     date arithmetic themselves.
 */

import type { Memory } from "./memories";

/** Sentinel tag used to mark a memory as the user's daily selfie.
 *  Lower-case + hyphenated to match the rest of the tag system
 *  (see `tallyTags` in `recapMonth.ts`, which lower-cases on read).
 *  Exported so the capture flow and the read-side helpers can't
 *  drift on the literal. */
export const DAILY_SELFIE_TAG = "daily-selfie";

/**
 * Local-day bucket (YYYY-MM-DD) for a Memory, in the device's
 * timezone. Mirrors `getLocalDayKey` from `captureLimits.ts` but
 * sources the date from the memory's `timestamp` rather than
 * `new Date()` — the cap math is "did *this* memory happen
 * today" which is the same shape we want here. Returns `null`
 * for memories with an unparseable timestamp so callers can skip
 * them defensively rather than render `NaN-NaN-NaN` cells.
 */
export function selfieLocalDayKey(timestamp: string): string | null {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** True when the memory carries the daily-selfie tag. We accept
 *  any casing on the tag because the user's tag list is
 *  case-preserving on insert; the recap aggregator's tag tally
 *  already lower-cases on read so this matches that invariant. */
export function isDailySelfie(m: Memory): boolean {
  if (!Array.isArray(m.tags)) return false;
  return m.tags.some(
    (t) => typeof t === "string" && t.toLowerCase() === DAILY_SELFIE_TAG,
  );
}

/**
 * Find the user's selfie for a given local day (YYYY-MM-DD), if any.
 * Caller passes the day key (typically `getLocalDayKey()` for the
 * "today" check the capture flow does before opening the camera).
 * Returns `null` when no selfie exists for that day.
 *
 * If multiple memories carry the daily-selfie tag for the same day
 * (shouldn't happen post-replace-prompt, but defensive against an
 * older offline burst that landed two), we pick the most recent by
 * timestamp so the surfaces show the latest take. Stable + total
 * ordering is important: a non-deterministic pick would let the
 * Today recap and Month recap show different selfies for the same
 * day on the same render.
 */
export function findSelfieForDay(
  memories: ReadonlyArray<Memory>,
  dayKey: string,
): Memory | null {
  let best: Memory | null = null;
  for (const m of memories) {
    if (!isDailySelfie(m)) continue;
    if (selfieLocalDayKey(m.timestamp) !== dayKey) continue;
    if (best === null || m.timestamp > best.timestamp) best = m;
  }
  return best;
}

/**
 * Selfie streak (Task #392).
 *
 * Pure, client-side count of consecutive local days with at least
 * one `daily-selfie` tagged memory. Distinct from the server-side
 * caring streak (`lib/streak.ts`) — that one rewards any capture;
 * this one specifically reinforces the selfie ritual.
 *
 *   - `current`  consecutive days ending at the most recent day
 *                with a selfie. If today is missing we still count
 *                a streak that ends yesterday so the "you're on a
 *                7-day streak!" celebration doesn't blink off the
 *                instant the local clock rolls past midnight — the
 *                user has the rest of today to keep it alive.
 *   - `endsOn`   last day in the streak (YYYY-MM-DD), or null.
 *   - `todayCaptured` whether today already has a selfie.
 *
 * "Today" is the device-local day key the caller supplies (same
 * shape `getLocalDayKey()` returns) so the helper stays pure / no
 * `new Date()` inside.
 */
export interface SelfieStreak {
  current: number;
  endsOn: string | null;
  todayCaptured: boolean;
}

/** Common selfie-streak milestones we celebrate. Lower numbers
 *  reinforce the ritual taking root; the larger ones mark real
 *  consistency. Kept here (not duplicated in the UI) so the
 *  capture screen and recap surface can never drift on which
 *  numbers count as a celebration. */
export const SELFIE_STREAK_MILESTONES: readonly number[] = [7, 30, 100];

function prevLocalDayKey(key: string): string | null {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setDate(dt.getDate() - 1);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function computeSelfieStreak(
  memories: ReadonlyArray<Memory>,
  todayKey: string,
): SelfieStreak {
  // Bucket all selfie days into a set for O(1) lookup. Latest-wins
  // doesn't matter here — we only care whether the day has *any*
  // selfie, not which.
  const days = new Set<string>();
  for (const m of memories) {
    if (!isDailySelfie(m)) continue;
    const key = selfieLocalDayKey(m.timestamp);
    if (key !== null) days.add(key);
  }
  const todayCaptured = days.has(todayKey);
  // Anchor: if today has a selfie, count from today; else fall back
  // to yesterday so a streak from previous days still surfaces.
  let cursor: string | null = todayCaptured ? todayKey : prevLocalDayKey(todayKey);
  if (cursor === null || !days.has(cursor)) {
    return { current: 0, endsOn: null, todayCaptured };
  }
  const endsOn = cursor;
  let count = 0;
  // Cap at 366 to match `buildSelfieStrip`'s safety bound — a
  // year-long streak is the realistic upper bound; further than
  // that and a malformed memory list could otherwise loop us.
  let safety = 0;
  while (cursor !== null && days.has(cursor) && safety < 366) {
    count += 1;
    cursor = prevLocalDayKey(cursor);
    safety += 1;
  }
  return { current: count, endsOn, todayCaptured };
}

/** Highest milestone the user is currently sitting on, or null
 *  when they aren't on one. Returned exactly when `current` equals
 *  one of `SELFIE_STREAK_MILESTONES` — we celebrate the moment the
 *  streak lands on the number, not every day after. */
export function selfieStreakMilestone(streak: SelfieStreak): number | null {
  if (streak.current <= 0) return null;
  for (const m of SELFIE_STREAK_MILESTONES) {
    if (streak.current === m) return m;
  }
  return null;
}

/** Caring milestone copy for selfie streaks. Mirrors the tone of
 *  `milestoneCopy` in `lib/streak.ts` — warm, scaling gently, never
 *  punitive. */
export function selfieStreakMilestoneCopy(milestone: number): {
  title: string;
  body: string;
} {
  switch (milestone) {
    case 7:
      return {
        title: "Seven selfies in a row.",
        body: "A whole week of showing up. The ritual is taking root.",
      };
    case 30:
      return {
        title: "Thirty selfies.",
        body: "A month of faces. That's a real practice now.",
      };
    case 100:
      return {
        title: "One hundred selfies.",
        body: "A hundred days of you. Quietly extraordinary.",
      };
    default:
      return {
        title: `${milestone} selfies in a row.`,
        body: "Quietly proud of you.",
      };
  }
}

/** Late-day nudge copy when today's selfie is still missing on a
 *  live streak. Returns null when there's nothing to nudge — used
 *  by the capture entry button and the recap today card so the two
 *  surfaces never disagree on when to nudge or what to say.
 *
 *  Inputs are pure for testability:
 *    - `streak`  the result of `computeSelfieStreak`
 *    - `hour`    0..23 device-local wall-clock hour
 *
 *  Threshold matches `flameIntensity`'s 17h "evening" mark so the
 *  selfie nudge and the caring-streak flame light up together. */
export function selfieLateDayNudge(
  streak: SelfieStreak,
  hour: number,
): string | null {
  if (streak.todayCaptured) return null;
  if (streak.current < 1) return null;
  if (hour < 17) return null;
  return `Day ${streak.current} is still waiting on today's selfie — no rush, whenever you're ready.`;
}

export type SelfieStripCell =
  | { date: string; kind: "present"; memory: Memory }
  | { date: string; kind: "missed" };

/**
 * Build one cell per day across an inclusive [windowStart, windowEnd]
 * range, marking each day as either `present` (with the selfie that
 * landed on that local day) or `missed` (no selfie on that day).
 *
 * The window dates are passed in as YYYY-MM-DD strings so this helper
 * can be driven directly by `MonthRecap.windowStart` / `.windowEnd`
 * without re-running the local-midnight math.
 *
 * Defensive guards:
 *   - If `windowEnd < windowStart` we return an empty array rather
 *     than throw — the caller can render "no days yet" rather than
 *     crashing the recap surface.
 *   - We cap the iteration at 366 days so a malformed range from a
 *     downgrade-poisoned custom-range AsyncStorage value can't run
 *     the renderer into a year-long loop.
 */
export function buildSelfieStrip(
  memories: ReadonlyArray<Memory>,
  windowStart: string,
  windowEnd: string,
): SelfieStripCell[] {
  const [sy, sm, sd] = windowStart.split("-").map(Number);
  const [ey, em, ed] = windowEnd.split("-").map(Number);
  if (
    !Number.isFinite(sy) ||
    !Number.isFinite(sm) ||
    !Number.isFinite(sd) ||
    !Number.isFinite(ey) ||
    !Number.isFinite(em) ||
    !Number.isFinite(ed)
  ) {
    return [];
  }
  const start = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
  const end = new Date(ey, em - 1, ed, 0, 0, 0, 0);
  if (end.getTime() < start.getTime()) return [];

  // Index selfies by local-day for O(1) lookup. Latest-wins so a
  // duplicate-day list still picks the canonical row that
  // `findSelfieForDay` would.
  const byDay = new Map<string, Memory>();
  for (const m of memories) {
    if (!isDailySelfie(m)) continue;
    const key = selfieLocalDayKey(m.timestamp);
    if (key === null) continue;
    const existing = byDay.get(key);
    if (!existing || m.timestamp > existing.timestamp) byDay.set(key, m);
  }

  const out: SelfieStripCell[] = [];
  const cursor = new Date(start);
  let safety = 0;
  while (cursor.getTime() <= end.getTime() && safety < 366) {
    const key = selfieLocalDayKey(cursor.toISOString());
    if (key !== null) {
      const hit = byDay.get(key);
      out.push(hit ? { date: key, kind: "present", memory: hit } : { date: key, kind: "missed" });
    }
    cursor.setDate(cursor.getDate() + 1);
    safety += 1;
  }
  return out;
}
