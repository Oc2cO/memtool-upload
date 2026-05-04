/**
 * Level-select screen lock-state coverage for Memory Match
 * (Task #320). Asserts the four tile states the player can land on:
 *   1. unlocked-current  → Level 1 on a fresh account
 *   2. unlocked-cleared  → completed level shows star count
 *   3. locked            → not yet reached (no Pro gate)
 *   4. pro-locked        → past FREE_LEVEL_COUNT for a non-Pro user,
 *                          tapping it routes to /subscription instead
 *                          of starting the level.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

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

const mockRecord = jest.fn();
const mockProStatus = { is_pro: false };
const mockLevelState: { map: LevelProgressMap } = { map: {} };

jest.mock("@/context/GameStatsContext", () => ({
  useGameStats: () => ({
    stats: {
      memoryMatchLevels: mockLevelState.map,
      game24Levels: {},
      memoryMatchGamesPlayed: 0,
      game24GamesPlayed: 0,
    },
    recordMemoryMatchLevelResult: mockRecord,
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: mockProStatus }),
}));

jest.mock("@/components/Confetti", () => ({ Confetti: () => null }));

import MemoryMatchScreen from "../memory-match";

describe("Memory Match level-select lock states", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
    mockRecord.mockReset();
    mockProStatus.is_pro = false;
    mockLevelState.map = {};
  });

  it("level 1 unlocked & current on a fresh account, level 3 locked", () => {
    const { getByLabelText } = render(<MemoryMatchScreen />);
    expect(getByLabelText("Level 1, unlocked")).toBeTruthy();
    expect(getByLabelText("Level 3, locked")).toBeTruthy();
  });

  it("cleared levels show their star count", () => {
    mockLevelState.map = {
      1: { stars: 3, bestTimeSec: 5, bestMoves: 8 },
      2: { stars: 2, bestTimeSec: 9, bestMoves: 12 },
    };
    const { getByLabelText } = render(<MemoryMatchScreen />);
    expect(getByLabelText("Level 1, 3 stars")).toBeTruthy();
    expect(getByLabelText("Level 2, 2 stars")).toBeTruthy();
  });

  it("Pro-locked tile routes to /subscription instead of starting", () => {
    // Fully clear the free band so level FREE+1 is the next one
    // up; without Pro it must render as pro-locked.
    for (let i = 1; i <= FREE_LEVEL_COUNT; i++) {
      mockLevelState.map[i] = { stars: 3, bestTimeSec: 5, bestMoves: 8 };
    }
    const { getByLabelText } = render(<MemoryMatchScreen />);
    const proTile = getByLabelText(`Level ${FREE_LEVEL_COUNT + 1}, Pro locked`);
    fireEvent.press(proTile);
    expect(mockPush).toHaveBeenCalledWith("/subscription");
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("Pro user has the same tile unlocked", () => {
    mockProStatus.is_pro = true;
    for (let i = 1; i <= FREE_LEVEL_COUNT; i++) {
      mockLevelState.map[i] = { stars: 3, bestTimeSec: 5, bestMoves: 8 };
    }
    const { getByLabelText } = render(<MemoryMatchScreen />);
    expect(
      getByLabelText(`Level ${FREE_LEVEL_COUNT + 1}, unlocked`),
    ).toBeTruthy();
  });
});
