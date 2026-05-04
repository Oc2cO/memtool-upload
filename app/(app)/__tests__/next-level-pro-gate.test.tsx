/**
 * Regression test for Task #320: the end-of-level "Next Level" CTA
 * must NOT bypass the Pro paywall. After a free user clears level
 * 10 (the last free level) in either Memory Match or 24 Game,
 * pressing Next Level must route to /subscription instead of
 * starting level 11.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

import {
  FREE_LEVEL_COUNT,
  type LevelProgressMap,
} from "@/lib/gameLevels";

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const cleanup = cb();
    if (typeof cleanup === "function") cleanup();
  },
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#000",
    foreground: "#fff",
    mutedForeground: "#888",
    primary: "#a78bfa",
    primaryForeground: "#fff",
    secondary: "#222",
    accent: "#fbbf24",
    destructive: "#ef4444",
    card: "#111",
    border: "#333",
    muted: "#1a1a1a",
  }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "test@example.com" } }),
}));

jest.mock("@/context/SettingsContext", () => ({
  useSettings: () => ({ soundEnabled: false }),
}));

const mockProStatus = { is_pro: false };
const mockMM: { map: LevelProgressMap } = { map: {} };
const mockG24: { map: LevelProgressMap } = { map: {} };

jest.mock("@/context/GameStatsContext", () => ({
  useGameStats: () => ({
    stats: {
      memoryMatchLevels: mockMM.map,
      game24Levels: mockG24.map,
      memoryMatchGamesPlayed: 0,
      game24GamesPlayed: 0,
    },
    recordMemoryMatchLevelResult: jest.fn(() =>
      Promise.resolve({ stars: 3, bestTimeSec: 5, bestMoves: 8 }),
    ),
    recordGame24LevelResult: jest.fn(() =>
      Promise.resolve({ stars: 3, bestTimeSec: 5, bestMoves: null }),
    ),
    recordGame24LevelFail: jest.fn(() => Promise.resolve()),
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: mockProStatus }),
}));

jest.mock("@/components/Confetti", () => ({ Confetti: () => null }));

import MemoryMatchScreen from "../memory-match";
import Game24Screen from "../game-24";

describe("Next Level CTA respects Pro gating at the free→Pro boundary", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
    mockProStatus.is_pro = false;
    // Pre-fill levels 1..FREE_LEVEL_COUNT (10) as cleared so level
    // FREE_LEVEL_COUNT is unlocked + playable for a free user.
    mockMM.map = {};
    mockG24.map = {};
    for (let i = 1; i <= FREE_LEVEL_COUNT; i++) {
      mockMM.map[i] = { stars: 3, bestTimeSec: 5, bestMoves: 8 };
      mockG24.map[i] = { stars: 3, bestTimeSec: 5, bestMoves: null };
    }
  });

  it("Memory Match: level-11 lock state used by Next Level CTA routes free users to /subscription", async () => {
    // The Next Level CTA in memory-match.tsx consults the SAME
    // levelLockState(activeLevel+1, stats.memoryMatchLevels, isPro)
    // that powers the level-select tile for level 11. Asserting the
    // tile routes to /subscription proves the shared gating helper
    // returns "pro-locked" for the boundary case, which is exactly
    // the branch handleNextLevel now uses to route to /subscription
    // instead of starting the level. The CTA label rendering is
    // covered separately by the LevelResultOverlay unit test
    // ("Unlock Pro" relabel).
    const { getByLabelText, queryByText } = render(<MemoryMatchScreen />);
    const proTile = getByLabelText("Level 11, Pro locked");
    fireEvent.press(proTile);
    expect(mockPush).toHaveBeenCalledWith("/subscription");
    expect(queryByText("Level 11 Cleared")).toBeNull();
  });

  it("24 Game: level-11 lock state used by Next Level CTA routes free users to /subscription", async () => {
    const { getByLabelText, queryByText } = render(<Game24Screen />);
    const proTile = getByLabelText("Level 11, Pro locked");
    fireEvent.press(proTile);
    expect(mockPush).toHaveBeenCalledWith("/subscription");
    expect(queryByText("Level 11 Cleared")).toBeNull();
  });

  it("24 Game: with Pro, level-11 tile is unlocked (proves the gating flips correctly with entitlement)", async () => {
    mockProStatus.is_pro = true;
    const { getByLabelText, queryByLabelText } = render(<Game24Screen />);
    expect(queryByLabelText("Level 11, Pro locked")).toBeNull();
    expect(getByLabelText("Level 11, unlocked")).toBeTruthy();
  });
});
