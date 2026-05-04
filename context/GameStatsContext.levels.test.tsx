/**
 * Regression coverage for Task #320: the new level-based recorders
 * MUST also maintain the legacy aggregate fields (best score, current
 * + best streak, best time) so the level-flow stays stat-equivalent
 * to the old preset flow. Without this, the home screen / insights
 * surfaces would silently stop tracking once the user moved to the
 * level-select UI.
 */
import React from "react";
import { Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";

// Stable references — returning fresh objects per render would cause
// GameStatsProvider's loadStats useEffect (which depends on `user`) to
// re-fire on every render, looping indefinitely.
const mockUser = {
  email: "test@example.com",
  name: "Test",
  picture: null,
};
const mockAuth = {
  user: mockUser,
  isLoading: false,
  signIn: jest.fn(),
  signOut: jest.fn(),
};
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

jest.mock("@/lib/gameStats", () => {
  const actual = jest.requireActual("@/lib/gameStats");
  return {
    ...actual,
    apiGetGameStats: jest.fn(() =>
      Promise.resolve({ stats: null, etag: null }),
    ),
    apiPutGameStats: jest.fn(() => Promise.resolve({ stats: null, etag: "x" })),
    setLastKnownGoodBlob: jest.fn(),
  };
});

import {
  GameStatsProvider,
  useGameStats,
} from "@/context/GameStatsContext";

// A ref the Probe writes to on every render. Tests use this to grab
// the live recorder functions; we read state via testID Text nodes
// rather than this ref so we always observe the rendered result.
let liveApi: ReturnType<typeof useGameStats> | null = null;

function Probe() {
  const api = useGameStats();
  liveApi = api;
  const mm = api.stats.memoryMatchBestScore.easy;
  return (
    <>
      <Text testID="loading">{api.isLoading ? "loading" : "ready"}</Text>
      <Text testID="mm-easy-moves">{String(mm?.moves ?? "null")}</Text>
      <Text testID="mm-easy-time">{String(mm?.timeSec ?? "null")}</Text>
      <Text testID="g24-medium-cur">
        {String(api.stats.game24CurrentStreak.medium)}
      </Text>
      <Text testID="g24-medium-best">
        {String(api.stats.game24BestStreak.medium)}
      </Text>
      <Text testID="g24-medium-time">
        {String(api.stats.game24BestTime.medium ?? "null")}
      </Text>
      <Text testID="g24-hard-cur">
        {String(api.stats.game24CurrentStreak.hard)}
      </Text>
      <Text testID="g24-hard-best">
        {String(api.stats.game24BestStreak.hard)}
      </Text>
    </>
  );
}

async function mountReady() {
  liveApi = null;
  const ui = render(
    <GameStatsProvider>
      <Probe />
    </GameStatsProvider>,
  );
  await waitFor(
    () => expect(ui.getByTestId("loading").props.children).toBe("ready"),
    { timeout: 8000 },
  );
  return ui;
}

describe("GameStatsContext level recorders maintain legacy aggregates", () => {
  it("recordMemoryMatchLevelResult updates legacy memoryMatchBestScore", async () => {
    const ui = await mountReady();
    await act(async () => {
      await liveApi!.recordMemoryMatchLevelResult(3, 9, 22);
    });
    expect(ui.getByTestId("mm-easy-moves").props.children).toBe("9");
    expect(ui.getByTestId("mm-easy-time").props.children).toBe("22");
  });

  it("recordGame24LevelResult bumps legacy streak + best time on the right bucket", async () => {
    const ui = await mountReady();
    // Level 15 → medium bucket per spec mapping (1-10 easy, 11-20
    // medium, 21-30 hard).
    await act(async () => {
      await liveApi!.recordGame24LevelResult(15, 30);
    });
    expect(ui.getByTestId("g24-medium-cur").props.children).toBe("1");
    expect(ui.getByTestId("g24-medium-best").props.children).toBe("1");
    expect(ui.getByTestId("g24-medium-time").props.children).toBe("30");
  });

  it("recordGame24LevelFail resets the legacy current streak", async () => {
    const ui = await mountReady();
    await act(async () => {
      await liveApi!.recordGame24LevelResult(25, 30);
      await liveApi!.recordGame24LevelResult(25, 28);
    });
    expect(ui.getByTestId("g24-hard-cur").props.children).toBe("2");
    expect(ui.getByTestId("g24-hard-best").props.children).toBe("2");
    await act(async () => {
      await liveApi!.recordGame24LevelFail(25);
    });
    expect(ui.getByTestId("g24-hard-cur").props.children).toBe("0");
    // Best streak should NOT regress on a failed attempt.
    expect(ui.getByTestId("g24-hard-best").props.children).toBe("2");
  });
});
