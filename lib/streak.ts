// Caring streak client (Task #342).
//
// Talks to the api-server's `/api/streak*` endpoints, which carry
// the server-authoritative streak state (so a user can't pad the
// count by changing their device clock — the server bucket key
// validates ±2 days from UTC and treats same-day re-captures as a
// no-op).
//
// All math here is presentation-layer only: pick the right milestone
// celebration to show, compute the flame's "intensification" factor
// from the current local time, and surface a one-tap recovery offer.
// The server is the only place increment/break math lives.

import { getToken } from "./auth";
import { getLocalDayKey } from "./captureLimits";
import { resolveReplitApiBase } from "./config";
import { trackEvent } from "./analytics";

export interface StreakSnapshot {
  current: number;
  longest: number;
  lastCountedDay: string | null;
  freezesAvailable: number;
  lastMilestone: number;
  pendingRecoveryFor: string | null;
}

export interface StreakConfig {
  milestones: number[];
  freeMonthlyFreezes: number;
  /** Tier-resolved monthly allowance for THIS user (Task #368).
   *  Equals `freeMonthlyFreezes` for free users, the Pro constant
   *  for Pro. Older server builds don't send it, so we default to
   *  `freeMonthlyFreezes` in `DEFAULT_CONFIG` and the spread merge
   *  below — never undefined at the UI layer. */
  monthlyFreezeAllowance: number;
  /** Hard cap on stockpiled freezes (server enforces; surfaced
   *  here so the "earn a freeze" CTA can disable when full). */
  maxFreezeStockpile: number;
  recoveryWindowDays: number;
}

export interface StreakResponse {
  streak: StreakSnapshot;
  config: StreakConfig;
  /** "server" = the snapshot reflects an authoritative server read.
   *  "fallback" = network/auth failure, snapshot is the zero
   *  default. Callers MUST NOT diff a fallback against a prior
   *  server snapshot (it would emit false `streak_broken` events). */
  source: "server" | "fallback";
}

const FETCH_TIMEOUT_MS = 6_000;

const DEFAULT_CONFIG: StreakConfig = {
  milestones: [3, 7, 14, 30, 60, 100],
  freeMonthlyFreezes: 1,
  monthlyFreezeAllowance: 1,
  maxFreezeStockpile: 5,
  recoveryWindowDays: 1,
};

const DEFAULT_SNAPSHOT: StreakSnapshot = {
  current: 0,
  longest: 0,
  lastCountedDay: null,
  freezesAvailable: 0,
  lastMilestone: 0,
  pendingRecoveryFor: null,
};

function endpoint(path: string): string {
  return `${resolveReplitApiBase()}/api${path}`;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cold-start safe: returns a zeroed snapshot on any failure so the
 * home screen renders without a flame rather than blocking the UI
 * on the streak round-trip. The server's snapshot will land on the
 * next successful call.
 */
export async function fetchStreak(): Promise<StreakResponse> {
  const token = await getToken();
  if (!token) {
    return { streak: DEFAULT_SNAPSHOT, config: DEFAULT_CONFIG, source: "fallback" };
  }
  try {
    const res = await fetchWithTimeout(
      `${endpoint("/streak")}?localDay=${encodeURIComponent(getLocalDayKey())}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) {
      return { streak: DEFAULT_SNAPSHOT, config: DEFAULT_CONFIG, source: "fallback" };
    }
    const body = (await res.json()) as Partial<StreakResponse>;
    return {
      streak: { ...DEFAULT_SNAPSHOT, ...(body.streak ?? {}) },
      config: { ...DEFAULT_CONFIG, ...(body.config ?? {}) },
      source: "server",
    };
  } catch {
    return { streak: DEFAULT_SNAPSHOT, config: DEFAULT_CONFIG, source: "fallback" };
  }
}

export async function ackMilestoneSeen(
  milestone: number,
): Promise<StreakSnapshot | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const res = await fetchWithTimeout(
      endpoint("/streak/milestone-seen"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ milestone, localDay: getLocalDayKey() }),
      },
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { streak?: StreakSnapshot };
    return body.streak ?? null;
  } catch {
    return null;
  }
}

/**
 * Earn-a-freeze grant (Task #368). Currently driven by the wellness
 * check-in save; the server enforces:
 *   - one grant per local day (subsequent calls return 409
 *     STREAK_GRANT_ALREADY_TODAY — UI surfaces a calm "you've
 *     already earned today's freeze" instead of an error)
 *   - stockpile cap (`maxFreezeStockpile`); when full the server
 *     returns 409 STREAK_GRANT_STOCKPILE_FULL
 *
 * Returns a discriminated result so the caller can branch on
 * outcome instead of parsing error strings. `error` is the
 * catch-all for network/auth/5xx failures: best-effort, never
 * blocks the wellness flow.
 */
export type GrantFreezeOutcome =
  | { kind: "ok"; streak: StreakSnapshot }
  | { kind: "already_granted_today" }
  | { kind: "stockpile_full" }
  | { kind: "error" };

export async function grantStreakFreeze(
  source: "wellness_checkin",
): Promise<GrantFreezeOutcome> {
  const token = await getToken();
  if (!token) return { kind: "error" };
  try {
    const res = await fetchWithTimeout(
      endpoint("/streak/grant"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source, localDay: getLocalDayKey() }),
      },
      FETCH_TIMEOUT_MS,
    );
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (body.code === "STREAK_GRANT_ALREADY_TODAY") {
        return { kind: "already_granted_today" };
      }
      if (body.code === "STREAK_GRANT_STOCKPILE_FULL") {
        return { kind: "stockpile_full" };
      }
      return { kind: "error" };
    }
    if (!res.ok) return { kind: "error" };
    const body = (await res.json()) as { streak?: StreakSnapshot };
    if (!body.streak) return { kind: "error" };
    trackEvent("streak_freeze_earned", { source });
    return { kind: "ok", streak: body.streak };
  } catch {
    return { kind: "error" };
  }
}

export type RecoverOutcome =
  | { kind: "ok"; streak: StreakSnapshot; restoredTo: number }
  | { kind: "no_offer" }
  | { kind: "expired" }
  | { kind: "error" };

export async function recoverStreak(): Promise<RecoverOutcome> {
  const token = await getToken();
  if (!token) return { kind: "error" };
  try {
    const res = await fetchWithTimeout(
      endpoint("/streak/recover"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ localDay: getLocalDayKey() }),
      },
      FETCH_TIMEOUT_MS,
    );
    if (res.status === 409) return { kind: "no_offer" };
    if (res.status === 410) return { kind: "expired" };
    if (!res.ok) return { kind: "error" };
    const body = (await res.json()) as { streak: StreakSnapshot; restoredTo: number };
    trackEvent("streak_recovered", { restoredTo: body.restoredTo });
    return { kind: "ok", streak: body.streak, restoredTo: body.restoredTo };
  } catch {
    return { kind: "error" };
  }
}

// ---- presentation helpers (pure) -------------------------------------

/**
 * Highest milestone the user has crossed but not yet seen. Used by
 * the home screen to know when to fire the celebration overlay.
 *
 * Returns null when there's nothing to celebrate (no milestones
 * crossed since last ack, or `current` has slipped below the last
 * crossed milestone). Picks the BIGGEST unseen milestone — if a
 * user came back from a long offline stretch and crosses several at
 * once, we celebrate the most meaningful one rather than queue a
 * conga line of overlays.
 */
export function pendingMilestone(
  s: StreakSnapshot,
  config: StreakConfig = DEFAULT_CONFIG,
): number | null {
  let best: number | null = null;
  for (const m of config.milestones) {
    if (s.current >= m && m > s.lastMilestone) best = m;
  }
  return best;
}

/**
 * Flame intensification factor (0..1) for the home indicator. The
 * intent (per the brand bible) is *gentle escalation*, never panic:
 * the flame brightens late in the day if the user hasn't captured
 * yet. It's deliberately a smooth ramp from "calm" in the morning
 * to "noticeable but warm" near the deadline.
 *
 * Inputs are pure for testability:
 *   - `lastCountedDay` — the streak's last counted day
 *   - `todayLocalDay`  — the device's wall-clock day
 *   - `hour`           — 0..23 (the device's wall-clock hour)
 *
 * Returns 0 when the user has already captured today (no
 * intensification needed — the streak is safe). Otherwise climbs
 * with the hour: morning calm (< 17h), gentle warm-up through the
 * evening, peak (1.0) only in the final two hours of the day.
 */
export function flameIntensity(
  lastCountedDay: string | null,
  todayLocalDay: string,
  hour: number,
): number {
  if (lastCountedDay === todayLocalDay) return 0;
  if (hour < 17) return 0;
  if (hour < 20) return 0.35;
  if (hour < 22) return 0.65;
  return 1;
}

/** True when today is the day the user can one-tap recover. */
export function canRecoverToday(
  s: StreakSnapshot,
  todayLocalDay: string,
): boolean {
  return s.pendingRecoveryFor !== null && s.current <= 1
    ? // The offer is already filtered server-side to within the
      // recovery window; we just guard against showing it on a day
      // when the user has already captured (current would be > 1
      // because increment + recovery couldn't both apply).
      true
    : false;
}

/**
 * Caring copy for the milestone overlay. Tone matches the brand
 * bible: warm, never punitive, scales gently with the milestone
 * size so day-100 reads bigger than day-3 without screaming.
 */
export function milestoneCopy(milestone: number): { title: string; body: string } {
  switch (milestone) {
    case 3:
      return {
        title: "Three days in a row.",
        body: "Tiny, steady — that's how a habit takes root.",
      };
    case 7:
      return {
        title: "A whole week.",
        body: "Seven days of showing up for yourself.",
      };
    case 14:
      return {
        title: "Two weeks.",
        body: "You've built real momentum. Keep going gently.",
      };
    case 30:
      return {
        title: "Thirty days.",
        body: "A full month of memories. That's a real practice now.",
      };
    case 60:
      return {
        title: "Sixty days.",
        body: "Twice in a row. The kind of consistency that changes things.",
      };
    case 100:
      return {
        title: "One hundred days.",
        body: "A hundred days with you. Thank you for letting me be part of it.",
      };
    default:
      return {
        title: `${milestone} days.`,
        body: "Quietly proud of you.",
      };
  }
}

/**
 * Caring copy for the gentle-recovery card. NEVER reads as guilt
 * or "you broke your streak"; reads as "I'm here, want to count
 * yesterday?".
 */
export function recoveryCopy(): { title: string; body: string; cta: string } {
  return {
    title: "I'm here.",
    body: "Yesterday slipped by — that's okay. Want to log a quick note for it so we keep going together?",
    cta: "Log yesterday",
  };
}

/**
 * Opening-line streak acknowledgment for the Mem chat surface
 * (Task #369). Returns a single warm sentence the AI Guide intro
 * can prepend to its greeting when there's something worth quietly
 * noting:
 *   - The user just crossed a milestone the home overlay hasn't
 *     acknowledged yet → reuse `milestoneCopy` so the wording stays
 *     identical across surfaces.
 *   - It's evening (>= 17h local) and today's capture is still
 *     missing on a live streak → a gentle "still here" nudge that
 *     mirrors the home flame's intensification without sounding
 *     like a reminder push.
 * Returns `null` when there's nothing to say so the caller can fall
 * back to the unmodified intro greeting.
 */
export function aiGuideStreakOpener(
  s: StreakSnapshot,
  config: StreakConfig,
  todayLocalDay: string,
  hour: number,
): string | null {
  const milestone = pendingMilestone(s, config);
  if (milestone !== null) {
    const { title, body } = milestoneCopy(milestone);
    return `${title} ${body}`;
  }
  if (
    s.current >= 1 &&
    s.lastCountedDay !== todayLocalDay &&
    hour >= 17
  ) {
    return `Day ${s.current} is still waiting on you — no rush, I'm here whenever you're ready.`;
  }
  return null;
}

/**
 * Stable identity for whatever opener `aiGuideStreakOpener` would
 * generate from the same inputs. The screen uses this to dedupe so
 * a returning user with chat history doesn't see the same milestone
 * acknowledgment re-injected on every screen mount — once we've shown
 * "day 7" or "day 12 still waiting" today, we won't show it again
 * until the underlying state changes (a new milestone crosses, or
 * the local day rolls over for the at-risk variant).
 *
 *   - Milestone variant: `m:<milestone>`
 *   - At-risk variant:   `r:<localDay>`
 *   - No-op:             null
 *
 * Kept next to the opener so the two stay in lockstep — anyone
 * adding a new opener branch must add the matching key here too.
 */
export function aiGuideStreakOpenerKey(
  s: StreakSnapshot,
  config: StreakConfig,
  todayLocalDay: string,
  hour: number,
): string | null {
  const milestone = pendingMilestone(s, config);
  if (milestone !== null) return `m:${milestone}`;
  if (
    s.current >= 1 &&
    s.lastCountedDay !== todayLocalDay &&
    hour >= 17
  ) {
    return `r:${todayLocalDay}`;
  }
  return null;
}

/**
 * Recap streak section copy (Task #369). Mirrors the same caring
 * tone as `milestoneCopy` / `recoveryCopy`: never shames a missed
 * day, scales gently with the streak length, and reuses the
 * milestone copy verbatim when the user has just crossed one so
 * the wording stays consistent with the home overlay.
 *
 * Returns `null` when the streak is zero (nothing to surface — the
 * recap shouldn't render an empty card just to say "no streak").
 *
 * The "of 7" framing is a lower-bound truth: the streak is by
 * definition consecutive, so a `current` of 5 means the user
 * showed up at least 5 of the last 7 days. We never overclaim.
 */
export function recapStreakLine(
  s: StreakSnapshot,
  config: StreakConfig = DEFAULT_CONFIG,
): { title: string; body: string } | null {
  if (s.current <= 0) return null;
  const milestone = pendingMilestone(s, config);
  if (milestone !== null) {
    return milestoneCopy(milestone);
  }
  if (s.current >= 7) {
    return {
      title: `Day ${s.current} of your streak.`,
      body: "You showed up every day this week. Quietly proud of you.",
    };
  }
  const dayWord = s.current === 1 ? "day" : "days";
  return {
    title: `Day ${s.current} of your streak.`,
    body: `You showed up ${s.current} of the last 7 ${dayWord}. Tiny, steady — that's the way.`,
  };
}

// ---- analytics wrappers --------------------------------------------------

export function trackStreakStarted(current: number): void {
  trackEvent("streak_started", { current });
}

export function trackStreakIncremented(current: number, freezeUsed: boolean): void {
  trackEvent("streak_day_incremented", { current, freezeUsed });
}

export function trackStreakMilestone(milestone: number): void {
  trackEvent("streak_milestone_reached", { milestone });
}

export function trackStreakFreezeUsed(remainingFreezes: number): void {
  trackEvent("streak_freeze_used", { remainingFreezes });
}

export function trackStreakBroken(longest: number): void {
  trackEvent("streak_broken", { longest });
}

/**
 * Compare a freshly-fetched server snapshot against the previous
 * in-memory snapshot and emit the right analytics event(s) for the
 * delta. The server is the only place increment math runs, so this
 * client-side diff is the honest way to surface the documented
 * events (started, incremented, freeze_used, broken) without
 * exposing a separate "tick" endpoint a client could spam.
 *
 * `prev = null` means "first snapshot since app launch" — we don't
 * fire anything for that case (no transition to report).
 */
export function emitStreakDeltaEvents(
  prev: StreakSnapshot | null,
  next: StreakSnapshot,
): void {
  if (!prev) return;
  if (next.current === prev.current) return;
  // Streak grew.
  if (next.current > prev.current) {
    if (prev.current === 0) {
      trackStreakStarted(next.current);
    } else {
      const freezeUsed = next.freezesAvailable < prev.freezesAvailable;
      trackStreakIncremented(next.current, freezeUsed);
      if (freezeUsed) trackStreakFreezeUsed(next.freezesAvailable);
    }
    return;
  }
  // Streak reset to 1 (or 0) → broken. The server caps `current`
  // back to 1 when the user captures on a non-consecutive day, so
  // a drop is always a break.
  trackStreakBroken(prev.longest);
  if (next.current === 1) {
    trackStreakStarted(1);
  }
}
