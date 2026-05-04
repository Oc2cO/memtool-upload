/**
 * Single source of truth for the free-tier daily capture cap math.
 *
 * Every screen and context that reasons about "how many captures has
 * the user made today" and "are they at the cap" goes through this
 * file. Keeping the calculation in one place avoids the most common
 * quota-system bug — UI thinks the user has 1 left, the data layer
 * thinks they're at 0, and the two layers disagree about whether
 * Save should work.
 *
 * Used by:
 *   - app/(app)/(tabs)/index.tsx       (Layer 1 home hint)
 *   - app/(app)/capture.tsx            (Layer 2 form gate)
 *   - app/(app)/log-call.tsx           (Layer 2 form gate)
 *   - context/MemoriesContext.tsx      (Layer 3 data-layer throw +
 *                                       todayMemories filter)
 *
 * The "today" boundary is local-device midnight. That's intentional:
 * the user mental-models "10/day" against their wall-clock day, not
 * UTC. Edge case: a traveler who crosses a date line mid-day will see
 * the cutoff shift. Acceptable for v1; revisit only if real users
 * report it.
 *
 * Server-side enforcement (the 4th layer) is tracked as a separate
 * follow-up ("Enforce the free daily capture cap on the server too" /
 * "Block free-tier capture limit bypass on the server") and will
 * mirror this same shape: `SERVER_CAPTURE_LIMIT_CODE` in
 * `./subscription.ts` is the agreed-upon `code` literal returned in
 * the 402 body so the client → server contract stays in lockstep.
 * Client-side handling of that 402 is already wired in
 * `lib/memories.ts::apiCreateMemory` and locked by `memories.test.ts`.
 */

import {
  FREE_DAILY_CAPTURE_LIMIT,
  FREE_LIBRARY_DAYS,
  PRO_LIBRARY_DAYS,
} from "./subscription";

export interface CaptureLimitState {
  isPro: boolean;
  capturesToday: number;
  remainingToday: number;
  atLimit: boolean;
  limit: number;
}

/**
 * Local-midnight "today" check used by both the `todayMemories`
 * filter in MemoriesContext and the cap-check inside `addMemory`.
 * Centralized so the two cannot drift — if a render uses one
 * definition of "today" and a save uses another, the user can hit a
 * Save that throws after the UI showed they were under the cap.
 */
export function isTimestampToday(isoTimestamp: string): boolean {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return new Date(isoTimestamp) >= todayStart;
}

/**
 * Device-local calendar day as a `YYYY-MM-DD` string. This is the
 * single source of truth for the "what day is it for the user" key
 * we send to the server alongside cap-check requests, so the
 * server's claim store buckets by the same wall-clock day the
 * device's gates already use (`isTimestampToday` above). Without
 * this, a Tokyo or Sydney user would see their cap reset partway
 * through their day when UTC midnight rolls over.
 *
 * Format is intentionally fixed-width (no timezone suffix, no
 * trailing chars) so the server-side regex validator stays tight
 * and so the key is stable across DST shifts within a day.
 */
export function getLocalDayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Compute the cap state from a today-count and a Pro flag. Pure —
 * no React, no fetches — so it's safe to call from any layer.
 *
 * `atLimit` short-circuits to `false` for Pro users so the home
 * screen never accidentally shows a Pro user the lock UI even if
 * they somehow exceed the free cap.
 *
 * Pass a conservative-default `isPro = false` while subscription
 * status is loading. A loaded Pro user flips past the cap on the
 * next render.
 *
 * `liveLimit` (Task #144) is the active server-side cap as last
 * reported by `/subscription/entitlement`. Pass it from
 * `useSubscription().freeDailyCaptureLimit` so the on-device
 * counter and upsell timing reflect on-call's
 * `FREE_DAILY_CAPTURE_LIMIT` override during a promotion. Defaults
 * to the compiled-in `FREE_DAILY_CAPTURE_LIMIT` so a stale render
 * before the entitlement fetch lands (or a fully offline launch
 * with no persisted cap) still gets a sensible value. Anything
 * that isn't a positive integer collapses to the compiled-in
 * constant — better to under-show by 1 capture than render
 * nonsense like "X of 0 left".
 */
export function getCaptureLimitState(
  capturesToday: number,
  isPro: boolean,
  liveLimit: number = FREE_DAILY_CAPTURE_LIMIT,
): CaptureLimitState {
  const limit =
    Number.isInteger(liveLimit) && liveLimit >= 1
      ? liveLimit
      : FREE_DAILY_CAPTURE_LIMIT;
  const remainingToday = Math.max(0, limit - capturesToday);
  const atLimit = !isPro && capturesToday >= limit;
  return {
    isPro,
    capturesToday,
    remainingToday,
    atLimit,
    limit,
  };
}

/**
 * Per-tier "library window" math — the read/edit horizon enforced by
 * the Archive list and `MemoriesContext.updateMemory`. Free users see
 * their last `FREE_LIBRARY_DAYS` (7); Pro users see their last
 * `PRO_LIBRARY_DAYS` (31). Anything older renders as a locked preview
 * tease and cannot be edited.
 *
 * Pure (no React, no fetches) so it can run from any layer:
 *   - the Archive list uses it to decide which cards render as
 *     `LockedMemoryCard`,
 *   - `MemoriesContext.updateMemory` uses it to throw a discriminated
 *     `LibraryWindowLockedError` instead of writing past the cap,
 *   - the search path uses it to display the locked tease for
 *     out-of-window matches.
 *
 * Conservative defaults:
 *   - Pass `isPro = false` while subscription status is loading so a
 *     stale render can't briefly show locked items as editable. When
 *     status loads, the next render upgrades the window without any
 *     extra wiring.
 *   - An invalid timestamp returns `{ visible: false, editable: false,
 *     lockedReason: "Invalid date" }`. Better to show the locked tease
 *     than silently let an unparseable card pass.
 *
 * `lockedReason` is a short user-readable string the locked-card UI
 * surfaces directly, e.g. "older than your 7-day free window". The
 * specific phrasing is here (not the UI) so any future tier addition
 * (e.g. team plan with 365 days) flows through one switch instead of
 * being duplicated across screens.
 */
export interface LibraryWindowState {
  visible: boolean;
  editable: boolean;
  lockedReason: string | null;
  windowDays: number;
  ageDays: number;
}

/**
 * Single source of truth for the per-day illustration quota math
 * and wording. Mirrors the captureLimits shape (atLimit /
 * remainingToday / limit) so contributors can reason about both
 * quotas the same way.
 *
 * Used by:
 *   - app/(app)/(tabs)/index.tsx     (home hint row)
 *   - app/(app)/(tabs)/archive.tsx   (per-row Illustrate footer meter)
 *   - app/(app)/capture.tsx          (post-save confirmation card)
 *
 * Without this helper the three surfaces inlined `Math.max(0, limit -
 * used)` plus their own copy of "X of Y illustrations left today",
 * which meant a wording change on one surface (pluralization, "left"
 * vs "remaining", the upsell sentence) silently drifted the others.
 *
 * Inputs:
 *   - `usedToday` is the server-reported "illustrations consumed
 *     today" count from `MemoriesContext.illustrationsUsedToday`.
 *     Anything that isn't a non-negative finite integer collapses to
 *     zero — better to show the user one extra slot than to render a
 *     negative meter.
 *   - `limit` is the server-reported per-tier daily cap from
 *     `MemoriesContext.illustrationsLimit`. `null` is the agreed-upon
 *     "unlimited / Pro user" sentinel and hides the row entirely.
 *   - `isPro` is read from `useSubscription().status?.is_pro`. Default
 *     to `false` while subscription status is loading so a stale
 *     render can't briefly leak the upsell to a Pro user; once status
 *     loads, the next render hides the row.
 *
 * `visible` collapses both gates ("free tier" AND "server gave us a
 * cap") into one flag so screens don't duplicate the conditional.
 *
 * `atLimit` short-circuits to `false` for Pro users for the same
 * reason `getCaptureLimitState` does.
 *
 * `label` and `upsellLabel` are the two user-facing strings the
 * quota row can show. Holding them here (instead of inlining a
 * template literal in each screen) is the whole point of this
 * helper: a wording tweak now lands in one file. Pluralization
 * tracks the cap (`limit`), not `remainingToday`, matching the
 * pre-helper home-screen semantic — "1 of 1 illustration left
 * today" reads as singular, "0 of 3 illustrations left today"
 * stays plural even at zero remaining. Keying off the cap means
 * the noun doesn't flicker between singular and plural as the
 * counter ticks down.
 */
export interface IllustrationQuotaState {
  visible: boolean;
  isPro: boolean;
  usedToday: number;
  remainingToday: number;
  atLimit: boolean;
  limit: number | null;
  label: string;
  upsellLabel: string;
}

export const ILLUSTRATION_UPSELL_LABEL =
  "Upgrade for unlimited illustrations";

export const ILLUSTRATION_OUT_TOAST =
  "Out of illustrations today — upgrade for more";

export const ILLUSTRATION_OUT_INLINE = "Out of illustrations today";

export function getIllustrationQuotaState(
  usedToday: number,
  limit: number | null,
  isPro: boolean,
): IllustrationQuotaState {
  const safeUsed =
    Number.isFinite(usedToday) && usedToday > 0 ? Math.floor(usedToday) : 0;
  const hasNumericLimit =
    typeof limit === "number" && Number.isFinite(limit) && limit >= 0;
  const safeLimit = hasNumericLimit ? Math.floor(limit as number) : null;
  const visible = !isPro && safeLimit !== null;
  const remainingToday =
    safeLimit === null ? 0 : Math.max(0, safeLimit - safeUsed);
  const atLimit = !isPro && safeLimit !== null && safeUsed >= safeLimit;
  const noun = safeLimit === 1 ? "illustration" : "illustrations";
  const label =
    safeLimit === null
      ? ""
      : `${remainingToday} of ${safeLimit} ${noun} left today`;
  return {
    visible,
    isPro,
    usedToday: safeUsed,
    remainingToday,
    atLimit,
    limit: safeLimit,
    label,
    upsellLabel: ILLUSTRATION_UPSELL_LABEL,
  };
}

export function getLibraryWindowState(
  isoTimestamp: string,
  isPro: boolean,
  now: Date = new Date(),
): LibraryWindowState {
  const windowDays = isPro ? PRO_LIBRARY_DAYS : FREE_LIBRARY_DAYS;
  const ts = new Date(isoTimestamp).getTime();
  if (Number.isNaN(ts)) {
    return {
      visible: false,
      editable: false,
      lockedReason: "Invalid date",
      windowDays,
      ageDays: Number.POSITIVE_INFINITY,
    };
  }
  const ageMs = now.getTime() - ts;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Future-dated memories (clock skew, manual override) are treated
  // as in-window — better than silently locking a brand-new entry.
  const inWindow = ageDays <= windowDays;
  if (inWindow) {
    return {
      visible: true,
      editable: true,
      lockedReason: null,
      windowDays,
      ageDays,
    };
  }
  return {
    visible: true,
    editable: false,
    lockedReason: isPro
      ? `older than your ${windowDays}-day Pro window`
      : `older than your ${windowDays}-day free window`,
    windowDays,
    ageDays,
  };
}
