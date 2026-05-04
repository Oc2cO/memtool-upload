/**
 * Pre-launch polish lock-in (Task #176): the Settings "Sync now" row
 * keeps the previously-known `pendingCount` and shows a small
 * "couldn't refresh" hint when `getPendingSyncCount` rejects, instead
 * of silently flicking the badge to 0 (which would lie to the user
 * about whether anything is still pending).
 */
import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
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

// Pro is required for the Sync now row to render at all — free users
// get the upsell card instead of the cloud sync controls.
jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: { is_pro: true } }),
}));

jest.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({
    profile: null,
    isLoading: false,
    refresh: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  }),
}));

const mockGetPendingSyncCount = jest.fn();
jest.mock("@/lib/api", () => ({
  setApiBaseUrl: jest.fn(),
  getApiBaseUrl: () => null,
  syncToCloud: jest.fn().mockResolvedValue({ skipped: true, synced: 0 }),
  getPendingSyncCount: () => mockGetPendingSyncCount(),
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

jest.mock("@/lib/notifications", () => ({
  getNotificationPermissionStatus: () => Promise.resolve("undetermined"),
  requestNotificationPermission: () => Promise.resolve("granted"),
  getAllCategoryPreferences: () =>
    Promise.resolve({
      daily_recap_reminder: true,
      capture_streak_nudge: true,
    }),
  setCategoryEnabled: jest.fn().mockResolvedValue(undefined),
  hasSeenNotificationPrePrompt: () => Promise.resolve(false),
  markNotificationPrePromptSeen: () => Promise.resolve(undefined),
  getCategoryTime: jest.fn().mockResolvedValue({ hour: 9, minute: 0 }),
  setCategoryTime: jest.fn().mockResolvedValue(undefined),
  scheduleCategory: jest.fn().mockResolvedValue(undefined),
  cancelCategory: jest.fn().mockResolvedValue(undefined),
  formatReminderTime: () => "9:00 AM",
  NOTIFICATION_CATEGORIES: [
    { id: "daily_recap_reminder", label: "Daily recap", subtitle: "" },
    { id: "capture_streak_nudge", label: "Streak reminder", subtitle: "" },
  ],
}));

jest.mock("@/lib/forceUpdate", () => ({
  getCurrentVersion: () => "1.0.0",
  getCurrentBuildNumber: () => "42",
}));

jest.mock("@/lib/developerOptions", () => ({
  useDeveloperOptionsEnabled: () => ({
    enabled: false,
    setEnabled: jest.fn().mockResolvedValue(undefined),
  }),
}));

import SettingsScreen from "./settings";

describe("SettingsScreen — Sync now row 'couldn't refresh' hint (Task #176)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("keeps the previous pendingCount and shows 'couldn't refresh' when getPendingSyncCount rejects", async () => {
    // First call (mount useEffect) succeeds with 3 pending. The
    // useFocusEffect's refreshPending fires immediately on mount too
    // — make THAT one reject so we exercise the "previous value
    // preserved + hint surfaced" branch without ever zeroing the
    // badge.
    mockGetPendingSyncCount.mockResolvedValueOnce(3);
    mockGetPendingSyncCount.mockRejectedValue(new Error("storage hiccup"));

    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      expect(
        view.getByText("3 items pending · couldn't refresh"),
      ).toBeTruthy();
    });

    // Badge stays on the last successful count rather than flicking
    // back to 0 — the whole point of the hint is to be honest about
    // the staleness without lying about the count.
    expect(view.getByText("3")).toBeTruthy();
    expect(mockGetPendingSyncCount).toHaveBeenCalledTimes(2);
  });

  test("hint stays absent on the happy path (both refreshes resolve cleanly)", async () => {
    // Sanity inverse — when the focus-effect refresh succeeds the
    // 'couldn't refresh' hint must NOT leak onto the row, so the
    // bad-path test above can't pass for the wrong reason.
    mockGetPendingSyncCount.mockResolvedValue(2);

    const view = render(<SettingsScreen />);
    await flushAsync();

    await waitFor(() => {
      expect(view.getByText("2 items pending")).toBeTruthy();
    });
    expect(view.queryByText(/couldn't refresh/)).toBeNull();
  });
});
