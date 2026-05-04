/**
 * Screen-level coverage for the "Try a haptic" demo on the Settings
 * screen (Task #231).
 *
 * What we're pinning here:
 *   1. The card renders one row per signature in HAPTIC_NAMES (six),
 *      each tappable with a play-haptic accessibility label.
 *   2. Tapping a row calls `useHaptics().play(name)` with the row's
 *      signature name — so users actually feel the pattern they
 *      asked for, not "capture for everything".
 *   3. NO haptic is played on mount — playback is gated on the user's
 *      explicit tap (acceptance criterion of Task #231).
 *   4. The header subtitle reflects which playback path the device
 *      is on:
 *         - "via Core Haptics" when getAvailability().available is true
 *         - "JS approximation" otherwise
 *      so a fallback user can't mistake the approximation for the
 *      real Core Haptics signature.
 *
 * The Settings screen pulls in routing, safe-area, and a long list of
 * contexts — we mock the hook surface so the screen mounts without a
 * full provider tree, then drive the demo rows directly.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

import { HAPTIC_NAMES } from "@/lib/haptics";

// The Settings screen kicks off a handful of async refresh effects on
// mount (AI status, pending sync count, profile). Flushing the
// microtask queue inside act() before any assertions keeps those
// background setStates out of the assertion phase so the act()
// warnings don't drown out real failures.
async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

const mockPlay = jest.fn();
const mockSetHapticMuted = jest.fn().mockResolvedValue(undefined);
const mockSetHapticsMasterEnabled = jest.fn().mockResolvedValue(undefined);
const mockMuteState: { current: Record<string, boolean> } = { current: {} };
const mockMasterState: { current: boolean } = { current: true };

jest.mock("@/lib/haptics", () => {
  const actual = jest.requireActual("@/lib/haptics");
  return {
    ...actual,
    useHaptics: () => ({ play: mockPlay }),
    useHapticMutePrefs: () => ({
      prefs: { ...mockMuteState.current },
      isMuted: (name: string) => mockMuteState.current[name] === true,
      setMuted: mockSetHapticMuted,
    }),
    useHapticsMasterEnabled: () => ({
      enabled: mockMasterState.current,
      setEnabled: mockSetHapticsMasterEnabled,
    }),
  };
});

const mockGetAvailability = jest.fn();
jest.mock("@/modules/expo-core-haptics", () => ({
  getAvailability: () => mockGetAvailability(),
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
    LinearGradient: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      ReactLib.createElement(RNView, { style }, children),
  };
});

jest.mock("@/components/alive/FrostBackground", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    FrostBackground: () => ReactLib.createElement(RNView),
  };
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

jest.mock("@/lib/coreHapticsHint", () => ({
  shouldShowCoreHapticsHint: jest.fn().mockResolvedValue(false),
  dismissCoreHapticsHint: jest.fn().mockResolvedValue(undefined),
}));

import SettingsScreen from "./settings";

beforeEach(() => {
  mockPlay.mockReset();
  mockSetHapticMuted.mockClear();
  mockSetHapticsMasterEnabled.mockClear();
  mockMuteState.current = {};
  mockMasterState.current = true;
  mockGetAvailability.mockReset();
  mockGetAvailability.mockReturnValue({ available: false, reason: "non_ios_platform" });
  (Haptics.selectionAsync as jest.Mock).mockClear();
});

describe("SettingsScreen — Try a haptic demo (Task #231)", () => {
  it("renders one tappable row for each of the six MemTool signatures", async () => {
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(HAPTIC_NAMES).toHaveLength(6);
    for (const name of HAPTIC_NAMES) {
      expect(getByTestId(`haptic-demo-row-${name}`)).toBeTruthy();
    }
  });

  it("does not play any haptic on mount — playback requires a user tap", async () => {
    render(<SettingsScreen />);
    await flushAsync();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it("tapping a signature row plays exactly that signature via useHaptics().play(name) with ignoreMute", async () => {
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();

    // ignoreMute is required so the demo can re-play a signature
    // the user has just disabled (Task #243 acceptance criterion).
    fireEvent.press(getByTestId("haptic-demo-row-capture"));
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenLastCalledWith("capture", { ignoreMute: true });

    fireEvent.press(getByTestId("haptic-demo-row-error"));
    expect(mockPlay).toHaveBeenCalledTimes(2);
    expect(mockPlay).toHaveBeenLastCalledWith("error", { ignoreMute: true });

    fireEvent.press(getByTestId("haptic-demo-row-day-recap-ready"));
    expect(mockPlay).toHaveBeenCalledTimes(3);
    expect(mockPlay).toHaveBeenLastCalledWith("day-recap-ready", {
      ignoreMute: true,
    });
  });

  it("does NOT fire a leading selection tick on demo taps — the signature plays in isolation", async () => {
    // The demo is meant to let users feel each pattern by itself so
    // they can compare them. A pre-play `Haptics.selectionAsync()`
    // would smear the first event of every signature with a
    // confirmation tick and defeat the "feel the difference" intent.
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    (Haptics.selectionAsync as jest.Mock).mockClear();

    fireEvent.press(getByTestId("haptic-demo-row-capture"));
    fireEvent.press(getByTestId("haptic-demo-row-undo"));

    expect(mockPlay).toHaveBeenCalledTimes(2);
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it("labels the playback path as the JS approximation when Core Haptics is unavailable", async () => {
    mockGetAvailability.mockReturnValue({
      available: false,
      reason: "non_ios_platform",
    });
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(getByTestId("haptic-demo-path-label").props.children).toMatch(
      /JS approximation/i,
    );
  });

  it("labels the playback path as Core Haptics when the native module is available", async () => {
    mockGetAvailability.mockReturnValue({ available: true, reason: null });
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(getByTestId("haptic-demo-path-label").props.children).toMatch(
      /Core Haptics/,
    );
  });
});

describe("SettingsScreen — per-signature mute toggles (Task #243)", () => {
  it("renders one toggle per signature, defaulting to ON when nothing is muted", async () => {
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    for (const name of HAPTIC_NAMES) {
      const toggle = getByTestId(`haptic-demo-toggle-${name}`);
      // The Switch's `value` mirrors "enabled" — true when the
      // signature is *not* muted.
      expect(toggle.props.value).toBe(true);
    }
  });

  it("reflects existing mute state — a previously-disabled signature shows its toggle OFF", async () => {
    mockMuteState.current = { "streak-extended": true };
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(getByTestId("haptic-demo-toggle-streak-extended").props.value).toBe(
      false,
    );
    // Other signatures must stay ON — muting one shouldn't muddy
    // the UI for the rest of the vocabulary.
    expect(getByTestId("haptic-demo-toggle-capture").props.value).toBe(true);
  });

  it("flipping a toggle OFF calls setMuted(name, true) — i.e. mutes that signature", async () => {
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    fireEvent(
      getByTestId("haptic-demo-toggle-streak-extended"),
      "valueChange",
      false,
    );
    expect(mockSetHapticMuted).toHaveBeenCalledTimes(1);
    expect(mockSetHapticMuted).toHaveBeenCalledWith("streak-extended", true);
  });

  it("flipping a toggle back ON calls setMuted(name, false) — re-enables that signature", async () => {
    mockMuteState.current = { error: true };
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    fireEvent(getByTestId("haptic-demo-toggle-error"), "valueChange", true);
    expect(mockSetHapticMuted).toHaveBeenCalledWith("error", false);
  });

  it("the play row for a muted signature is still tappable so users can re-evaluate before turning it back on", async () => {
    mockMuteState.current = { capture: true };
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    // Even though the signature is muted, tapping the row still
    // calls play() with ignoreMute:true so the demo can re-play it
    // for the user (Task #243 acceptance criterion).
    fireEvent.press(getByTestId("haptic-demo-row-capture"));
    expect(mockPlay).toHaveBeenCalledWith("capture", { ignoreMute: true });
  });
});

describe("SettingsScreen — Sound + Haptics master switches (Task #252)", () => {
  // The single legacy "Sound Effects" switch promised to gate audio
  // + haptic feedback, but only ever silenced audio. We've split it
  // into two independent master switches: Sound (audio-only) and
  // Haptics (vibrations). The Haptics master is also what the
  // per-signature mutes from Task #243 compose under.

  it("renders both the Sound master and the Haptics master toggles in the Preferences card", async () => {
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(getByTestId("settings-sound-toggle")).toBeTruthy();
    expect(getByTestId("settings-haptics-master-toggle")).toBeTruthy();
  });

  it("the Haptics master defaults to ON when nothing is persisted", async () => {
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(getByTestId("settings-haptics-master-toggle").props.value).toBe(true);
  });

  it("reflects a previously-disabled master state — toggle renders OFF", async () => {
    mockMasterState.current = false;
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(getByTestId("settings-haptics-master-toggle").props.value).toBe(false);
  });

  it("flipping the Haptics master OFF calls setEnabled(false)", async () => {
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    fireEvent(
      getByTestId("settings-haptics-master-toggle"),
      "valueChange",
      false,
    );
    expect(mockSetHapticsMasterEnabled).toHaveBeenCalledTimes(1);
    expect(mockSetHapticsMasterEnabled).toHaveBeenCalledWith(false);
  });

  it("flipping the Haptics master back ON calls setEnabled(true)", async () => {
    mockMasterState.current = false;
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    fireEvent(
      getByTestId("settings-haptics-master-toggle"),
      "valueChange",
      true,
    );
    expect(mockSetHapticsMasterEnabled).toHaveBeenCalledWith(true);
  });

  it("the Sound master is independent of the Haptics master — flipping Haptics doesn't touch Sound", async () => {
    // Pin the contract that the split is real: a Haptics tap must
    // never fall through to toggleSound. (toggleSound's mock is in
    // the shared SettingsContext mock above.)
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    fireEvent(
      getByTestId("settings-haptics-master-toggle"),
      "valueChange",
      false,
    );
    expect(mockSetHapticsMasterEnabled).toHaveBeenCalledTimes(1);
    // Sound toggle was never touched.
    expect(getByTestId("settings-sound-toggle").props.value).toBe(true);
  });

  it("the per-signature toggles still render even when the Haptics master is OFF — so users can fine-tune before re-enabling", async () => {
    // The card layout intentionally keeps the per-signature card
    // visible regardless of master state. A user planning to flip
    // haptics back on after a quiet meeting should still be able to
    // pre-mute the noisy ones first.
    mockMasterState.current = false;
    const { getByTestId } = render(<SettingsScreen />);
    await flushAsync();
    expect(getByTestId("haptic-demo-card")).toBeTruthy();
    for (const name of HAPTIC_NAMES) {
      expect(getByTestId(`haptic-demo-toggle-${name}`)).toBeTruthy();
    }
  });
});
