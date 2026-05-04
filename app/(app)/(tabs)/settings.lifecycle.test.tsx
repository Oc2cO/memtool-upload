/**
 * Settings screen tests for Task #300 lifecycle features:
 *   - App version row renders the version and build number
 *   - 7-tap easter egg reveals the developer info panel
 *   - Notifications section renders when notifLoaded is true
 *   - Notifications master toggle calls requestNotificationPermission
 *   - Category toggles call setCategoryEnabled
 *   - Licenses row navigates to /(app)/licenses
 *
 * Uses the same mock structure as settings.haptics.test.tsx so
 * the screen mounts without a real provider tree.
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

const mockPlay = jest.fn();
const mockRouterPush = jest.fn();

jest.mock("@/lib/haptics", () => {
  const actual = jest.requireActual("@/lib/haptics");
  return {
    ...actual,
    useHaptics: () => ({ play: mockPlay }),
    useHapticMutePrefs: () => ({
      prefs: {},
      isMuted: () => false,
      setMuted: jest.fn().mockResolvedValue(undefined),
    }),
    useHapticsMasterEnabled: () => ({
      enabled: true,
      setEnabled: jest.fn().mockResolvedValue(undefined),
    }),
  };
});

jest.mock("@/modules/expo-core-haptics", () => ({
  getAvailability: () => ({ available: false, reason: "non_ios_platform" }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const ReactLib = require("react");
    ReactLib.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === "function" ? cleanup : undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  },
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-linear-gradient", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    LinearGradient: ({
      children,
      style,
    }: {
      children: React.ReactNode;
      style?: object;
    }) => ReactLib.createElement(RNView, { style }, children),
  };
});

jest.mock("@/components/alive/FrostBackground", () => ({
  FrostBackground: () => null,
}));

jest.mock("@/components/ProUpsellCard", () => ({ ProUpsellCard: () => null }));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#000",
    foreground: "#fff",
    card: "#111",
    border: "#222",
    primary: "#a78bfa",
    accent: "#5eead4",
    destructive: "#ef4444",
    muted: "#333",
    mutedForeground: "#999",
  }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { email: "user@example.com", id: "user-1" },
    logout: jest.fn(),
    deleteAccount: jest.fn(),
  }),
}));

jest.mock("@/context/SettingsContext", () => ({
  useSettings: () => ({ soundEnabled: true, toggleSound: jest.fn() }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: { is_pro: false } }),
}));

jest.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({
    profile: null,
    isLoading: false,
    refresh: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock("@/lib/api", () => ({
  setApiBaseUrl: jest.fn(),
  getApiBaseUrl: () => null,
  syncToCloud: jest.fn().mockResolvedValue({ skipped: true, synced: 0 }),
  getPendingSyncCount: jest.fn().mockResolvedValue(0),
}));

jest.mock("@/lib/aiEngineStorage", () => ({
  loadEmbeddings: jest.fn().mockResolvedValue({}),
  loadDailyCap: jest.fn().mockResolvedValue({ used: 0 }),
  loadPatternsMeta: jest.fn().mockResolvedValue({ last_built_at: "" }),
  clearAiEngineCache: jest.fn().mockResolvedValue(undefined),
  EMBEDDING_DAILY_CAP: 50,
}));

jest.mock("@/lib/coreHapticsHint", () => ({
  shouldShowCoreHapticsHint: jest.fn().mockResolvedValue(false),
  dismissCoreHapticsHint: jest.fn().mockResolvedValue(undefined),
}));

const mockGetNotifPermStatus = jest.fn().mockResolvedValue("undetermined");
const mockRequestNotifPerm = jest.fn().mockResolvedValue("granted");
const mockGetAllCategoryPrefs = jest.fn().mockResolvedValue({
  daily_recap_reminder: true,
  capture_streak_nudge: true,
});
const mockSetCategoryEnabled = jest.fn().mockResolvedValue(undefined);
const mockHasSeenPrePrompt = jest.fn().mockResolvedValue(false);
const mockMarkPrePromptSeen = jest.fn().mockResolvedValue(undefined);

// Task #328: scheduler + reminder-time helpers. Promoted to
// module-scope jest.fns so individual tests can assert on calls
// (permission grant + focus reconciliation flows).
const mockGetCategoryTime = jest.fn(async (cat: string) =>
  cat === "daily_recap_reminder"
    ? { hour: 20, minute: 0 }
    : { hour: 19, minute: 0 },
);
const mockSetCategoryTime = jest.fn().mockResolvedValue(undefined);
const mockScheduleCategory = jest.fn().mockResolvedValue(undefined);
const mockCancelCategory = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/notifications", () => ({
  getNotificationPermissionStatus: () => mockGetNotifPermStatus(),
  requestNotificationPermission: () => mockRequestNotifPerm(),
  getAllCategoryPreferences: () => mockGetAllCategoryPrefs(),
  setCategoryEnabled: (cat: string, enabled: boolean) =>
    mockSetCategoryEnabled(cat, enabled),
  hasSeenNotificationPrePrompt: () => mockHasSeenPrePrompt(),
  markNotificationPrePromptSeen: () => mockMarkPrePromptSeen(),
  getCategoryTime: (cat: string) => mockGetCategoryTime(cat),
  setCategoryTime: (
    cat: string,
    time: { hour: number; minute: number },
  ) => mockSetCategoryTime(cat, time),
  scheduleCategory: (
    cat: string,
    time?: { hour: number; minute: number },
  ) => mockScheduleCategory(cat, time),
  cancelCategory: (cat: string) => mockCancelCategory(cat),
  formatReminderTime: ({ hour, minute }: { hour: number; minute: number }) =>
    `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  NOTIFICATION_CATEGORIES: [
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
  ],
}));

jest.mock("@/lib/forceUpdate", () => ({
  getCurrentVersion: () => "1.0.0",
  getCurrentBuildNumber: () => "42",
}));

import SettingsScreen from "./settings";

beforeEach(() => {
  jest.clearAllMocks();
  mockGetNotifPermStatus.mockResolvedValue("undetermined");
  mockGetAllCategoryPrefs.mockResolvedValue({
    daily_recap_reminder: true,
    capture_streak_nudge: true,
  });
});

describe("SettingsScreen — version display (Task #300)", () => {
  test("renders the version row with version and build number", async () => {
    const view = render(<SettingsScreen />);
    await flushAsync();

    const versionRow = view.getByTestId("version-row");
    expect(versionRow).toBeTruthy();
    expect(view.getByText(/MemTool 1\.0\.0 \(build 42\)/)).toBeTruthy();
  });

  test("easter egg: tapping version 7 times shows dev info panel", async () => {
    const view = render(<SettingsScreen />);
    await flushAsync();

    const versionRow = view.getByTestId("version-row");

    for (let i = 0; i < 7; i++) {
      await act(async () => {
        fireEvent.press(versionRow);
      });
    }

    await waitFor(() => {
      expect(view.getByTestId("dev-info-panel")).toBeTruthy();
    });
  });

  test("easter egg: tapping fewer than 7 times does NOT show dev panel", async () => {
    const view = render(<SettingsScreen />);
    await flushAsync();

    const versionRow = view.getByTestId("version-row");
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        fireEvent.press(versionRow);
      });
    }

    expect(view.queryByTestId("dev-info-panel")).toBeNull();
  });

  test("easter egg: tap count hint is shown on intermediate taps", async () => {
    const view = render(<SettingsScreen />);
    await flushAsync();

    const versionRow = view.getByTestId("version-row");
    await act(async () => {
      fireEvent.press(versionRow);
    });

    await waitFor(() => {
      expect(view.getByTestId("version-easter-egg-hint")).toBeTruthy();
    });
  });
});

describe("SettingsScreen — notifications section (Task #300)", () => {
  test("notifications card renders after state loads", async () => {
    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      expect(view.getByTestId("notifications-card")).toBeTruthy();
    });
  });

  test("master toggle shows off when permission is undetermined", async () => {
    mockGetNotifPermStatus.mockResolvedValue("undetermined");
    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      const toggle = view.getByTestId("notifications-master-toggle");
      expect(toggle.props.value).toBe(false);
    });
  });

  test("master toggle shows on when permission is granted", async () => {
    mockGetNotifPermStatus.mockResolvedValue("granted");
    mockGetAllCategoryPrefs.mockResolvedValue({
      daily_recap_reminder: true,
      capture_streak_nudge: true,
    });
    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      const toggle = view.getByTestId("notifications-master-toggle");
      expect(toggle.props.value).toBe(true);
    });
  });

  test("category toggles appear when permission is granted", async () => {
    mockGetNotifPermStatus.mockResolvedValue("granted");
    mockGetAllCategoryPrefs.mockResolvedValue({
      daily_recap_reminder: true,
      capture_streak_nudge: true,
    });
    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      expect(
        view.getByTestId("notif-category-toggle-daily_recap_reminder"),
      ).toBeTruthy();
      expect(
        view.getByTestId("notif-category-toggle-capture_streak_nudge"),
      ).toBeTruthy();
    });
  });

  test("category toggles do NOT appear when permission is undetermined", async () => {
    mockGetNotifPermStatus.mockResolvedValue("undetermined");
    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      expect(
        view.queryByTestId("notif-category-toggle-daily_recap_reminder"),
      ).toBeNull();
    });
  });

  test("toggling a category switch calls setCategoryEnabled", async () => {
    mockGetNotifPermStatus.mockResolvedValue("granted");
    mockGetAllCategoryPrefs.mockResolvedValue({
      daily_recap_reminder: true,
      capture_streak_nudge: true,
    });

    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      const toggle = view.getByTestId(
        "notif-category-toggle-daily_recap_reminder",
      );
      expect(toggle).toBeTruthy();
    });

    await act(async () => {
      fireEvent(
        view.getByTestId("notif-category-toggle-daily_recap_reminder"),
        "valueChange",
        false,
      );
    });

    expect(mockSetCategoryEnabled).toHaveBeenCalledWith(
      "daily_recap_reminder",
      false,
    );
  });

  // Task #328 — toggling a category ON schedules a daily local
  // notification at the saved time; toggling OFF cancels it.
  test("toggling a category ON schedules its daily reminder", async () => {
    mockGetNotifPermStatus.mockResolvedValue("granted");
    mockGetAllCategoryPrefs.mockResolvedValue({
      daily_recap_reminder: false,
      capture_streak_nudge: false,
    });

    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      expect(
        view.getByTestId("notif-category-toggle-daily_recap_reminder"),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent(
        view.getByTestId("notif-category-toggle-daily_recap_reminder"),
        "valueChange",
        true,
      );
    });

    expect(mockScheduleCategory).toHaveBeenCalledWith(
      "daily_recap_reminder",
      { hour: 20, minute: 0 },
    );
  });

  test("toggling a category OFF cancels its daily reminder", async () => {
    mockGetNotifPermStatus.mockResolvedValue("granted");
    mockGetAllCategoryPrefs.mockResolvedValue({
      daily_recap_reminder: true,
      capture_streak_nudge: true,
    });

    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      expect(
        view.getByTestId("notif-category-toggle-capture_streak_nudge"),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent(
        view.getByTestId("notif-category-toggle-capture_streak_nudge"),
        "valueChange",
        false,
      );
    });

    expect(mockCancelCategory).toHaveBeenCalledWith("capture_streak_nudge");
  });

  // Task #328 — focus reconciliation: when the screen mounts with
  // permission already granted and categories enabled, every enabled
  // category should be (re)scheduled idempotently so existing users
  // get reminders without manually re-toggling anything.
  test("focus reconciliation schedules enabled categories on mount when permission is granted", async () => {
    mockGetNotifPermStatus.mockResolvedValue("granted");
    mockGetAllCategoryPrefs.mockResolvedValue({
      daily_recap_reminder: true,
      capture_streak_nudge: true,
    });

    render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      expect(mockScheduleCategory).toHaveBeenCalledWith(
        "daily_recap_reminder",
        { hour: 20, minute: 0 },
      );
      expect(mockScheduleCategory).toHaveBeenCalledWith(
        "capture_streak_nudge",
        { hour: 19, minute: 0 },
      );
    });
  });

  test("focus reconciliation does NOT schedule when permission is not granted", async () => {
    mockGetNotifPermStatus.mockResolvedValue("undetermined");
    mockGetAllCategoryPrefs.mockResolvedValue({
      daily_recap_reminder: true,
      capture_streak_nudge: true,
    });

    render(<SettingsScreen />);
    await flushAsync();

    expect(mockScheduleCategory).not.toHaveBeenCalled();
  });

  // Granting OS permission via the master toggle should immediately
  // schedule any categories the user already had switched on.
  test("granting permission via master toggle schedules enabled categories", async () => {
    mockGetNotifPermStatus.mockResolvedValue("undetermined");
    mockHasSeenPrePrompt.mockResolvedValue(true); // skip the alert
    mockRequestNotifPerm.mockResolvedValue("granted");
    mockGetAllCategoryPrefs.mockResolvedValue({
      daily_recap_reminder: true,
      capture_streak_nudge: false,
    });

    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      expect(view.getByTestId("notifications-master-toggle")).toBeTruthy();
    });

    await act(async () => {
      fireEvent(
        view.getByTestId("notifications-master-toggle"),
        "valueChange",
        true,
      );
    });
    await flushAsync();

    expect(mockRequestNotifPerm).toHaveBeenCalled();
    expect(mockScheduleCategory).toHaveBeenCalledWith(
      "daily_recap_reminder",
      { hour: 20, minute: 0 },
    );
    expect(mockCancelCategory).toHaveBeenCalledWith("capture_streak_nudge");
  });
});

describe("SettingsScreen — licenses row (Task #300)", () => {
  test("licenses row is present in the Legal section", async () => {
    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      expect(view.getByTestId("licenses-row")).toBeTruthy();
    });
  });

  test("tapping licenses row navigates to /(app)/licenses", async () => {
    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      expect(view.getByTestId("licenses-row")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByTestId("licenses-row"));
    });

    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/licenses");
  });
});
