import AsyncStorage from "@react-native-async-storage/async-storage";

import { FREE_DAILY_AI_GUIDE_LIMIT } from "./subscription";

/**
 * Daily message-cap math + persistence for the AI Guide chat surface.
 *
 * Free users are capped at FREE_DAILY_AI_GUIDE_LIMIT messages per
 * local-midnight day. Pro users bypass entirely. The counter is
 * stored in AsyncStorage keyed by the local ISO date so a date
 * rollover automatically resets without a background job — same
 * "today is wall-clock day" semantic the capture cap uses.
 *
 * Mirrors the captureLimits.ts shape (atLimit / remainingToday /
 * limit) so future contributors can reason about both quotas the
 * same way. The cap value lives in subscription.ts next to
 * FREE_DAILY_CAPTURE_LIMIT for the same reason.
 *
 * Defense-in-depth note: this is a calm UX gate, not a payments
 * boundary. Polsia does not yet enforce its own per-day chat quota,
 * but if/when it does we'll add a server-error pass-through here in
 * the same shape as `SERVER_CAPTURE_LIMIT_CODE` in subscription.ts.
 */

const COUNTER_KEY = "mt_ai_guide_count_v1";

export interface AiGuideCounter {
  /** Local ISO day (YYYY-MM-DD) the count belongs to. */
  date: string;
  /** Messages sent by the user on `date`. Always >= 0. */
  count: number;
}

export interface AiGuideLimitState {
  isPro: boolean;
  sentToday: number;
  remainingToday: number;
  atLimit: boolean;
  limit: number;
}

/**
 * Local-midnight YYYY-MM-DD. Same cutoff semantic as
 * `isTimestampToday` in captureLimits.ts — what the user considers
 * "today" in their wall-clock day, not UTC.
 */
export function localIsoDay(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Pure cap math — no React, no fetch. Pass `isPro=false` while
 * subscription status is loading so a stale render can't briefly
 * let a free user past the cap.
 */
export function getAiGuideLimitState(
  sentToday: number,
  isPro: boolean,
): AiGuideLimitState {
  const limit = FREE_DAILY_AI_GUIDE_LIMIT;
  const safeSent = Number.isFinite(sentToday) && sentToday > 0
    ? Math.floor(sentToday)
    : 0;
  const remainingToday = Math.max(0, limit - safeSent);
  const atLimit = !isPro && safeSent >= limit;
  return { isPro, sentToday: safeSent, remainingToday, atLimit, limit };
}

/**
 * Read the persisted counter. If the persisted date is not today's
 * local ISO day we return a fresh zero-count for today so callers
 * can treat the read as already-reset on date rollover. Corrupt /
 * missing / wrong-shape JSON also collapses to zero — safer to give
 * the user one extra free message than to crash the screen.
 */
export async function loadAiGuideCounter(
  now: Date = new Date(),
): Promise<AiGuideCounter> {
  const today = localIsoDay(now);
  try {
    const raw = await AsyncStorage.getItem(COUNTER_KEY);
    if (!raw) return { date: today, count: 0 };
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { date?: unknown }).date === "string" &&
      typeof (parsed as { count?: unknown }).count === "number" &&
      Number.isFinite((parsed as { count: number }).count) &&
      (parsed as { count: number }).count >= 0
    ) {
      const persistedDate = (parsed as { date: string }).date;
      const persistedCount = Math.floor((parsed as { count: number }).count);
      if (persistedDate === today) {
        return { date: today, count: persistedCount };
      }
      return { date: today, count: 0 };
    }
  } catch {
    // fall through to safe default
  }
  return { date: today, count: 0 };
}

/**
 * Increment today's counter and persist. Returns the post-increment
 * counter so the caller can update its in-memory state without a
 * second AsyncStorage round-trip. AsyncStorage write failures are
 * swallowed — at worst the user gets one extra message.
 */
export async function bumpAiGuideCounter(
  now: Date = new Date(),
): Promise<AiGuideCounter> {
  const current = await loadAiGuideCounter(now);
  const next: AiGuideCounter = {
    date: current.date,
    count: current.count + 1,
  };
  try {
    await AsyncStorage.setItem(COUNTER_KEY, JSON.stringify(next));
  } catch {
    // best-effort
  }
  return next;
}

/** Wipe the counter (used by tests and any future "reset cap" admin). */
export async function resetAiGuideCounter(): Promise<void> {
  try {
    await AsyncStorage.removeItem(COUNTER_KEY);
  } catch {
    // ignore
  }
}
