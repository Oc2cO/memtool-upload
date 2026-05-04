/**
 * Integration test for the full Versus Mem match loop in 24 Game
 * (Task #331). Drives the screen end-to-end:
 *
 *   level-select → long-press → Versus pre-match → Start Match
 *     → race timer fires → Mem submits first → loss overlay
 *     → recordGame24VersusResult invoked with ("loss", level)
 *
 * The opponent RNG seed is pinned by mocking `makeSeedableRng` so
 * Mem's calibrated thinking delay (and the concede roll) are
 * deterministic. `solve24` is mocked to a non-null answer so Mem's
 * scheduled submission actually fires (the screen short-circuits
 * when the solver returns null), and the puzzle generator stays
 * untouched — we don't care which numbers come up because we never
 * try to solve them as the user.
 *
 * Companion: `memory-match-versus-loop.test.tsx`.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

import { type LevelProgressMap } from "@/lib/gameLevels";

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

const mockRecordLevelResult = jest.fn(() =>
  Promise.resolve({ stars: 1, bestTimeSec: null, bestMoves: null }),
);
const mockRecordLevelFail = jest.fn(() => Promise.resolve());
const mockRecordVersus = jest.fn(() =>
  Promise.resolve({ wins: 0, losses: 1, draws: 0 }),
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
    recordGame24LevelResult: mockRecordLevelResult,
    recordGame24LevelFail: mockRecordLevelFail,
    recordGame24VersusResult: mockRecordVersus,
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: mockProStatus }),
}));

jest.mock("@/components/Confetti", () => ({ Confetti: () => null }));

// Pin Mem's RNG seed for determinism (Task #331 requirement). The
// real `makeSeedableRng` is reused so the rest of the opponent module
// (thinking delay, concede roll) keeps its real shape — only the seed
// is fixed.
jest.mock("@/lib/memOpponent", () => {
  const real = jest.requireActual<typeof import("@/lib/memOpponent")>(
    "@/lib/memOpponent",
  );
  return {
    ...real,
    makeSeedableRng: jest.fn(() => real.makeSeedableRng(1234)),
  };
});

// Mem's race-timer codepath bails out when `solve24` returns null
// ("solver couldn't find an answer → keep the round open"). Stub it
// to a fixed solvable expression so the scheduled submission fires
// and we observe the versus-loss path. getHint is unused on level 1
// (no time budget ≥ 75) but mocked for completeness.
jest.mock("@/lib/game24Solver", () => ({
  solve24: jest.fn(() => "6 + 6 + 6 + 6"),
  getHint: jest.fn(() => null),
}));

import Game24Screen from "../game-24";

describe("24 Game Versus integration loop", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockReset();
    mockBack.mockReset();
    mockRecordLevelResult.mockClear();
    mockRecordLevelFail.mockClear();
    mockRecordVersus.mockClear();
    mockProStatus.is_pro = true;
    // Pre-clear level 1 solo so the Versus entry is unlocked there.
    mockLevelState.map = {
      1: { stars: 3, bestTimeSec: 5, bestMoves: null },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("drives a Versus match to a loss overlay when Mem's race timer fires first", async () => {
    const view = render(<Game24Screen />);

    // 1. Open Versus pre-match via long-press on the level 1 tile.
    const tile = view.getByLabelText("Level 1, 3 stars");
    await act(async () => {
      fireEvent(tile, "longPress");
    });

    // 2. Pre-match screen visible → tap Start Match.
    expect(view.getByText("Versus Mem")).toBeTruthy();
    const start = view.getByText("Start Match");
    await act(async () => {
      fireEvent.press(start);
    });

    // 3. Game board is now showing. Burn enough time to flush every
    //    reasonable Mem submission delay (game24ThinkingDelayMs caps
    //    at ~12s baseline × 1.3 jitter × 2 concede ≈ 31.2s; 60s is a
    //    safe upper bound).
    await act(async () => {
      jest.advanceTimersByTime(60_000);
      // Let microtasks drain (handleVersusOutcome awaits
      // recordGame24VersusResult).
      await Promise.resolve();
      await Promise.resolve();
    });

    // 4. The race fired in Mem's favor → versus-loss recorded + overlay.
    expect(mockRecordVersus).toHaveBeenCalledTimes(1);
    expect(mockRecordVersus).toHaveBeenCalledWith(1, "loss");
    expect(view.getByText("Mem Beat You")).toBeTruthy();
    // Solo-fail recorder must NOT fire on a versus loss — that
    // counter is the legacy difficulty-bucket streak reset, separate
    // from the per-level versus ledger.
    expect(mockRecordLevelFail).not.toHaveBeenCalled();
  });

  it("cancels Mem's pending submission when the screen unmounts before the race fires", async () => {
    const view = render(<Game24Screen />);
    const tile = view.getByLabelText("Level 1, 3 stars");
    await act(async () => {
      fireEvent(tile, "longPress");
    });
    await act(async () => {
      fireEvent.press(view.getByText("Start Match"));
    });

    // Tear the screen down BEFORE Mem's submission delay would fire.
    // The screen's cleanup useEffect calls `memCancelRef.current?.()`,
    // which latches the cancelled flag in `scheduleMemSubmission` so
    // the queued setTimeout becomes a no-op when it eventually fires.
    view.unmount();

    // Flush every pending timer. With cancellation working correctly,
    // onSubmit must NOT land → no versus loss recorded post-exit.
    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(mockRecordVersus).not.toHaveBeenCalled();
  });
});
