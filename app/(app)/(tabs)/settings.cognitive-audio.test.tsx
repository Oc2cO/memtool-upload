/**
 * Screen-level coverage for the cognitive sound layer's headphone
 * hint lifecycle on the Settings screen (Task #341).
 *
 * What we're pinning here:
 *   1. Hint is hidden until binaural is enabled.
 *   2. Hint surfaces the first time binaural is enabled while no
 *      headphones are detected.
 *   3. Tapping "Got it" hides the hint AND marks `headphonesHintShown`
 *      so the same install never sees it again.
 *   4. With headphones connected the hint stays hidden AND
 *      `headphonesHintShown` is NOT marked, so a later unplug + flip
 *      can still surface the one-time nudge.
 *   5. Toggling binaural off while the hint is visible counts as a
 *      dismiss (`headphonesHintShown` becomes true).
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

import * as cognitiveAudio from "@/lib/cognitiveAudio";

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const mockMarkHeadphonesHintShown = jest.fn(async () => {
  // Mirror the real preference write so the next render sees the
  // sticky "shown" bit and short-circuits the hint logic.
  prefsState.current = { ...prefsState.current, headphonesHintShown: true };
});
const mockShouldShowHeadphonesHint = jest.fn();
const mockSetEnabled = jest.fn().mockResolvedValue(undefined);
const mockSetBinauralEnabled = jest.fn().mockResolvedValue(undefined);
const mockSetMasterVolume = jest.fn().mockResolvedValue(undefined);

const prefsState: { current: cognitiveAudio.CognitiveAudioPrefs } = {
  current: {
    enabled: false,
    binauralEnabled: false,
    masterVolume: 0.4,
    headphonesHintShown: false,
  },
};

jest.mock("@/lib/cognitiveAudio", () => {
  const actual = jest.requireActual("@/lib/cognitiveAudio");
  return {
    ...actual,
    useCognitiveAudio: () => undefined,
    useCognitiveAudioPrefs: () => ({
      prefs: prefsState.current,
      setEnabled: mockSetEnabled,
      setBinauralEnabled: mockSetBinauralEnabled,
      setMasterVolume: mockSetMasterVolume,
    }),
    applyLiveMasterVolume: jest.fn(),
    markHeadphonesHintShown: () => mockMarkHeadphonesHintShown(),
    shouldShowHeadphonesHint: () => mockShouldShowHeadphonesHint(),
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
    LinearGradient: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      ReactLib.createElement(RNView, { style }, children),
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
    primaryForeground: "#000",
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
  useAuth: () => ({ user: { email: "u@example.com" }, logout: jest.fn() }),
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
jest.mock("@/modules/expo-core-haptics", () => ({
  getAvailability: () => ({ available: false, reason: "non_ios_platform" }),
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

import SettingsScreen from "./settings";

beforeEach(() => {
  mockMarkHeadphonesHintShown.mockClear();
  mockShouldShowHeadphonesHint.mockReset();
  prefsState.current = {
    enabled: false,
    binauralEnabled: false,
    masterVolume: 0.4,
    headphonesHintShown: false,
  };
});

describe("SettingsScreen — cognitive audio headphones hint (Task #341)", () => {
  it("renders the COGNITIVE SOUND card with master + binaural toggles", async () => {
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(getByTestId("cognitive-audio-card")).toBeTruthy();
    expect(getByTestId("cognitive-audio-master-toggle")).toBeTruthy();
    expect(getByTestId("cognitive-audio-binaural-toggle")).toBeTruthy();
  });

  it("does not show the hint while binaural is disabled", async () => {
    prefsState.current = {
      enabled: true,
      binauralEnabled: false,
      masterVolume: 0.4,
      headphonesHintShown: false,
    };
    mockShouldShowHeadphonesHint.mockResolvedValue(true);
    const { queryByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(queryByTestId("cognitive-audio-headphones-hint")).toBeNull();
  });

  it("surfaces the hint the first time binaural is on without headphones", async () => {
    prefsState.current = {
      enabled: true,
      binauralEnabled: true,
      masterVolume: 0.4,
      headphonesHintShown: false,
    };
    mockShouldShowHeadphonesHint.mockResolvedValue(true);
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(getByTestId("cognitive-audio-headphones-hint")).toBeTruthy();
    expect(mockMarkHeadphonesHintShown).not.toHaveBeenCalled();
  });

  it("tapping 'Got it' hides the hint and marks it shown", async () => {
    prefsState.current = {
      enabled: true,
      binauralEnabled: true,
      masterVolume: 0.4,
      headphonesHintShown: false,
    };
    mockShouldShowHeadphonesHint.mockResolvedValue(true);
    const { getByTestId, queryByTestId } = render(<SettingsScreen />);
    await flushAsync();
    fireEvent.press(getByTestId("cognitive-audio-headphones-hint-dismiss"));
    await flushAsync();
    expect(mockMarkHeadphonesHintShown).toHaveBeenCalledTimes(1);
    expect(queryByTestId("cognitive-audio-headphones-hint")).toBeNull();
  });

  it("does not show the hint when prefs already say it was shown", async () => {
    prefsState.current = {
      enabled: true,
      binauralEnabled: true,
      masterVolume: 0.4,
      headphonesHintShown: true,
    };
    mockShouldShowHeadphonesHint.mockResolvedValue(true);
    const { queryByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(queryByTestId("cognitive-audio-headphones-hint")).toBeNull();
    // We didn't fire the hint, so we should NOT have marked it shown.
    expect(mockMarkHeadphonesHintShown).not.toHaveBeenCalled();
  });

  it("with headphones connected: hint stays hidden AND is NOT marked shown", async () => {
    // Reviewer-required behavior: a user who enables binaural with
    // headphones plugged in should still see the one-time hint
    // later if they unplug and re-evaluate.
    prefsState.current = {
      enabled: true,
      binauralEnabled: true,
      masterVolume: 0.4,
      headphonesHintShown: false,
    };
    mockShouldShowHeadphonesHint.mockResolvedValue(false);
    const { queryByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(queryByTestId("cognitive-audio-headphones-hint")).toBeNull();
    expect(mockMarkHeadphonesHintShown).not.toHaveBeenCalled();
  });
});
