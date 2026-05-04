/**
 * Versus Mem integration coverage for the 24 Game (Task #329).
 *
 * Drives the screen end-to-end via React Native Testing Library:
 *  - long-press a cleared level tile → pre-match screen → Start Match
 *  - WIN: user submits a correct expression before Mem's submission
 *    timer fires; expects `recordGame24VersusResult(level, "win")`.
 *  - LOSS: user does nothing while fake timers advance past Mem's
 *    submission delay; expects `recordGame24VersusResult(level, "loss")`.
 *
 * Puzzle generation is mocked to a deterministic [10, 8, 5, 1] hand
 * (10 + 8 + 5 + 1 = 24) so the WIN path can be solved by tapping
 * card → operator → card three times.
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
const mockRecordFail = jest.fn(() => Promise.resolve());
const mockRecordVersus = jest.fn<
  Promise<VersusRecord>,
  [level: number, outcome: "win" | "loss" | "draw"]
>(() =>
  Promise.resolve({ wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0 }),
);
const mockProStatus = { is_pro: true };
const mockLevelState: { map: LevelProgressMap } = { map: {} };

jest.mock("@/context/GameStatsContext", () => ({
  useGameStats: () => ({
    stats: {
      memoryMatchLevels: {},
      game24Levels: mockLevelState.map,
      memoryMatchVersusLevels: {},
      game24VersusLevels: {},
      memoryMatchGamesPlayed: 0,
      game24GamesPlayed: 0,
    },
    recordGame24LevelResult: mockRecordResult,
    recordGame24LevelFail: mockRecordFail,
    recordGame24VersusResult: mockRecordVersus,
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: mockProStatus }),
}));

jest.mock("@/components/Confetti", () => ({ Confetti: () => null }));

// Deterministic puzzle so the user can solve it in three trivial steps:
// 10 + 8 = 18, 18 + 5 = 23, 23 + 1 = 24.
jest.mock("@/lib/gameLevels", () => {
  const actual = jest.requireActual("@/lib/gameLevels");
  return {
    ...actual,
    generateGame24Puzzle: () => [10, 8, 5, 1],
  };
});

import Game24Screen from "../game-24";

describe("24 Game versus Mem (Task #329)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockReset();
    mockBack.mockReset();
    mockRecordResult.mockClear();
    mockRecordFail.mockClear();
    mockRecordVersus.mockClear();
    mockProStatus.is_pro = true;
    // Pre-clear level 1 so versus mode is unlocked there.
    mockLevelState.map = {
      1: { stars: 3, bestTimeSec: 5, bestMoves: null },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function startVersusLevel1(api: ReturnType<typeof render>) {
    const tile = api.getByLabelText("Level 1, 3 stars");
    // Long-press surfaces the pre-match screen (versus pre-match).
    await act(async () => {
      fireEvent(tile, "longPress");
    });
    const start = api.getByText("Start Match");
    await act(async () => {
      fireEvent.press(start);
    });
  }

  it("records a WIN when the user solves before Mem's submission timer", async () => {
    const api = render(<Game24Screen />);
    await startVersusLevel1(api);

    // Pick (10 + 8) → (18 + 5) → (23 + 1) = 24. Operator label is
    // "+" in the UI (×/÷ are rewritten but + stays "+"). Each press
    // is isolated in its own act() so React commits selectedCardId /
    // selectedOperator state between the card → operator → card
    // taps; without this, the second tap would observe the stale
    // pre-tap snapshot and short-circuit.
    const tapCard = async (value: number) => {
      await act(async () => {
        fireEvent.press(api.getByTestId(`g24-card-${value}`));
      });
    };
    const tapOp = async (op: "+" | "-") => {
      await act(async () => {
        fireEvent.press(api.getByTestId(`g24-op-${op}`));
      });
    };
    // Combined-card ids use `card-new-${Date.now()}`; with fake
    // timers frozen, two combines in the same tick would collide on
    // a single id and a stale `used` row would shadow the live one.
    // Nudging the clock by 1ms between combines gives each new card
    // a unique id, matching production behaviour.
    const tick = async () => {
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
    };

    await tapCard(10);
    await tapOp("+");
    await tapCard(8);
    await tick();
    await tapCard(18);
    await tapOp("+");
    await tapCard(5);
    await tick();
    await tapCard(23);
    await tapOp("+");
    await tapCard(1);

    // handleWin → handleVersusOutcome("win") → recordGame24VersusResult.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockRecordVersus).toHaveBeenCalledWith(1, "win");
    // Mem's submission timer must not have fired a competing loss.
    for (const call of mockRecordVersus.mock.calls) {
      expect(call[1]).toBe("win");
    }
  });

  it("records a LOSS when Mem's submission timer fires before the user solves", async () => {
    const api = render(<Game24Screen />);
    await startVersusLevel1(api);

    // Burn well past the maximum scheduled Mem delay (level 1 baseline
    // 12s + jitter + concede stretch + safety) without any user input.
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRecordVersus).toHaveBeenCalledWith(1, "loss");
  });
});
