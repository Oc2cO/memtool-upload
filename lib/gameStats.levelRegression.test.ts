/**
 * Per-level star regression guard round-trip (Task #324).
 *
 * Setup mirrors how the live app reaches this code path: a baseline
 * blob is set as the "last known good" via `setLastKnownGoodBlob`,
 * then a follow-up `apiPutGameStats` call is the boundary the guard
 * runs at. The accept-case round-trip (merge + record + push) must
 * pass the guard; hand-crafted payloads that lower a banked star
 * count or drop a banked level entry must throw `RegressionError`
 * BEFORE any network call goes out.
 */
jest.mock("./auth", () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true })),
}));

import { authFetch } from "./auth";
import {
  apiPutGameStats,
  defaultGameStats,
  mergeGameStats,
  RegressionError,
  setLastKnownGoodBlob,
  type GameStats,
} from "./gameStats";
import { mergeLevelResult } from "./gameLevels";

const mockedAuthFetch = authFetch as unknown as jest.Mock;

beforeEach(() => {
  mockedAuthFetch.mockClear();
  mockedAuthFetch.mockResolvedValue({ ok: true });
  setLastKnownGoodBlob(null);
});

function blob(over: Partial<GameStats> = {}): GameStats {
  return {
    ...defaultGameStats,
    memoryMatchBestScore: { easy: null, medium: null, hard: null },
    game24CurrentStreak: { easy: 0, medium: 0, hard: 0 },
    game24BestStreak: { easy: 0, medium: 0, hard: 0 },
    game24BestTime: { easy: null, medium: null, hard: null },
    memoryMatchLevels: {},
    game24Levels: {},
    ...over,
  };
}

describe("gameStats per-level regression guard (Task #324)", () => {
  it("accepts a payload that preserves or raises every per-level star count", async () => {
    const seeded = blob({
      memoryMatchLevels: {
        1: { stars: 2, bestTimeSec: 10, bestMoves: 8 },
        2: { stars: 1, bestTimeSec: 20, bestMoves: 12 },
      },
      game24Levels: {
        1: { stars: 3, bestTimeSec: 8, bestMoves: null },
      },
    });
    setLastKnownGoodBlob(seeded);
    // Round-trip merge: simulate a fresh result on level 2 raising
    // it from 1★ to 3★, plus an unrelated already-cleared level 1
    // staying put.
    const merged = mergeGameStats(seeded, seeded);
    const nextMM = mergeLevelResult(merged.memoryMatchLevels, 2, {
      stars: 3,
      bestTimeSec: 9,
      bestMoves: 6,
    });
    const outgoing: GameStats = { ...merged, memoryMatchLevels: nextMM };
    const res = await apiPutGameStats(outgoing, "client-1");
    expect(res.ok).toBe(true);
    expect(mockedAuthFetch).toHaveBeenCalledTimes(1);
    expect(outgoing.memoryMatchLevels[1].stars).toBe(2);
    expect(outgoing.memoryMatchLevels[2].stars).toBe(3);
  });

  it("rejects a payload that lowers memoryMatchLevels[n].stars", async () => {
    const seeded = blob({
      memoryMatchLevels: {
        4: { stars: 3, bestTimeSec: 12, bestMoves: 9 },
      },
    });
    setLastKnownGoodBlob(seeded);
    const buggy: GameStats = {
      ...seeded,
      memoryMatchLevels: {
        4: { stars: 1, bestTimeSec: 30, bestMoves: 20 },
      },
    };
    await expect(apiPutGameStats(buggy, "client-1")).rejects.toBeInstanceOf(
      RegressionError,
    );
    expect(mockedAuthFetch).not.toHaveBeenCalled();
  });

  it("rejects a payload that lowers game24Levels[n].stars", async () => {
    const seeded = blob({
      game24Levels: {
        7: { stars: 2, bestTimeSec: 18 },
      },
    });
    setLastKnownGoodBlob(seeded);
    const buggy: GameStats = {
      ...seeded,
      game24Levels: {
        7: { stars: 1, bestTimeSec: 25 },
      },
    };
    await expect(apiPutGameStats(buggy, "client-1")).rejects.toBeInstanceOf(
      RegressionError,
    );
    expect(mockedAuthFetch).not.toHaveBeenCalled();
  });

  it("rejects a payload that drops a previously-banked level entry entirely", async () => {
    // Losing the entry for a cleared level would unlock-rollback
    // the ladder — also a regression.
    const seeded = blob({
      memoryMatchLevels: {
        2: { stars: 2, bestTimeSec: 14, bestMoves: 10 },
        3: { stars: 1, bestTimeSec: 30, bestMoves: 20 },
      },
    });
    setLastKnownGoodBlob(seeded);
    const buggy: GameStats = {
      ...seeded,
      memoryMatchLevels: {
        // level 2 dropped on the way out
        3: { stars: 1, bestTimeSec: 30, bestMoves: 20 },
      },
    };
    await expect(apiPutGameStats(buggy, "client-1")).rejects.toBeInstanceOf(
      RegressionError,
    );
    expect(mockedAuthFetch).not.toHaveBeenCalled();
  });
});
