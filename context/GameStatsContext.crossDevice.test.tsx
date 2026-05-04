/**
 * Cross-device round-trip coverage for Task #326.
 *
 * Verifies that a star earned via `recordMemoryMatchLevelResult` /
 * `recordGame24LevelResult` on Device A actually shows up on Device B
 * after a fresh load. We mock the network layer (`authFetch`) instead
 * of the higher-level `apiPutGameStats` / `apiGetGameStats` so the
 * test exercises the real serialize → POST → store → GET → normalize
 * → context pipeline end-to-end.
 *
 *  Device A: mount provider, record level results, capture POST body.
 *  Device B: mount a second provider whose GET returns Device A's
 *            captured payload, and assert that the per-level state
 *            reappears as well as that the regression guard is wired.
 */
import React from "react";
import { Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";

const mockUser = {
  email: "crossdevice@example.com",
  name: "Cross Device",
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

// Capture the most recent POST payload (Device A's outgoing blob) so
// Device B can replay it back through the GET path.
let mockLastPostedPayload: any = null;

jest.mock("@/lib/auth", () => ({
  __esModule: true,
  authFetch: jest.fn(async (path: string, options: any = {}) => {
    if (path === "/game-stats" && (options.method ?? "GET") === "GET") {
      return {
        stats: mockLastPostedPayload
          ? mockStripClientId(mockLastPostedPayload)
          : null,
        updated_at: mockLastPostedPayload ? new Date().toISOString() : undefined,
      };
    }
    if (path === "/sync/game_stats" && options.method === "POST") {
      const body = JSON.parse(options.body);
      mockLastPostedPayload = body.payload;
      return { ok: true };
    }
    throw new Error(`Unexpected authFetch in test: ${options.method} ${path}`);
  }),
}));

function mockStripClientId(payload: any) {
  const { client_id: _drop, ...rest } = payload;
  return rest;
}

import {
  GameStatsProvider,
  useGameStats,
} from "@/context/GameStatsContext";
import {
  setLastKnownGoodBlob,
  apiPutGameStats,
  RegressionError,
  type GameStats,
} from "@/lib/gameStats";

let liveApi: ReturnType<typeof useGameStats> | null = null;

function Probe() {
  const api = useGameStats();
  liveApi = api;
  const mm3 = api.stats.memoryMatchLevels[3];
  const g24_15 = api.stats.game24Levels[15];
  return (
    <>
      <Text testID="loading">{api.isLoading ? "loading" : "ready"}</Text>
      <Text testID="mm-l3-stars">{String(mm3?.stars ?? "null")}</Text>
      <Text testID="mm-l3-time">{String(mm3?.bestTimeSec ?? "null")}</Text>
      <Text testID="mm-l3-moves">{String(mm3?.bestMoves ?? "null")}</Text>
      <Text testID="g24-l15-stars">{String(g24_15?.stars ?? "null")}</Text>
      <Text testID="g24-l15-time">{String(g24_15?.bestTimeSec ?? "null")}</Text>
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

async function flushInflight() {
  // The provider's persistAndPush chain runs as a void promise; give
  // it a couple of microtask flushes so the captured POST body is
  // updated before we inspect `mockLastPostedPayload`.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockLastPostedPayload = null;
  setLastKnownGoodBlob(null);
});

describe("GameStatsContext per-level cross-device sync", () => {
  it("round-trips memory match + 24 game level stars through the API", async () => {
    // ---- Device A ----
    const deviceA = await mountReady();
    await act(async () => {
      await liveApi!.recordMemoryMatchLevelResult(3, 9, 22);
      await liveApi!.recordGame24LevelResult(15, 30);
    });
    await flushInflight();
    deviceA.unmount();

    expect(mockLastPostedPayload).not.toBeNull();
    expect(mockLastPostedPayload.memoryMatchLevels[3]).toEqual({
      stars: expect.any(Number),
      bestTimeSec: 22,
      bestMoves: 9,
    });
    expect(mockLastPostedPayload.game24Levels[15]).toEqual({
      stars: expect.any(Number),
      bestTimeSec: 30,
    });
    // Sanity: pendingSync flag must NOT cross the wire.
    expect(mockLastPostedPayload.pendingSync).toBeUndefined();

    // ---- Device B (fresh provider, same user, empty cache) ----
    setLastKnownGoodBlob(null);
    const deviceB = await mountReady();
    expect(deviceB.getByTestId("mm-l3-stars").props.children).toBe(
      String(mockLastPostedPayload.memoryMatchLevels[3].stars),
    );
    expect(deviceB.getByTestId("mm-l3-time").props.children).toBe("22");
    expect(deviceB.getByTestId("mm-l3-moves").props.children).toBe("9");
    expect(deviceB.getByTestId("g24-l15-stars").props.children).toBe(
      String(mockLastPostedPayload.game24Levels[15].stars),
    );
    expect(deviceB.getByTestId("g24-l15-time").props.children).toBe("30");
    deviceB.unmount();
  });

  it("blocks a payload that lowers a stored level's star count", async () => {
    // Seed last-known-good with a 3-star clear of memory match level 5.
    const seeded: GameStats = {
      memoryMatchGamesPlayed: 1,
      memoryMatchBestScore: { easy: null, medium: null, hard: null },
      game24GamesPlayed: 0,
      game24CurrentStreak: { easy: 0, medium: 0, hard: 0 },
      game24BestStreak: { easy: 0, medium: 0, hard: 0 },
      game24BestTime: { easy: null, medium: null, hard: null },
      memoryMatchLevels: { 5: { stars: 3, bestTimeSec: 10, bestMoves: 8 } },
      game24Levels: {},
      memoryMatchVersusLevels: {},
      game24VersusLevels: {},
    };
    setLastKnownGoodBlob(seeded);

    const downgraded: GameStats = {
      ...seeded,
      memoryMatchLevels: { 5: { stars: 1, bestTimeSec: 99, bestMoves: 99 } },
    };
    await expect(apiPutGameStats(downgraded, "client-x")).rejects.toBeInstanceOf(
      RegressionError,
    );
  });

  it("blocks a payload that drops a stored level entirely", async () => {
    const seeded: GameStats = {
      memoryMatchGamesPlayed: 0,
      memoryMatchBestScore: { easy: null, medium: null, hard: null },
      game24GamesPlayed: 1,
      game24CurrentStreak: { easy: 0, medium: 0, hard: 0 },
      game24BestStreak: { easy: 0, medium: 0, hard: 0 },
      game24BestTime: { easy: null, medium: null, hard: null },
      memoryMatchLevels: {},
      game24Levels: { 7: { stars: 2, bestTimeSec: 20 } },
      memoryMatchVersusLevels: {},
      game24VersusLevels: {},
    };
    setLastKnownGoodBlob(seeded);

    const dropped: GameStats = { ...seeded, game24Levels: {} };
    await expect(apiPutGameStats(dropped, "client-x")).rejects.toBeInstanceOf(
      RegressionError,
    );
  });
});
