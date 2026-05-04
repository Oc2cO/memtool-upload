/**
 * Versus Mem integration coverage for Memory Match (Task #329).
 *
 * Drives the screen end-to-end via React Native Testing Library:
 *  - long-press a cleared level tile → pre-match → Start Match
 *  - WIN: user matches all three pairs in order; expects
 *    `recordMemoryMatchVersusResult(level, "win")`.
 *  - LOSS: user causes one mismatch on the first move; Mem (mocked
 *    to always pick the next matching pair) clears the board;
 *    expects `recordMemoryMatchVersusResult(level, "loss")`.
 *
 * Setup:
 *  - `pickIconSet` is mocked to return ["A","B","C"] for level 1
 *    (3 pairs).
 *  - `Math.random` is pinned to 0.5 so the in-screen
 *    `[...icons, ...icons].sort(() => 0.5 - Math.random())`
 *    leaves the order intact ([A,A,B,B,C,C]). This makes card
 *    indices deterministic.
 *  - `chooseMemoryMatchPick` is mocked to return matching pairs in
 *    order (0,1) → (2,3) → (4,5) for the LOSS path.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

import { type LevelProgressMap } from "@/lib/gameLevels";
import { type VersusRecord } from "@/lib/gameStats";

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

jest.mock("@/context/SettingsContext", () => ({
  useSettings: () => ({ soundEnabled: false }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "test@example.com" } }),
}));

const mockRecordResult = jest.fn(() =>
  Promise.resolve({ stars: 1, bestTimeSec: null, bestMoves: null }),
);
const mockRecordVersus = jest.fn<
  Promise<VersusRecord>,
  [level: number, outcome: "win" | "loss" | "draw"]
>(() =>
  Promise.resolve({
    wins: 0,
    losses: 0,
    draws: 0,
    currentStreak: 0,
    bestStreak: 0,
  }),
);
const mockProStatus = { is_pro: true };
const mockLevelState: { map: LevelProgressMap } = { map: {} };

jest.mock("@/context/GameStatsContext", () => ({
  useGameStats: () => ({
    stats: {
      memoryMatchLevels: mockLevelState.map,
      game24Levels: {},
      memoryMatchVersusLevels: {},
      game24VersusLevels: {},
      memoryMatchGamesPlayed: 0,
      game24GamesPlayed: 0,
    },
    recordMemoryMatchLevelResult: mockRecordResult,
    recordMemoryMatchVersusResult: mockRecordVersus,
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: mockProStatus }),
}));

jest.mock("@/components/Confetti", () => ({ Confetti: () => null }));

jest.mock("@/lib/memoryMatchIcons", () => ({
  pickIconSet: (pairs: number) =>
    Array.from({ length: pairs }, (_, i) => String.fromCharCode(65 + i)),
}));

const mockMemPickState: {
  picks: { first: number; second: number }[];
  idx: number;
} = { picks: [], idx: 0 };
jest.mock("@/lib/memOpponent", () => {
  const actual = jest.requireActual("@/lib/memOpponent");
  return {
    ...actual,
    chooseMemoryMatchPick: () => {
      const { picks, idx } = mockMemPickState;
      const pick = picks[idx] ?? picks[picks.length - 1];
      mockMemPickState.idx += 1;
      return pick;
    },
  };
});

import MemoryMatchScreen from "../memory-match";

describe("Memory Match versus Mem (Task #329)", () => {
  let randomSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockReset();
    mockBack.mockReset();
    mockRecordResult.mockClear();
    mockRecordVersus.mockClear();
    mockProStatus.is_pro = true;
    mockLevelState.map = {
      1: { stars: 3, bestTimeSec: 5, bestMoves: 8 },
    };
    mockMemPickState.picks = [
      { first: 0, second: 3 },
      { first: 1, second: 4 },
      { first: 2, second: 5 },
    ];
    mockMemPickState.idx = 0;
    // 0.5 - 0.5 = 0 → Array#sort leaves order untouched, so cards
    // come out as [A,B,C,A,B,C] (the screen does
    // `[...icons, ...icons].sort(...)`). Matching pairs are
    // therefore (0,3), (1,4), (2,5).
    randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    randomSpy.mockRestore();
    jest.useRealTimers();
  });

  async function startVersusLevel1(api: ReturnType<typeof render>) {
    const tile = api.getByLabelText("Level 1, 3 stars");
    await act(async () => {
      fireEvent(tile, "longPress");
    });
    const start = api.getByText("Start Match");
    await act(async () => {
      fireEvent.press(start);
    });
  }

  it("records a WIN when the user matches all three pairs", async () => {
    const api = render(<MemoryMatchScreen />);
    await startVersusLevel1(api);
    // Burn through the preview window so isPlaying flips to true.
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    const tap = (i: number) =>
      fireEvent.press(api.getByTestId(`mem-card-${i}`));

    const tapPair = async (a: number, b: number) => {
      await act(async () => {
        tap(a);
      });
      await act(async () => {
        tap(b);
      });
    };
    await tapPair(0, 3);
    await tapPair(1, 4);
    await tapPair(2, 5);
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRecordVersus).toHaveBeenCalledWith(1, "win");
  });

  it("records a LOSS when Mem clears the board after a user mismatch", async () => {
    const api = render(<MemoryMatchScreen />);
    await startVersusLevel1(api);
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    const tap = (i: number) =>
      fireEvent.press(api.getByTestId(`mem-card-${i}`));

    // 0=A, 1=B → mismatch → turn flips to Mem after the 800ms reset.
    await act(async () => {
      tap(0);
    });
    await act(async () => {
      tap(1);
    });
    // Drain pending timers in slices so React effects committed by
    // each timer callback get a chance to register the next timer
    // BEFORE the next slice runs. A single big advance can outrun
    // the React commit and miss the chained Mem-turn `setTimeout`s.
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }

    expect(mockRecordVersus).toHaveBeenCalledWith(1, "loss");
  }, 20000);
});
