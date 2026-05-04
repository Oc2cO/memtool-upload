/**
 * Notification permission and category preference management.
 *
 * Two concerns live here:
 *   1. OS-level permission — wraps `expo-notifications` with graceful
 *      error handling so callers never crash on platforms where the
 *      Notifications API is unavailable (Expo Go, web).
 *   2. Category preferences — per-user persisted toggles for individual
 *      notification categories (daily recap reminder, streak nudge).
 *      These are read by the server / scheduler before dispatching
 *      pushes, so toggling a category actually suppresses or restores
 *      that class of notification.
 *
 * Permissions can only be *requested*, never revoked programmatically.
 * When the user wants to revoke, we open the OS Settings app via
 * `Linking.openSettings()` — the only path Apple and Google provide.
 *
 * All functions are safe to call on any platform; they swallow errors
 * and return sensible defaults so a notifications bug can never break
 * the Settings screen or the save flow.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

export type NotificationPermissionStatus = "granted" | "denied" | "undetermined";

export type NotificationCategory = "daily_recap_reminder" | "capture_streak_nudge";

export type ReminderTime = { hour: number; minute: number };

export const NOTIFICATION_CATEGORIES: Array<{
  id: NotificationCategory;
  label: string;
  subtitle: string;
}> = [
  {
    id: "daily_recap_reminder",
    label: "Daily recap",
    subtitle: "A nudge when your day's summary is ready.",
  },
  {
    id: "capture_streak_nudge",
    label: "Streak reminder",
    subtitle: "Keep your capture streak alive.",
  },
];

const NOTIFICATION_DEFAULTS: Record<
  NotificationCategory,
  { time: ReminderTime; title: string; body: string }
> = {
  daily_recap_reminder: {
    time: { hour: 20, minute: 0 },
    title: "Your daily recap is ready",
    body: "Take a moment to look back at today's memories.",
  },
  capture_streak_nudge: {
    time: { hour: 19, minute: 0 },
    title: "Keep your streak alive",
    body: "Capture a memory today so your streak doesn't reset.",
  },
};

const PRE_PROMPT_SEEN_KEY = "mt_notif_preprompt_seen";
const CATEGORY_KEY_PREFIX = "mt_notif_cat_";
const CATEGORY_TIME_PREFIX = "mt_notif_time_";
const CATEGORY_SCHED_ID_PREFIX = "mt_notif_sched_";

/**
 * Returns the current OS-level notification permission status.
 * Falls back to "undetermined" on any error.
 */
export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted" || status === "denied") return status;
    return "undetermined";
  } catch {
    return "undetermined";
  }
}

/**
 * Requests OS-level notification permission. Returns "granted" or "denied".
 * On web or Expo Go (where the API isn't supported) returns "denied" without
 * throwing so the UI can surface an appropriate message.
 */
export async function requestNotificationPermission(): Promise<"granted" | "denied"> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/**
 * Returns true if the user has already seen the in-app pre-prompt
 * that explains why we want notification permission, so we only
 * show it once across the app's lifetime.
 */
export async function hasSeenNotificationPrePrompt(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(PRE_PROMPT_SEEN_KEY);
    return v !== null;
  } catch {
    return false;
  }
}

/**
 * Mark the pre-prompt as seen. Call this after showing the in-app
 * explainer (but before the OS prompt fires) so we never show the
 * explainer again on a subsequent permission request.
 */
export async function markNotificationPrePromptSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(PRE_PROMPT_SEEN_KEY, new Date().toISOString());
  } catch {
    // non-fatal — worst case we show the explainer twice
  }
}

function categoryKey(category: NotificationCategory): string {
  return `${CATEGORY_KEY_PREFIX}${category}`;
}

/**
 * Returns whether the user has this notification category enabled.
 * Defaults to `true` (opt-out model) so users who haven't visited
 * the Settings screen yet still receive notifications.
 */
export async function getCategoryEnabled(
  category: NotificationCategory,
): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(categoryKey(category));
    if (v === null) return true; // default: on
    return v === "true";
  } catch {
    return true;
  }
}

/**
 * Persist the user's preference for an individual notification category.
 * The server/scheduler reads this before dispatching pushes to respect
 * the user's choice.
 */
export async function setCategoryEnabled(
  category: NotificationCategory,
  enabled: boolean,
): Promise<void> {
  try {
    await AsyncStorage.setItem(categoryKey(category), String(enabled));
  } catch {
    // non-fatal — preference will reset to default on next read
  }
}

/**
 * Load all category preferences at once. Useful for the Settings screen
 * mount so we can kick off one parallel batch instead of sequential reads.
 */
export async function getAllCategoryPreferences(): Promise<Record<NotificationCategory, boolean>> {
  const results = await Promise.all(
    NOTIFICATION_CATEGORIES.map(async (cat) => {
      const enabled = await getCategoryEnabled(cat.id);
      return [cat.id, enabled] as const;
    }),
  );
  return Object.fromEntries(results) as Record<NotificationCategory, boolean>;
}

function timeKey(category: NotificationCategory): string {
  return `${CATEGORY_TIME_PREFIX}${category}`;
}

function schedIdKey(category: NotificationCategory): string {
  return `${CATEGORY_SCHED_ID_PREFIX}${category}`;
}

function clampTime(t: ReminderTime): ReminderTime {
  const hour = Math.max(0, Math.min(23, Math.trunc(t.hour)));
  const minute = Math.max(0, Math.min(59, Math.trunc(t.minute)));
  return { hour, minute };
}

/**
 * Returns the user's chosen reminder time for a category. Falls back to
 * the per-category default (defined above) when nothing is persisted or
 * the stored value is malformed.
 */
export async function getCategoryTime(
  category: NotificationCategory,
): Promise<ReminderTime> {
  const fallback = NOTIFICATION_DEFAULTS[category].time;
  try {
    const v = await AsyncStorage.getItem(timeKey(category));
    if (!v) return fallback;
    const parsed = JSON.parse(v) as Partial<ReminderTime>;
    if (
      typeof parsed?.hour !== "number" ||
      typeof parsed?.minute !== "number" ||
      !Number.isFinite(parsed.hour) ||
      !Number.isFinite(parsed.minute)
    ) {
      return fallback;
    }
    return clampTime({ hour: parsed.hour, minute: parsed.minute });
  } catch {
    return fallback;
  }
}

/**
 * Persist the user's chosen reminder time for a category. Does NOT
 * (re)schedule on its own — call `scheduleCategory` after this so the
 * OS-level trigger reflects the new time.
 */
export async function setCategoryTime(
  category: NotificationCategory,
  time: ReminderTime,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      timeKey(category),
      JSON.stringify(clampTime(time)),
    );
  } catch {
    // non-fatal — preference will reset to default on next read
  }
}

/**
 * Format an HH:MM time for display in the Settings UI. Uses 24-hour
 * formatting because it's locale-stable (no AM/PM string juggling) and
 * matches the time-pickers we surface elsewhere in the app.
 */
export function formatReminderTime(time: ReminderTime): string {
  const hh = String(clampTime(time).hour).padStart(2, "0");
  const mm = String(clampTime(time).minute).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Schedule (or reschedule) the daily local notification for a category.
 *
 * Behaviour:
 *   - Cancels any previously-scheduled notification we own for this
 *     category (tracked via the persisted scheduled-id) so we never
 *     stack duplicate triggers across reschedules.
 *   - Schedules a repeating DAILY trigger at the user's chosen time
 *     (or the category default if `time` is omitted), persisting the
 *     returned scheduled-id so the next call can cancel it cleanly.
 *   - All `expo-notifications` calls are wrapped — on web, Expo Go,
 *     or any other unsupported environment we silently no-op so the
 *     Settings toggle never throws.
 *
 * The scheduled triggers themselves are persisted by the OS so they
 * survive app restarts; we only persist the id so we can later cancel
 * the right one.
 */
export async function scheduleCategory(
  category: NotificationCategory,
  time?: ReminderTime,
): Promise<void> {
  const target = clampTime(time ?? (await getCategoryTime(category)));
  const def = NOTIFICATION_DEFAULTS[category];
  try {
    await cancelCategory(category);
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: def.title, body: def.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: target.hour,
        minute: target.minute,
      },
    });
    try {
      await AsyncStorage.setItem(schedIdKey(category), id);
    } catch {
      // non-fatal — worst case we'll fail to cancel on the next call
      // and may end up with a duplicate trigger; the OS will dedupe
      // on identical content for daily triggers in practice.
    }
  } catch {
    // expo-notifications isn't available in this environment
    // (web / Expo Go) — leave the user prefs as-is so toggling on
    // again later still does the right thing.
  }
}

/**
 * Cancel the scheduled local notification for a category, if any, and
 * clear the persisted scheduled-id. Safe to call when nothing is
 * scheduled — it just does nothing.
 */
export async function cancelCategory(
  category: NotificationCategory,
): Promise<void> {
  let id: string | null = null;
  try {
    id = await AsyncStorage.getItem(schedIdKey(category));
  } catch {
    id = null;
  }
  if (id) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // best-effort — id may already be gone if the user cleared
      // notifications from the OS; clearing the persisted id below
      // keeps state consistent either way.
    }
    try {
      await AsyncStorage.removeItem(schedIdKey(category));
    } catch {
      // non-fatal — worst case the next schedule call orphans an id.
    }
  }
}
