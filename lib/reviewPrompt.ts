import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";

/**
 * In-app App Store rating prompt orchestration.
 *
 * Apple's `SKStoreReviewController` (wrapped by `expo-store-review`)
 * is the ONLY supported way to ask for a rating in-app — Apple
 * caps it to three system-level shows per 365 days per device, and
 * we layer our own once-per-account guard on top so a re-install
 * doesn't burn one of those system shows on the same user twice.
 *
 * Critical Apple rules this module enforces:
 *  1. Never ask immediately on first launch. We require ≥ 7 days of
 *     account life via `recordAccountFirstSeen` + at least 5 saved
 *     memories AND 3 distinct app-open days before asking.
 *  2. Never reward review behavior. The trigger is gated only on
 *     time and engagement; the prompt itself just hands off to
 *     Apple's sheet, which the user can dismiss with no consequence.
 *     We never display "leave 5 stars" copy, never tie features to
 *     reviews, and never preempt Apple's sheet with our own
 *     "would you like to rate us?" interstitial.
 *  3. Short-circuit when `StoreReview.isAvailableAsync()` is false
 *     (e.g. dev simulators, web, Expo Go in-process where the API
 *     can't actually present a sheet) so we don't burn an account
 *     "asked" flag without ever showing anything.
 *
 * Account-scoped key (`mt_review_asked_<email>`) instead of a
 * device-wide key because shared devices in the household are real
 * (Apple's review explicitly allows family sharing of paid apps),
 * and one user's "we asked" shouldn't suppress a different user's
 * legitimate prompt.
 */

const FIRST_SEEN_PREFIX = "mt_account_first_seen_";
const ASKED_PREFIX = "mt_review_asked_";
const SAVES_COUNT_PREFIX = "mt_review_saves_";
const OPEN_DAYS_PREFIX = "mt_review_open_days_";

const MIN_ACCOUNT_AGE_DAYS = 7;
const MIN_SAVES = 5;
const MIN_OPEN_DAYS = 3;

function firstSeenKey(email: string): string {
  return `${FIRST_SEEN_PREFIX}${email}`;
}

function askedKey(email: string): string {
  return `${ASKED_PREFIX}${email}`;
}

function savesKey(email: string): string {
  return `${SAVES_COUNT_PREFIX}${email}`;
}

function openDaysKey(email: string): string {
  return `${OPEN_DAYS_PREFIX}${email}`;
}

/**
 * Record the first time we observe an authenticated session for
 * `email`. Idempotent — once a value exists it's never overwritten,
 * so the account-age clock starts from the very first sign-in we
 * saw on this device. Safe to call from auth state changes; cheap.
 */
export async function recordAccountFirstSeen(email: string): Promise<void> {
  try {
    const key = firstSeenKey(email);
    const existing = await AsyncStorage.getItem(key);
    if (existing) return;
    await AsyncStorage.setItem(key, new Date().toISOString());
  } catch {
    // AsyncStorage write failures are non-fatal; we'll just retry
    // setting the timestamp on the next sign-in.
  }
}

/**
 * Record that the user saved a memory. Increments a per-account
 * counter used by `maybeRequestReview` to check the MIN_SAVES gate.
 * Safe to call on every save; cheap.
 */
export async function recordMemorySaved(email: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(savesKey(email));
    const count = raw ? (parseInt(raw, 10) || 0) : 0;
    await AsyncStorage.setItem(savesKey(email), String(count + 1));
  } catch {
    // non-fatal
  }
}

/**
 * Record that the app was opened (foregrounded) for today's date.
 * Adds the current calendar date to a per-account set of distinct days.
 * Safe to call on every foreground event; already-seen dates are skipped.
 */
export async function recordAppOpen(email: string): Promise<void> {
  try {
    const today = new Date().toDateString(); // e.g. "Fri May 02 2025"
    const raw = await AsyncStorage.getItem(openDaysKey(email));
    const days: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (days.includes(today)) return;
    days.push(today);
    await AsyncStorage.setItem(openDaysKey(email), JSON.stringify(days));
  } catch {
    // non-fatal
  }
}

/**
 * Days since the first sign-in we observed for this email. Returns
 * `null` if we never recorded a first-seen (e.g. brand-new login
 * where `recordAccountFirstSeen` hasn't run yet) so the caller can
 * gracefully skip the prompt instead of treating "no record" as
 * "infinitely old".
 */
async function getAccountAgeDays(email: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(firstSeenKey(email));
    if (!raw) return null;
    const ts = new Date(raw).getTime();
    if (Number.isNaN(ts)) return null;
    return (Date.now() - ts) / (1000 * 60 * 60 * 24);
  } catch {
    return null;
  }
}

async function getSavesCount(email: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(savesKey(email));
    return raw ? (parseInt(raw, 10) || 0) : 0;
  } catch {
    return 0;
  }
}

async function getDistinctOpenDays(email: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(openDaysKey(email));
    const days: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    return days.length;
  } catch {
    return 0;
  }
}

async function hasAlreadyAsked(email: string): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(askedKey(email));
    return v !== null;
  } catch {
    return false;
  }
}

async function markAsAsked(email: string): Promise<void> {
  try {
    await AsyncStorage.setItem(askedKey(email), new Date().toISOString());
  } catch {
    // If we can't persist, the worst case is we ask again on a
    // future trigger — Apple's own throttle is the real ceiling.
  }
}

/**
 * Try to show Apple's rating sheet. Returns the outcome so the
 * caller can log it for telemetry, but no caller actually needs to
 * branch on it — the function is fire-and-forget by design.
 *
 * Outcome semantics:
 *   - "shown"       — we successfully invoked Apple's sheet. Apple
 *                     decides whether to actually present anything
 *                     based on its own throttle; we treat any
 *                     non-throwing call as "shown" because the SDK
 *                     gives us no other signal.
 *   - "skipped"     — short-circuited by one of our gates (already
 *                     asked, account too young, not enough saves/opens,
 *                     sheet unavailable). Not an error.
 *   - "unsupported" — `StoreReview.isAvailableAsync()` returned
 *                     false. Common on simulator/web; we don't even
 *                     mark the account as asked in this case.
 *   - "error"       — the SDK threw. Logged in dev only; we DO NOT
 *                     mark the account as asked, so the next valid
 *                     trigger gets another chance.
 */
export type ReviewPromptOutcome =
  | "shown"
  | "skipped"
  | "unsupported"
  | "error";

export async function maybeRequestReview(
  email: string | null | undefined,
): Promise<ReviewPromptOutcome> {
  if (!email) return "skipped";
  if (await hasAlreadyAsked(email)) return "skipped";

  // All three engagement gates must pass in parallel for speed.
  const [ageDays, saves, openDays] = await Promise.all([
    getAccountAgeDays(email),
    getSavesCount(email),
    getDistinctOpenDays(email),
  ]);

  if (ageDays === null || ageDays < MIN_ACCOUNT_AGE_DAYS) return "skipped";
  if (saves < MIN_SAVES) return "skipped";
  if (openDays < MIN_OPEN_DAYS) return "skipped";

  let available = false;
  try {
    available = await StoreReview.isAvailableAsync();
  } catch {
    return "unsupported";
  }
  if (!available) return "unsupported";
  try {
    await StoreReview.requestReview();
    await markAsAsked(email);
    return "shown";
  } catch (err) {
    if (__DEV__) console.log("[reviewPrompt] requestReview failed", err);
    return "error";
  }
}
