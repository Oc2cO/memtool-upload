/**
 * Screen-level coverage for the Settings "Mem captions" toggle
 * (Task #293). The toggle is the only user-facing entry point
 * for the per-user captions preference, so we pin two things
 * here:
 *   1. the row mounts in the OFF state by default
 *   2. flipping it calls `setMemCaptionsEnabled(userId, true)`
 *      with the auth user's id (or email fallback)
 *
 * The Settings screen drags in routing, safe-area, and a long
 * list of contexts — we mock the hook surface in the same shape
 * `settings.haptics.test.tsx` uses so the screen mounts without
 * a real provider tree.
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockSetMemCaptionsEnabled = jest.fn().mockResolvedValue(undefined);
const mockEnsureMemCaptionsEnabledHydrated = jest
  .fn()
  .mockResolvedValue(false);
let mockCaptionsHookValue = false;

jest.mock("@/lib/memVoicePrefs", () => ({
  useMemCaptionsEnabled: () => mockCaptionsHookValue,
  setMemCaptionsEnabled: (userId: string, enabled: boolean) =>
    mockSetMemCaptionsEnabled(userId, enabled),
  ensureMemCaptionsEnabledHydrated: (userId: string) =>
    mockEnsureMemCaptionsEnabledHydrated(userId),
  // Settings also imports the Mem-voice picker hooks (Task #292) on
  // the same screen; this caption-toggle test never exercises the
  // voice card so they're stubbed out.
  useMemVoiceId: () => null,
  setMemVoiceId: (_userId: string, _voiceId: string | null) =>
    Promise.resolve(),
}));

jest.mock("@/lib/haptics", () => {
  const actual = jest.requireActual("@/lib/haptics");
  return {
    ...actual,
    useHaptics: () => ({ play: jest.fn() }),
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
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
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
    user: { id: "user-42", email: "user@example.com" },
    logout: jest.fn(),
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
    profile: {
      created: true,
      traits: [],
      focus_areas: [],
      free_text: [],
      tone: null,
      cadence: null,
    },
    isLoading: false,
    refresh: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn(),
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

import SettingsScreen from "./settings";

beforeEach(() => {
  mockSetMemCaptionsEnabled.mockClear();
  mockEnsureMemCaptionsEnabledHydrated.mockClear();
  mockCaptionsHookValue = false;
});

describe("SettingsScreen — Mem captions toggle (Task #293)", () => {
  test("renders OFF by default", async () => {
    const view = render(<SettingsScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    const toggle = view.getByTestId("settings-mem-captions-toggle");
    expect(toggle.props.value).toBe(false);
  });

  test("flipping the toggle ON calls setMemCaptionsEnabled with the auth user's id", async () => {
    const view = render(<SettingsScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    const toggle = view.getByTestId("settings-mem-captions-toggle");
    await act(async () => {
      fireEvent(toggle, "valueChange", true);
    });

    await waitFor(() => {
      expect(mockSetMemCaptionsEnabled).toHaveBeenCalledTimes(1);
    });
    expect(mockSetMemCaptionsEnabled).toHaveBeenCalledWith("user-42", true);
  });

  test("rendered ON when the hook reports the preference is enabled", async () => {
    mockCaptionsHookValue = true;
    const view = render(<SettingsScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    const toggle = view.getByTestId("settings-mem-captions-toggle");
    expect(toggle.props.value).toBe(true);
  });
});
