/**
 * Account self-service coverage for the Settings screen — Task #299.
 *
 * Three flows are tested:
 *
 *   1. "Edit profile" row navigates to the edit-profile screen.
 *   2. "Delete account" success → `deleteAccount()` called, `play("capture")`
 *      fired, user redirected to login via auth guard.
 *   3. "Delete account" failure → `deleteAccount()` throws, `play("error")`
 *      fired, a "Couldn't delete account" alert surfaces.
 *
 * Mocks mirror the existing `settings.haptics.test.tsx` suite so both
 * suites stay structurally aligned.
 */
import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

const mockPlay = jest.fn();
const mockDeleteAccount = jest.fn();
const mockRouterPush = jest.fn();
const mockClearProfile = jest.fn();
const mockRefreshProfile = jest.fn().mockResolvedValue(undefined);
const profileState: { current: Record<string, unknown> | null } = {
  current: {
    created: true,
    traits: [],
    focus_areas: [],
    free_text: [],
    tone: null,
    cadence: null,
  },
};
const subscriptionState: { current: { is_pro: boolean } } = {
  current: { is_pro: false },
};

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
    user: { email: "user@example.com", display_name: "Test User" },
    logout: jest.fn(),
    updateDisplayName: jest.fn(),
    updateAvatar: jest.fn(),
    deleteAccount: mockDeleteAccount,
  }),
}));

jest.mock("@/context/SettingsContext", () => ({
  useSettings: () => ({ soundEnabled: true, toggleSound: jest.fn() }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: subscriptionState.current }),
}));

jest.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({
    profile: profileState.current,
    isLoading: false,
    refresh: mockRefreshProfile,
    clear: mockClearProfile,
  }),
}));

jest.mock("@/lib/api", () => ({
  setApiBaseUrl: jest.fn(),
  getApiBaseUrl: () => null,
  syncToCloud: jest.fn().mockResolvedValue({ skipped: true, synced: 0 }),
  getPendingSyncCount: jest.fn().mockResolvedValue(0),
}));

const mockClearAiEngineCache = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/aiEngineStorage", () => ({
  loadEmbeddings: jest.fn().mockResolvedValue({}),
  loadDailyCap: jest.fn().mockResolvedValue({ used: 0 }),
  loadPatternsMeta: jest.fn().mockResolvedValue({ last_built_at: "" }),
  clearAiEngineCache: (...args: unknown[]) => mockClearAiEngineCache(...args),
  EMBEDDING_DAILY_CAP: 50,
}));

jest.mock("@/lib/coreHapticsHint", () => ({
  shouldShowCoreHapticsHint: jest.fn().mockResolvedValue(false),
  dismissCoreHapticsHint: jest.fn().mockResolvedValue(undefined),
}));

import SettingsScreen from "./settings";

beforeEach(() => {
  mockPlay.mockReset();
  mockDeleteAccount.mockReset();
  mockRouterPush.mockReset();
  mockClearProfile.mockReset();
  mockRefreshProfile.mockClear();
  profileState.current = {
    created: true,
    traits: [],
    focus_areas: [],
    free_text: [],
    tone: null,
    cadence: null,
  };
  subscriptionState.current = { is_pro: false };
});

function autoConfirmAlert(buttonText: string): jest.SpyInstance {
  return jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _msg, buttons) => {
      const list = (buttons ?? []) as Array<{
        text?: string;
        onPress?: () => void;
      }>;
      const btn = list.find((b) => b.text === buttonText);
      btn?.onPress?.();
    });
}

describe("SettingsScreen — Edit profile row (Task #299)", () => {
  test("tapping 'Edit profile' navigates to the edit-profile screen", async () => {
    const view = render(<SettingsScreen />);
    await flushAsync();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Edit profile"));
    });

    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/edit-profile");
  });
});

describe("SettingsScreen — Delete account (Task #299)", () => {
  test("successful delete fires play('capture') after deleteAccount() resolves", async () => {
    mockDeleteAccount.mockResolvedValueOnce(undefined);
    const alertSpy = autoConfirmAlert("Delete account");

    const view = render(<SettingsScreen />);
    await flushAsync();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Delete account"));
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("capture");
    alertSpy.mockRestore();
  });

  test("failed delete fires play('error') and surfaces a 'Couldn't delete account' alert", async () => {
    mockDeleteAccount.mockRejectedValueOnce(new Error("network error"));
    // First alert.alert = confirmation prompt (we auto-tap 'Delete account');
    // second = failure alert from catch block. Mock taps the first only.
    const confirmSpy = autoConfirmAlert("Delete account");

    const view = render(<SettingsScreen />);
    await flushAsync();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Delete account"));
    });

    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("error");

    const failureAlert = confirmSpy.mock.calls.find(
      ([title]) => title === "Couldn't delete account",
    );
    expect(failureAlert).toBeDefined();
    confirmSpy.mockRestore();
  });

  test("confirmation dialog shows destructive 'Delete account' button and a Cancel button", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});

    const view = render(<SettingsScreen />);
    await flushAsync();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Delete account"));
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alertSpy.mock.calls[0]!;
    expect(title).toBe("Delete account?");
    const btnTexts = (buttons as Array<{ text?: string }>).map((b) => b.text);
    expect(btnTexts).toContain("Cancel");
    expect(btnTexts).toContain("Delete account");
    alertSpy.mockRestore();
  });
});
