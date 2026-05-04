/**
 * Integration test for the full Versus Mem match loop in Memory Match
 * (Task #331). Drives the screen end-to-end:
 *
 *   level-select → long-press → Versus pre-match → Start Match
 *     → preview window → user solves all pairs in a row → win overlay
 *     → recordMemoryMatchVersusResult invoked with ("win", level)
 *
 * The opponent RNG seed is pinned by mocking `makeSeedableRng` to a
 * fixed input AND by mocking `Math.random` so the card shuffle is
 * deterministic. The level config and icon picker are stubbed down to
 * a single pair so the test can drive the loop in three taps without
 * having to model Mem's turn — a one-pair match resolves with the
 * user's first match and never yields the turn to Mem.
 *
 * Companion regression coverage: see
 * `game-24-versus-loop.test.tsx` for the 24 Game side of the loop.
 */
import React from "react";
import { Alert } from "react-native";
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

const mockRecordSolo = jest.fn(() =>
  Promise.resolve({ stars: 1, bestTimeSec: null, bestMoves: null }),
);
const mockRecordVersus = jest.fn(() =>
  Promise.resolve({ wins: 1, losses: 0, draws: 0 }),
);
const mockProStatus = { is_pro: true };
const mockLevelState: { map: LevelProgressMap } = { map: {} };

jest.mock("@/context/GameStatsContext", () => ({
  useGameStats: () => ({
    stats: {
      memoryMatchLevels: mockLevelState.map,
      game24Levels: {},
      memoryMatchGamesPlayed: 0,
      game24GamesPlayed: 0,
    },
    recordMemoryMatchLevelResult: mockRecordSolo,
    recordMemoryMatchVersusResult: mockRecordVersus,
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: mockProStatus }),
}));

jest.mock("@/components/Confetti", () => ({ Confetti: () => null }));

// Pin Mem's icon set + level shape so the test can drive a full
// match loop deterministically. `mockBoardConfig` is mutated per
// test to control how many pairs the board has — one pair for the
// terminal-overlay scenario (Mem never plays) and two pairs for the
// turn-handoff scenario (user mismatches → Mem's turn fires).
const mockBoardConfig = {
  pairs: 1,
  icons: ["A"] as string[],
};

jest.mock("@/lib/memoryMatchIcons", () => ({
  pickIconSet: jest.fn(() => mockBoardConfig.icons),
}));

jest.mock("@/lib/gameLevels", () => {
  const real = jest.requireActual<typeof import("@/lib/gameLevels")>(
    "@/lib/gameLevels",
  );
  return {
    ...real,
    getMemoryMatchLevel: jest.fn(() => ({
      level: 1,
      pairs: mockBoardConfig.pairs,
      cols: mockBoardConfig.pairs * 2,
      rows: 1,
      previewMs: 50,
      similarIcons: false,
      threeStarMoves: mockBoardConfig.pairs,
      threeStarTimeSec: 5,
      twoStarMoves: mockBoardConfig.pairs * 2,
    })),
  };
});

// Pin the opponent RNG seed so the (unused-in-this-scenario) Mem
// codepath is still deterministic and reproducible across runs.
jest.mock("@/lib/memOpponent", () => {
  const real = jest.requireActual<typeof import("@/lib/memOpponent")>(
    "@/lib/memOpponent",
  );
  return {
    ...real,
    makeSeedableRng: jest.fn(() => real.makeSeedableRng(42)),
  };
});

import MemoryMatchScreen from "../memory-match";

describe("Memory Match Versus integration loop", () => {
  let randomSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockReset();
    mockBack.mockReset();
    mockRecordSolo.mockClear();
    mockRecordVersus.mockClear();
    mockProStatus.is_pro = true;
    mockBoardConfig.pairs = 1;
    mockBoardConfig.icons = ["A"];
    // Pre-clear level 1 so versus is unlocked there.
    mockLevelState.map = {
      1: { stars: 3, bestTimeSec: 5, bestMoves: 3 },
    };
    // Constant Math.random keeps both `pickIconSet` (stubbed already)
    // and the in-screen `[...icons,...icons].sort(0.5 - random)` shuffle
    // deterministic. 0.99 yields a negative comparator, so the array
    // stays in source order: [A, A].
    randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.99);
  });

  afterEach(() => {
    jest.useRealTimers();
    randomSpy.mockRestore();
  });

  it("drives a Versus match to a win overlay and records the result", async () => {
    const view = render(<MemoryMatchScreen />);

    // 1. Open the Versus pre-match for level 1 via long-press on its
    //    level tile. The tile's accessibilityLabel comes from the
    //    LevelLadder and is stable across this app version.
    const tile = view.getByLabelText("Level 1, 3 stars");
    await act(async () => {
      fireEvent(tile, "longPress");
    });

    // 2. Confirm the pre-match screen rendered, then tap Start Match.
    expect(view.getByText("Versus Mem")).toBeTruthy();
    const start = view.getByText("Start Match");
    await act(async () => {
      fireEvent.press(start);
    });

    // 3. Burn the preview window so isPlaying flips on. The mocked
    //    level config sets previewMs to 50, so 200ms is plenty.
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    // 4. Find the two card Pressables. There are exactly 2 on this
    //    one-pair board; the back button is the only other Pressable
    //    on the screen and it carries an accessibilityLabel we can
    //    filter on. Cards are matched by their inline width/height
    //    style (set by `MemoryCard` from the computed cardSize) which
    //    no other Pressable on the screen sets.
    const cards = view.UNSAFE_root.findAll((n) => {
      const p = n.props as Record<string, unknown>;
      if (typeof p.onPress !== "function") return false;
      if (p.accessibilityLabel != null) return false;
      if (!Array.isArray(p.style)) return false;
      return (p.style as unknown[]).some(
        (s) =>
          s != null &&
          typeof s === "object" &&
          typeof (s as { width?: unknown }).width === "number",
      );
    });
    expect(cards.length).toBe(2);

    // 5. Tap both cards — same icon, instant match → match completes →
    //    handleEnd → versus-win overlay + recordMemoryMatchVersusResult.
    await act(async () => {
      fireEvent.press(cards[0]);
    });
    await act(async () => {
      fireEvent.press(cards[1]);
      // Allow microtasks (the async recordVersus call inside handleEnd)
      // to settle before assertions.
      await Promise.resolve();
    });

    expect(mockRecordVersus).toHaveBeenCalledTimes(1);
    expect(mockRecordVersus).toHaveBeenCalledWith(1, "win");
    // The end-of-match overlay surfaces the versus-win copy.
    expect(view.getByText("You Beat Mem")).toBeTruthy();
  });

  // Strengthened gating regression: long-pressing a versus-locked
  // tile must NOT open the pre-match screen — instead the screen
  // surfaces the "clear this level solo first" alert.
  it("does not open Versus pre-match when solo level is uncleared", async () => {
    mockLevelState.map = {}; // un-clear level 1 → versusLock = "locked"
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    try {
      const view = render(<MemoryMatchScreen />);
      const tile = view.getByLabelText("Level 1, unlocked");
      await act(async () => {
        fireEvent(tile, "longPress");
      });
      // The locked branch in onVersusSelect must fire its alert and
      // bail before setPendingVersusLevel runs — so the pre-match
      // header must NOT have rendered.
      expect(view.queryByText("Versus Mem")).toBeNull();
      expect(alertSpy).toHaveBeenCalledWith(
        "Versus locked",
        expect.stringContaining("Clear this level solo"),
      );
    } finally {
      alertSpy.mockRestore();
    }
  });

  // Turn-handoff regression: a 2-pair board lets the user mismatch
  // on their first turn, which after the 800ms reveal must hand the
  // turn to Mem (memThinking surfaces "Mem is thinking…") without
  // recording a versus result yet.
  it("hands the turn to Mem after a user mismatch and does not record a result", async () => {
    mockBoardConfig.pairs = 2;
    mockBoardConfig.icons = ["A", "B"]; // shuffle stays identity → [A,B,A,B]
    const view = render(<MemoryMatchScreen />);
    const tile = view.getByLabelText("Level 1, 3 stars");
    await act(async () => {
      fireEvent(tile, "longPress");
    });
    await act(async () => {
      fireEvent.press(view.getByText("Start Match"));
    });
    await act(async () => {
      jest.advanceTimersByTime(200); // burn preview window
    });

    const cards = view.UNSAFE_root.findAll((n) => {
      const p = n.props as Record<string, unknown>;
      if (typeof p.onPress !== "function") return false;
      if (p.accessibilityLabel != null) return false;
      if (!Array.isArray(p.style)) return false;
      return (p.style as unknown[]).some(
        (s) =>
          s != null &&
          typeof s === "object" &&
          typeof (s as { width?: unknown }).width === "number",
      );
    });
    expect(cards.length).toBe(4);

    // Cards are laid out [A, B, A, B]; tap (0, 1) for a guaranteed
    // mismatch — same-icon pairs sit at indices (0,2) and (1,3).
    await act(async () => {
      fireEvent.press(cards[0]);
    });
    await act(async () => {
      fireEvent.press(cards[1]);
    });
    // Burn the 800ms mismatch reveal → setVersusTurn("mem") fires →
    // useEffect kicks runMemTurn → setMemThinking(true).
    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    // Handoff happened: turn indicator now reads "Mem…" (the
    // memThinking branch of the turn label), no terminal overlay
    // has rendered, and no versus result has been recorded.
    expect(view.queryByText("Mem…")).toBeTruthy();
    expect(view.queryByText("You Beat Mem")).toBeNull();
    expect(view.queryByText("Mem Beat You")).toBeNull();
    expect(mockRecordVersus).not.toHaveBeenCalled();
  });
});
