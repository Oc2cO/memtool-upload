/**
 * Coverage for the cold-start empty state added in Pre-launch Round 2.
 *
 * Before the fix, a brand-new user landed on Progress and saw four
 * zeroed stat tiles, an empty bar chart, and "-" rows on every game
 * best — visually indistinguishable from a loading bug, and with no
 * CTA toward what they actually need to do (capture a memory or play
 * a quick game). The screen now short-circuits to an EmptyState with
 * a "Capture a memory" CTA when both data sources are empty, and
 * falls through to the normal dashboard the moment either source has
 * any data.
 *
 * These tests don't try to assert the full chart layout — that's
 * structural and not what the fix changes — they just pin the
 * branching: empty → EmptyState + working CTA, non-empty → no
 * EmptyState.
 */

import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Stub the vector-icons set so its async font-loading setState doesn't
// fire after the test body exits and trip the act() warning. We don't
// assert on the glyph itself in any of these cases.
jest.mock("@expo/vector-icons", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  const Stub = (props: object) => ReactLib.createElement(RNView, props);
  return { Ionicons: Stub };
});

// react-native-svg's default export is the Svg root; we only need to
// stop it crashing in jsdom. Render every primitive as a plain View so
// the dashboard branch can mount when we want it to.
jest.mock("react-native-svg", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  const Stub = ({ children, ...rest }: { children?: React.ReactNode }) =>
    ReactLib.createElement(RNView, rest, children);
  return {
    __esModule: true,
    default: Stub,
    Rect: Stub,
    Text: Stub,
  };
});

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const cleanup = cb();
    if (typeof cleanup === "function") cleanup();
  },
}));

jest.mock("@/context/SkillsContext", () => ({
  useSkills: () => ({ owned: new Set<string>() }),
}));

const mockMemoriesStub: { memories: unknown[] } = { memories: [] };
jest.mock("@/context/MemoriesContext", () => ({
  useMemories: () => mockMemoriesStub,
}));

type MockGameStats = {
  memoryMatchGamesPlayed: number;
  memoryMatchBestScore: {
    easy: { moves: number; timeSec: number | null } | null;
    medium: { moves: number; timeSec: number | null } | null;
    hard: { moves: number; timeSec: number | null } | null;
  };
  game24GamesPlayed: number;
  game24CurrentStreak: { easy: number; medium: number; hard: number };
  game24BestStreak: { easy: number; medium: number; hard: number };
  game24BestTime: {
    easy: number | null;
    medium: number | null;
    hard: number | null;
  };
};
const emptyStats: MockGameStats = {
  memoryMatchGamesPlayed: 0,
  memoryMatchBestScore: { easy: null, medium: null, hard: null },
  game24GamesPlayed: 0,
  game24CurrentStreak: { easy: 0, medium: 0, hard: 0 },
  game24BestStreak: { easy: 0, medium: 0, hard: 0 },
  game24BestTime: { easy: null, medium: null, hard: null },
};
const mockGameStatsStub: { stats: MockGameStats } = { stats: emptyStats };
jest.mock("@/context/GameStatsContext", () => ({
  useGameStats: () => mockGameStatsStub,
}));

import ProgressScreen from "./progress";

const EMPTY_TITLE = "No progress to show yet";
const CAPTURE_CTA = "Capture your first memory";

beforeEach(() => {
  mockMemoriesStub.memories = [];
  mockGameStatsStub.stats = emptyStats;
  mockRouterPush.mockReset();
});

describe("ProgressScreen — cold-start empty state", () => {
  test("renders EmptyState when both memories and game plays are empty", () => {
    const view = render(<ProgressScreen />);

    expect(view.queryByText(EMPTY_TITLE)).toBeTruthy();
    expect(view.queryByLabelText(CAPTURE_CTA)).toBeTruthy();
  });

  test('the "Capture a memory" CTA navigates to /capture', () => {
    const view = render(<ProgressScreen />);
    const cta = view.getByLabelText(CAPTURE_CTA);

    act(() => {
      fireEvent.press(cta);
    });

    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith("/capture");
  });

  test("falls through to the normal dashboard the moment a memory exists", () => {
    mockMemoriesStub.memories = [
      {
        id: "mem-1",
        userId: "u@example.com",
        content: "first memory",
        timestamp: new Date().toISOString(),
        kind: "memory",
      },
    ];

    const view = render(<ProgressScreen />);

    // The empty branch is gone; the dashboard label "This Week" from
    // the regular layout is what greets a returning user.
    expect(view.queryByText(EMPTY_TITLE)).toBeNull();
    expect(view.queryByLabelText(CAPTURE_CTA)).toBeNull();
  });

  test("falls through to the dashboard when only game plays exist (no memories)", () => {
    // The other half of the OR — even if the user has never captured
    // a memory, having played a game means we have something real to
    // show, so the empty state must yield.
    mockGameStatsStub.stats = {
      ...emptyStats,
      game24GamesPlayed: 1,
    };

    const view = render(<ProgressScreen />);

    expect(view.queryByText(EMPTY_TITLE)).toBeNull();
    expect(view.queryByLabelText(CAPTURE_CTA)).toBeNull();
  });
});
