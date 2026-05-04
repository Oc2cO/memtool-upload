/**
 * Regression test for Task #320: the 24 Game timed-level timeout
 * MUST report the correct level to recordGame24LevelFail. Without
 * passing the level explicitly through the interval closure, the
 * timeout would read a stale `activeLevel` from React state — at
 * band boundaries (e.g. 20 → 21, medium → hard) that resets the
 * wrong legacy difficulty bucket and miscounts games-played.
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

const mockRecord = jest.fn(() =>
  Promise.resolve({ stars: 1, bestTimeSec: null, bestMoves: null }),
);
const mockRecordFail = jest.fn<Promise<void>, [level: number]>(() =>
  Promise.resolve(),
);
const mockProStatus = { is_pro: true };
const mockLevelState: { map: LevelProgressMap } = { map: {} };

jest.mock("@/context/GameStatsContext", () => ({
  useGameStats: () => ({
    stats: {
      memoryMatchLevels: {},
      game24Levels: mockLevelState.map,
      memoryMatchGamesPlayed: 0,
      game24GamesPlayed: 0,
    },
    recordGame24LevelResult: mockRecord,
    recordGame24LevelFail: mockRecordFail,
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: mockProStatus }),
}));

jest.mock("@/components/Confetti", () => ({ Confetti: () => null }));

import Game24Screen from "../game-24";

describe("24 Game timeout records the correct level", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockReset();
    mockRecord.mockClear();
    mockRecordFail.mockClear();
    mockProStatus.is_pro = true;
    // Pre-clear levels 1..20 so the user can jump straight to a
    // band-boundary timed level (level 21 = hard band).
    mockLevelState.map = {};
    for (let i = 1; i <= 20; i++) {
      mockLevelState.map[i] = { stars: 3, bestTimeSec: 5, bestMoves: null };
    }
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("calls recordGame24LevelFail with the level the timer was started for, even at the medium→hard boundary (21)", async () => {
    const { getByLabelText } = render(<Game24Screen />);
    // Tap level 21 — first hard-band level. activeLevel state is
    // null on the level-select screen, so a stale-closure bug here
    // would either skip the fail call or pass null/wrong level.
    const tile = getByLabelText("Level 21, unlocked");
    await act(async () => {
      fireEvent.press(tile);
    });

    // Burn the entire countdown so the interval calls handleTimeout.
    // Level 21's time budget is bounded above by 75s (we just need a
    // safe upper bound to flush all ticks).
    await act(async () => {
      jest.advanceTimersByTime(120000);
    });

    expect(mockRecordFail).toHaveBeenCalledWith(21);
    // Should not have been called with anything else (e.g. 20 from
    // a stale closure, or null/undefined).
    for (const call of mockRecordFail.mock.calls) {
      expect(call[0]).toBe(21);
    }
  });
});
