/**
 * Screen-level coverage for the one-time "richer haptics" hint card
 * on the Settings screen (Task #226). The gating helper itself is
 * unit-tested in `lib/coreHapticsHint.test.ts`; what we pin here is
 * the wiring between that helper and the rendered Settings JSX —
 * specifically, that the `core-haptics-hint` card actually shows up
 * exclusively on iPhones where Core Haptics is playing the .ahap
 * files, that the dismiss button removes it from the tree, and that
 * the dismissal is persisted so the hint never reappears.
 *
 * We deliberately do NOT mock `@/lib/coreHapticsHint` or
 * `@/modules/expo-core-haptics` — the contract under test is the
 * full path from native availability + AsyncStorage flag → rendered
 * card. We use the existing `__setNativeModuleForTests` escape hatch
 * to simulate native availability and the `Object.defineProperty(
 * Platform, "OS", ...)` pattern from `components/Toast.test.tsx` to
 * simulate non-iOS platforms.
 */
import React from "react";
import { Platform } from "react-native";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  __resetNativeModuleForTests,
  __setNativeModuleForTests,
  type CoreHapticsNative,
} from "@/modules/expo-core-haptics";
import { CORE_HAPTICS_HINT_DISMISSED_KEY } from "@/lib/coreHapticsHint";

// ---- shared provider mocks ----
// Same surface as `settings.haptic-demo.test.tsx`: the Settings screen
// pulls in routing, safe-area, and a long list of contexts, so we mock
// the hook surface it depends on so it can mount without a full
// provider tree. The interesting bit for THIS file is what we are NOT
// mocking — see the comment further down.

const mockPlay = jest.fn();
const mockSetHapticMuted = jest.fn().mockResolvedValue(undefined);
const mockSetHapticsMasterEnabled = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/haptics", () => {
  const actual = jest.requireActual("@/lib/haptics");
  return {
    ...actual,
    useHaptics: () => ({ play: mockPlay }),
    useHapticMutePrefs: () => ({
      prefs: {},
      isMuted: () => false,
      setMuted: mockSetHapticMuted,
    }),
    useHapticsMasterEnabled: () => ({
      enabled: true,
      setEnabled: mockSetHapticsMasterEnabled,
    }),
  };
});

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

jest.mock("@/components/alive/FrostBackground", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return { FrostBackground: () => ReactLib.createElement(RNView) };
});

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

// NOTE: deliberately not mocking `@/lib/coreHapticsHint` or
// `@/modules/expo-core-haptics` — those are the integration we're
// pinning. Native availability is driven via the
// `__setNativeModuleForTests` escape hatch and AsyncStorage uses the
// global jest.setup.js mock.

import SettingsScreen from "./settings";

// ---- helpers ----

const originalOS = Platform.OS;

function setPlatformOS(os: "ios" | "android" | "web") {
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
}

function makeNative(available: boolean): CoreHapticsNative {
  return {
    getAvailability: () => ({
      available,
      reason: available ? null : "hardware_not_supported",
    }),
    play: jest.fn().mockResolvedValue({ status: "ok", handle: 1 }),
    stop: jest.fn(),
  };
}

// The hint effect awaits getItem() before flipping state, so a single
// microtask flush isn't always enough — drain a few ticks so any
// post-effect render has landed before an absence assertion runs.
// Without this, a regression that *would* render the card could slip
// past `queryByTestId(...)` returning null on an early frame.
async function flushHintEffect() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockPlay.mockReset();
  (AsyncStorage.getItem as jest.Mock).mockReset();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockReset();
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  // Drop any test-installed native module so the next test starts
  // from a clean cache (otherwise the "module not linked" case would
  // see leftover stub state from a previous "available" test).
  __resetNativeModuleForTests();
  Object.defineProperty(Platform, "OS", {
    configurable: true,
    get: () => originalOS,
  });
});

describe("SettingsScreen — 'richer haptics' hint card (Task #226)", () => {
  describe("when Core Haptics is actually playing the .ahap files", () => {
    // iPhone, native module reports available, no dismissed flag in
    // AsyncStorage — this is the exact and only scenario the hint is
    // allowed to appear in.
    beforeEach(() => {
      setPlatformOS("ios");
      __setNativeModuleForTests(makeNative(true));
    });

    it("renders the core-haptics-hint card", async () => {
      const { findByTestId } = render(<SettingsScreen />);
      // findByTestId waits for the post-effect render — the hint state
      // flips after `shouldShowCoreHapticsHint()` resolves, not
      // synchronously on mount.
      const hint = await findByTestId("core-haptics-hint");
      expect(hint).toBeTruthy();
    });

    it("exposes a dismiss button inside the hint card", async () => {
      // The card is useless without a way to close it; if the dismiss
      // button ever gets refactored out of the JSX or its testID drifts
      // we want this to fail before the dismissal-flow test below.
      const { findByTestId } = render(<SettingsScreen />);
      const dismiss = await findByTestId("core-haptics-hint-dismiss");
      expect(dismiss).toBeTruthy();
    });

    it("pressing the dismiss button hides the card AND persists the dismissed flag", async () => {
      const { findByTestId, queryByTestId } = render(<SettingsScreen />);
      const dismiss = await findByTestId("core-haptics-hint-dismiss");
      fireEvent.press(dismiss);

      // The card disappears via the local setState; the AsyncStorage
      // write is the side-effect we *must* persist so the hint never
      // reappears on the same install. waitFor covers both because the
      // dismiss handler intentionally fires the storage write
      // fire-and-forget after the setState — see
      // `handleDismissCoreHapticsHint` in settings.tsx.
      await waitFor(() => {
        expect(queryByTestId("core-haptics-hint")).toBeNull();
      });
      await waitFor(() => {
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
          CORE_HAPTICS_HINT_DISMISSED_KEY,
          expect.any(String),
        );
      });
    });
  });

  describe("when the hint must NOT show", () => {
    it("is absent on Android (non-iOS platform short-circuit)", async () => {
      setPlatformOS("android");
      const { queryByTestId } = render(<SettingsScreen />);
      await flushHintEffect();
      expect(queryByTestId("core-haptics-hint")).toBeNull();
    });

    it("is absent on web (non-iOS platform short-circuit)", async () => {
      setPlatformOS("web");
      const { queryByTestId } = render(<SettingsScreen />);
      await flushHintEffect();
      expect(queryByTestId("core-haptics-hint")).toBeNull();
    });

    it("is absent on iPhone where the native module is not linked (Expo Go / older dev client)", async () => {
      setPlatformOS("ios");
      // No __setNativeModuleForTests call — the lazy require() inside
      // getNativeModule() can't find a linked CoreHaptics binary in
      // jest, so getAvailability() returns module_not_linked and the
      // hint must stay hidden. This mirrors the same scenario in
      // `lib/coreHapticsHint.test.ts`.
      const { queryByTestId } = render(<SettingsScreen />);
      await flushHintEffect();
      expect(queryByTestId("core-haptics-hint")).toBeNull();
    });

    it("is absent on iPhone where Core Haptics availability returns false (JS fallback path)", async () => {
      setPlatformOS("ios");
      __setNativeModuleForTests(makeNative(false));
      const { queryByTestId } = render(<SettingsScreen />);
      await flushHintEffect();
      expect(queryByTestId("core-haptics-hint")).toBeNull();
    });

    it("is absent on iPhone where Core Haptics is available but the user already dismissed it", async () => {
      // Belt-and-braces: cover the persisted-dismissal path through
      // the real screen so a regression that drops the storage gate
      // and re-shows the hint to repeat users gets caught here as
      // well as in the unit tests.
      setPlatformOS("ios");
      __setNativeModuleForTests(makeNative(true));
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        "2026-04-01T00:00:00.000Z",
      );
      const { queryByTestId } = render(<SettingsScreen />);
      await flushHintEffect();
      expect(queryByTestId("core-haptics-hint")).toBeNull();
    });
  });
});
