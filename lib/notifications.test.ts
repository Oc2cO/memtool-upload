/**
 * Unit tests for `lib/notifications.ts` (Task #300).
 *
 * Covers:
 *   1. `getNotificationPermissionStatus` — returns correct status from
 *      expo-notifications; falls back to "undetermined" on error.
 *   2. `requestNotificationPermission` — returns "granted" / "denied";
 *      falls back to "denied" on error.
 *   3. `hasSeenNotificationPrePrompt` / `markNotificationPrePromptSeen`
 *      — persists and reads the seen flag correctly.
 *   4. `getCategoryEnabled` / `setCategoryEnabled` — default opt-out
 *      model; persists and reads category prefs correctly.
 *   5. `getAllCategoryPreferences` — returns defaults when nothing is
 *      persisted; reads all categories in one batch.
 */

const mockGetItem = jest.fn();
const mockSetItem = jest.fn().mockResolvedValue(undefined);
const mockRemoveItem = jest.fn().mockResolvedValue(undefined);

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
  removeItem: (key: string) => mockRemoveItem(key),
}));

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockSchedule = jest.fn();
const mockCancel = jest.fn().mockResolvedValue(undefined);

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: () => mockGetPermissions(),
  requestPermissionsAsync: () => mockRequestPermissions(),
  scheduleNotificationAsync: (input: unknown) => mockSchedule(input),
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  SchedulableTriggerInputTypes: { DAILY: "daily" },
}));

import {
  cancelCategory,
  formatReminderTime,
  getAllCategoryPreferences,
  getCategoryEnabled,
  getCategoryTime,
  getNotificationPermissionStatus,
  hasSeenNotificationPrePrompt,
  markNotificationPrePromptSeen,
  requestNotificationPermission,
  scheduleCategory,
  setCategoryEnabled,
  setCategoryTime,
} from "./notifications";

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
});

describe("getNotificationPermissionStatus", () => {
  test("returns 'granted' when permission is granted", async () => {
    mockGetPermissions.mockResolvedValueOnce({ status: "granted" });
    expect(await getNotificationPermissionStatus()).toBe("granted");
  });

  test("returns 'denied' when permission is denied", async () => {
    mockGetPermissions.mockResolvedValueOnce({ status: "denied" });
    expect(await getNotificationPermissionStatus()).toBe("denied");
  });

  test("returns 'undetermined' when permission is undetermined", async () => {
    mockGetPermissions.mockResolvedValueOnce({ status: "undetermined" });
    expect(await getNotificationPermissionStatus()).toBe("undetermined");
  });

  test("returns 'undetermined' on API error (safe fallback)", async () => {
    mockGetPermissions.mockRejectedValueOnce(new Error("API unavailable"));
    expect(await getNotificationPermissionStatus()).toBe("undetermined");
  });
});

describe("requestNotificationPermission", () => {
  test("returns 'granted' when OS grants permission", async () => {
    mockRequestPermissions.mockResolvedValueOnce({ status: "granted" });
    expect(await requestNotificationPermission()).toBe("granted");
  });

  test("returns 'denied' when OS denies permission", async () => {
    mockRequestPermissions.mockResolvedValueOnce({ status: "denied" });
    expect(await requestNotificationPermission()).toBe("denied");
  });

  test("returns 'denied' on API error (safe fallback)", async () => {
    mockRequestPermissions.mockRejectedValueOnce(new Error("Not supported"));
    expect(await requestNotificationPermission()).toBe("denied");
  });
});

describe("hasSeenNotificationPrePrompt / markNotificationPrePromptSeen", () => {
  test("returns false when pre-prompt has not been shown", async () => {
    mockGetItem.mockResolvedValueOnce(null);
    expect(await hasSeenNotificationPrePrompt()).toBe(false);
  });

  test("returns true after markNotificationPrePromptSeen is called", async () => {
    mockGetItem.mockResolvedValueOnce("2025-01-01T00:00:00.000Z");
    expect(await hasSeenNotificationPrePrompt()).toBe(true);
  });

  test("markNotificationPrePromptSeen writes to AsyncStorage", async () => {
    await markNotificationPrePromptSeen();
    expect(mockSetItem).toHaveBeenCalledWith(
      "mt_notif_preprompt_seen",
      expect.any(String),
    );
  });
});

describe("getCategoryEnabled / setCategoryEnabled", () => {
  test("returns true by default (opt-out model) when nothing stored", async () => {
    mockGetItem.mockResolvedValueOnce(null);
    expect(await getCategoryEnabled("daily_recap_reminder")).toBe(true);
  });

  test("returns stored value when persisted as false", async () => {
    mockGetItem.mockResolvedValueOnce("false");
    expect(await getCategoryEnabled("capture_streak_nudge")).toBe(false);
  });

  test("returns stored value when persisted as true", async () => {
    mockGetItem.mockResolvedValueOnce("true");
    expect(await getCategoryEnabled("daily_recap_reminder")).toBe(true);
  });

  test("setCategoryEnabled writes to AsyncStorage with correct key", async () => {
    await setCategoryEnabled("daily_recap_reminder", false);
    expect(mockSetItem).toHaveBeenCalledWith(
      "mt_notif_cat_daily_recap_reminder",
      "false",
    );
  });

  test("setCategoryEnabled(true) writes 'true' string", async () => {
    await setCategoryEnabled("capture_streak_nudge", true);
    expect(mockSetItem).toHaveBeenCalledWith(
      "mt_notif_cat_capture_streak_nudge",
      "true",
    );
  });
});

describe("getCategoryTime / setCategoryTime", () => {
  test("returns default time (20:00) for daily_recap_reminder when nothing stored", async () => {
    mockGetItem.mockResolvedValueOnce(null);
    expect(await getCategoryTime("daily_recap_reminder")).toEqual({
      hour: 20,
      minute: 0,
    });
  });

  test("returns default time (19:00) for capture_streak_nudge when nothing stored", async () => {
    mockGetItem.mockResolvedValueOnce(null);
    expect(await getCategoryTime("capture_streak_nudge")).toEqual({
      hour: 19,
      minute: 0,
    });
  });

  test("returns persisted time when stored", async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify({ hour: 7, minute: 30 }),
    );
    expect(await getCategoryTime("daily_recap_reminder")).toEqual({
      hour: 7,
      minute: 30,
    });
  });

  test("returns default when stored value is malformed JSON", async () => {
    mockGetItem.mockResolvedValueOnce("not json");
    expect(await getCategoryTime("daily_recap_reminder")).toEqual({
      hour: 20,
      minute: 0,
    });
  });

  test("returns default when stored value missing required fields", async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify({ foo: 1 }));
    expect(await getCategoryTime("daily_recap_reminder")).toEqual({
      hour: 20,
      minute: 0,
    });
  });

  test("clamps out-of-range hour/minute on read", async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify({ hour: 99, minute: -5 }),
    );
    expect(await getCategoryTime("daily_recap_reminder")).toEqual({
      hour: 23,
      minute: 0,
    });
  });

  test("setCategoryTime writes JSON-encoded time to AsyncStorage", async () => {
    await setCategoryTime("daily_recap_reminder", { hour: 9, minute: 15 });
    expect(mockSetItem).toHaveBeenCalledWith(
      "mt_notif_time_daily_recap_reminder",
      JSON.stringify({ hour: 9, minute: 15 }),
    );
  });

  test("setCategoryTime clamps before persisting", async () => {
    await setCategoryTime("capture_streak_nudge", { hour: 30, minute: 99 });
    expect(mockSetItem).toHaveBeenCalledWith(
      "mt_notif_time_capture_streak_nudge",
      JSON.stringify({ hour: 23, minute: 59 }),
    );
  });
});

describe("formatReminderTime", () => {
  test("zero-pads hour and minute", () => {
    expect(formatReminderTime({ hour: 7, minute: 5 })).toBe("07:05");
  });

  test("formats double-digit values without extra padding", () => {
    expect(formatReminderTime({ hour: 20, minute: 30 })).toBe("20:30");
  });

  test("clamps out-of-range values before formatting", () => {
    expect(formatReminderTime({ hour: -1, minute: 99 })).toBe("00:59");
  });
});

describe("scheduleCategory", () => {
  test("schedules a daily trigger with the given time and persists the id", async () => {
    mockGetItem.mockResolvedValue(null); // no existing schedule id
    mockSchedule.mockResolvedValueOnce("scheduled-id-123");

    await scheduleCategory("daily_recap_reminder", { hour: 8, minute: 30 });

    expect(mockSchedule).toHaveBeenCalledWith({
      content: expect.objectContaining({
        title: expect.any(String),
        body: expect.any(String),
      }),
      trigger: { type: "daily", hour: 8, minute: 30 },
    });
    expect(mockSetItem).toHaveBeenCalledWith(
      "mt_notif_sched_daily_recap_reminder",
      "scheduled-id-123",
    );
  });

  test("falls back to the persisted/default time when none is provided", async () => {
    mockGetItem.mockResolvedValue(null);
    mockSchedule.mockResolvedValueOnce("id-default");

    await scheduleCategory("capture_streak_nudge");

    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: { type: "daily", hour: 19, minute: 0 },
      }),
    );
  });

  test("cancels any previously-scheduled id before scheduling a new one", async () => {
    mockGetItem.mockImplementation((key: string) => {
      if (key === "mt_notif_sched_daily_recap_reminder") {
        return Promise.resolve("old-id");
      }
      return Promise.resolve(null);
    });
    mockSchedule.mockResolvedValueOnce("new-id");

    await scheduleCategory("daily_recap_reminder", { hour: 6, minute: 0 });

    expect(mockCancel).toHaveBeenCalledWith("old-id");
    expect(mockRemoveItem).toHaveBeenCalledWith(
      "mt_notif_sched_daily_recap_reminder",
    );
    expect(mockSchedule).toHaveBeenCalled();
  });

  test("silently no-ops when expo-notifications throws (e.g. web)", async () => {
    mockGetItem.mockResolvedValue(null);
    mockSchedule.mockRejectedValueOnce(new Error("unsupported"));
    await expect(
      scheduleCategory("daily_recap_reminder", { hour: 9, minute: 0 }),
    ).resolves.toBeUndefined();
  });
});

describe("cancelCategory", () => {
  test("cancels the persisted scheduled id and clears it", async () => {
    mockGetItem.mockResolvedValueOnce("scheduled-id-xyz");
    await cancelCategory("daily_recap_reminder");
    expect(mockCancel).toHaveBeenCalledWith("scheduled-id-xyz");
    expect(mockRemoveItem).toHaveBeenCalledWith(
      "mt_notif_sched_daily_recap_reminder",
    );
  });

  test("does nothing when no scheduled id is persisted", async () => {
    mockGetItem.mockResolvedValueOnce(null);
    await cancelCategory("capture_streak_nudge");
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  test("still clears the persisted id when the OS cancel call fails", async () => {
    mockGetItem.mockResolvedValueOnce("orphaned-id");
    mockCancel.mockRejectedValueOnce(new Error("not found"));
    await cancelCategory("daily_recap_reminder");
    expect(mockRemoveItem).toHaveBeenCalledWith(
      "mt_notif_sched_daily_recap_reminder",
    );
  });
});

describe("getAllCategoryPreferences", () => {
  test("returns defaults when nothing is stored", async () => {
    mockGetItem.mockResolvedValue(null);
    const prefs = await getAllCategoryPreferences();
    expect(prefs.daily_recap_reminder).toBe(true);
    expect(prefs.capture_streak_nudge).toBe(true);
  });

  test("returns stored values when preferences are persisted", async () => {
    mockGetItem.mockImplementation((key: string) => {
      if (key === "mt_notif_cat_daily_recap_reminder") return Promise.resolve("false");
      if (key === "mt_notif_cat_capture_streak_nudge") return Promise.resolve("true");
      return Promise.resolve(null);
    });
    const prefs = await getAllCategoryPreferences();
    expect(prefs.daily_recap_reminder).toBe(false);
    expect(prefs.capture_streak_nudge).toBe(true);
  });
});
