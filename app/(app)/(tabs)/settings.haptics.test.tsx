/**
 * Screen-level coverage for the haptic verbs the Settings screen
 * (`app/(app)/(tabs)/settings.tsx`) fires after the Task #203 verb
 * refactor. Three call sites are pinned here:
 *
 *   1. `performDeleteProfile` success → `play("capture")`
 *      — same "we got it" verb every other save uses, so wiping the
 *      profile feels like the inverse of saving it (consistent
 *      vocabulary, not a one-off "deleted" buzz).
 *   2. `performDeleteProfile` failure → `play("error")`
 *      — calm two-thump "MemTool says no" alongside the alert.
 *   3. `handleSaveUrl` validation refusal → `play("error")`
 *      — typing "not-a-url" must feel the same way any other refused
 *      action does, not silently surface only the inline red text.
 *
 * The Settings screen pulls in routing, safe-area, and a long list of
 * contexts — we mock the hook surface so the screen mounts without a
 * full provider tree, then drive the relevant rows directly. Mocks
 * mirror the ones in `settings.haptic-demo.test.tsx` so the two suites
 * stay structurally aligned.
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

// The Cloud API URL field this suite exercises (in the
// `handleSaveUrl` tests below) lives behind the Developer options
// toggle introduced in Task #317. Force it on so these tests don't
// rely on `__DEV__` defaulting to true under jest-expo — we want
// the assertions to be explicit about which gate they need open.
jest.mock("@/lib/developerOptions", () => {
  const actual = jest.requireActual("@/lib/developerOptions");
  return {
    ...actual,
    useDeveloperOptionsEnabled: () => ({
      enabled: true,
      setEnabled: jest.fn().mockResolvedValue(undefined),
    }),
  };
});

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
    user: { email: "user@example.com" },
    logout: jest.fn(),
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
  mockPlay.mockReset();
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

/**
 * Helper — `Alert.alert` on the Settings screen is what gates the
 * actual delete. We auto-tap the destructive "Delete" button so the
 * test is asserting `performDeleteProfile`'s haptic verb rather than
 * an Alert that nobody ever confirmed.
 */
function autoConfirmDeleteAlert(): jest.SpyInstance {
  return jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _msg, buttons) => {
      const list = (buttons ?? []) as Array<{
        text?: string;
        onPress?: () => void;
      }>;
      const del = list.find((b) => b.text === "Delete");
      del?.onPress?.();
    });
}

describe("SettingsScreen — performDeleteProfile haptic verbs (Task #203)", () => {
  test("successful delete fires play('capture') — the same 'we got it' verb every save uses, applied to the inverse action", async () => {
    mockClearProfile.mockResolvedValueOnce(undefined);
    const alertSpy = autoConfirmDeleteAlert();

    const view = render(<SettingsScreen />);
    await flushAsync();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Reset Mem's memory"));
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(mockClearProfile).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("capture");
    alertSpy.mockRestore();
  });

  test("failed delete fires play('error') — calm two-thump alongside the 'Couldn't delete' alert", async () => {
    // First Alert.alert is the confirmation prompt (we auto-tap
    // Delete); the second Alert.alert is the failure alert from
    // performDeleteProfile's catch block. Both go through the same
    // spy so we can also assert the failure surface fired.
    mockClearProfile.mockImplementationOnce(() =>
      Promise.reject(new Error("backend down")),
    );
    const alertSpy = autoConfirmDeleteAlert();

    const view = render(<SettingsScreen />);
    await flushAsync();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Reset Mem's memory"));
    });

    expect(mockClearProfile).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("error");
    // The catch path also surfaces a friendly alert — pin that so a
    // future refactor can't drop the visual error while keeping the
    // haptic, or vice versa.
    const failureAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Couldn't delete",
    );
    expect(failureAlert).toBeDefined();
    alertSpy.mockRestore();
  });
});

describe("SettingsScreen — handleSaveUrl validation refusal haptic verb (Task #203)", () => {
  test("invalid URL refusal fires play('error') — the same verb other 'MemTool says no' moments use", async () => {
    // The Cloud API URL section only renders when the user is Pro,
    // so flip the subscription state for this test.
    subscriptionState.current = { is_pro: true };

    const view = render(<SettingsScreen />);
    await flushAsync();

    const urlField = view.getByPlaceholderText(
      "https://api.polsia.app",
    );
    fireEvent.changeText(urlField, "not-a-url");

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("error");
  });

  test("valid URL save does NOT fire the error verb — pinning the negative to guard the validation branch", async () => {
    // Empty input is the documented "clear the override" path and
    // is treated as valid (no haptic), but a bad URL must hit the
    // error branch above. Sanity-check the happy path doesn't
    // accidentally fire an error verb on a valid http URL.
    subscriptionState.current = { is_pro: true };

    const view = render(<SettingsScreen />);
    await flushAsync();

    const urlField = view.getByPlaceholderText(
      "https://api.polsia.app",
    );
    fireEvent.changeText(urlField, "https://api.example.com");

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    expect(mockPlay).not.toHaveBeenCalledWith("error");
  });
});
