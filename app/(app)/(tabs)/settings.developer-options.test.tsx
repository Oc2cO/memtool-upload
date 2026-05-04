/**
 * Coverage for the Developer options toggle (Task #317).
 *
 * The Cloud Sync card on Settings used to show every Pro user a
 * "Cloud API URL" text field with a `https://your-backend.example.com`
 * placeholder — an advanced bring-your-own-backend feature that no
 * normal user should ever touch. Round 1 of the pre-launch audit
 * flagged the bare placeholder as leaking the BYO-server design out
 * loud, so the URL controls are now hidden behind a persisted
 * "Developer options" toggle.
 *
 * What we pin here:
 *
 *   1. With the toggle OFF (production default), the URL field, its
 *      label, and the Save button are not in the tree. The rest of
 *      the Cloud Sync card (Sync now) still renders.
 *   2. Flipping the toggle ON reveals the URL field and Save button
 *      without remounting the screen.
 *
 * The Settings screen pulls in routing, safe-area, and a long list
 * of contexts — we mock the hook surface to mirror the haptics
 * settings test so the screen mounts without a full provider tree.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

const subscriptionState: { current: { is_pro: boolean } } = {
  current: { is_pro: true },
};

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

// Force the "production" default for these tests so the toggle
// starts OFF — the whole point of the gate is what a non-`__DEV__`
// Pro user sees on first launch. Mocking the hook here (rather
// than flipping the global `__DEV__` flag, which jest-expo and
// React Native code in the bundle both read at module load time)
// is the smaller blast radius.
import { __resetDeveloperOptionsForTests } from "@/lib/developerOptions";

// `mock`-prefixed names so jest's hoisted `jest.mock()` factory can
// safely close over them — see "out-of-scope variables" in the
// jest mocking docs.
let mockDeveloperOptionsState = false;
const mockDeveloperOptionsListeners = new Set<(next: boolean) => void>();

jest.mock("@/lib/developerOptions", () => {
  const actual = jest.requireActual("@/lib/developerOptions");
  return {
    ...actual,
    useDeveloperOptionsEnabled: () => {
      const ReactLib = require("react");
      const [enabled, setEnabled] = ReactLib.useState(mockDeveloperOptionsState);
      ReactLib.useEffect(() => {
        const listener = (next: boolean) => setEnabled(next);
        mockDeveloperOptionsListeners.add(listener);
        return () => {
          mockDeveloperOptionsListeners.delete(listener);
        };
      }, []);
      return {
        enabled,
        setEnabled: async (next: boolean) => {
          mockDeveloperOptionsState = next;
          for (const listener of mockDeveloperOptionsListeners) listener(next);
        },
      };
    },
  };
});

import SettingsScreen from "./settings";

beforeEach(() => {
  mockDeveloperOptionsState = false;
  mockDeveloperOptionsListeners.clear();
  __resetDeveloperOptionsForTests();
  subscriptionState.current = { is_pro: true };
});

describe("SettingsScreen — Developer options gate (Task #317)", () => {
  test("with the toggle off (production default) the Cloud API URL field is not in the tree, but Sync now still renders", async () => {
    const view = render(<SettingsScreen />);
    await flushAsync();

    // The advanced URL field, its label, and the Save button must
    // all be hidden. A normal Pro user should never see the
    // bring-your-own-backend placeholder.
    expect(view.queryByPlaceholderText("https://api.polsia.app")).toBeNull();
    expect(view.queryByText("Cloud API URL")).toBeNull();
    expect(view.queryByText("Save")).toBeNull();

    // The rest of the Cloud Sync card still works — Sync now is the
    // only control a normal user has, and hiding the URL field
    // should not have collateral on it.
    expect(view.getByText("Sync now")).toBeTruthy();

    // The toggle itself is visible so a developer can re-enable it.
    expect(view.getByTestId("developer-options-toggle")).toBeTruthy();
  });

  test("flipping the toggle on reveals the Cloud API URL field and Save button without remounting the screen", async () => {
    const view = render(<SettingsScreen />);
    await flushAsync();

    expect(view.queryByPlaceholderText("https://api.polsia.app")).toBeNull();

    await act(async () => {
      fireEvent(view.getByTestId("developer-options-toggle"), "valueChange", true);
    });

    expect(view.getByPlaceholderText("https://api.polsia.app")).toBeTruthy();
    expect(view.getByText("Cloud API URL")).toBeTruthy();
    expect(view.getByText("Save")).toBeTruthy();
  });
});
