import {
  FREE_LEVEL_COUNT,
  LEVELS_PER_GAME,
  LEVEL_CHAPTERS,
  LEVEL_MILESTONES,
  MAX_STARS_PER_GAME,
  computeMemoryMatchCardSize,
  game24Stars,
  generateGame24Puzzle,
  getChapterForLevel,
  getGame24Level,
  getMemoryMatchLevel,
  highestUnlockedLevel,
  isLevelCleared,
  levelLockState,
  memoryMatchStars,
  mergeLevelResult,
  milestoneCrossedBy,
  nextMilestone,
  totalStarsEarned,
  versusLevelLockState,
  type LevelProgressMap,
} from "./gameLevels";
import { solve24 } from "./game24Solver";

describe("computeMemoryMatchCardSize", () => {
  it("constrains by width on a normal-height device", () => {
    // 4×2 grid (level 2): width is the binding axis on phone-sized
    // viewports.
    const size = computeMemoryMatchCardSize({
      level: 2,
      boardWidth: 320,
      boardHeight: 600,
      gap: 8,
    });
    // Width fit: (320 - 3*8) / 4 = 74. Height fit: (600 - 8) / 2 = 296.
    expect(size).toBeCloseTo(74);
  });

  it("constrains by height on tall grids so bottom rows aren't clipped", () => {
    // Level 15 is 4×8 (16 pairs). With a wide-but-short board the
    // height axis MUST win — without this clamp the board would
    // overflow the screen and the bottom rows would be unreachable.
    const widthOnly = (320 - 3 * 8) / 4; // 74
    const expectedHeightFit = (480 - 7 * 8) / 8; // 53
    const size = computeMemoryMatchCardSize({
      level: 15,
      boardWidth: 320,
      boardHeight: 480,
      gap: 8,
    });
    expect(size).toBeLessThan(widthOnly);
    expect(size).toBeCloseTo(expectedHeightFit);
  });

  it("does the same for the other 4×8 band (level 16)", () => {
    const size = computeMemoryMatchCardSize({
      level: 16,
      boardWidth: 320,
      boardHeight: 480,
      gap: 8,
    });
    // Same 4×8 grid as level 15, so height fit governs.
    expect(size).toBeCloseTo((480 - 7 * 8) / 8);
  });

  it("clamps to a minimum so cards stay tappable on tiny viewports", () => {
    const size = computeMemoryMatchCardSize({
      level: 30,
      boardWidth: 200,
      boardHeight: 200,
      gap: 8,
      minCardSize: 32,
    });
    expect(size).toBeGreaterThanOrEqual(32);
  });
});

describe("memory match level configs", () => {
  it("provides 30 levels with grid that fits all pairs", () => {
    for (let lvl = 1; lvl <= LEVELS_PER_GAME; lvl++) {
      const cfg = getMemoryMatchLevel(lvl);
      expect(cfg.cols * cfg.rows).toBe(cfg.pairs * 2);
      expect(cfg.previewMs).toBeGreaterThan(0);
      expect(cfg.threeStarMoves).toBeGreaterThanOrEqual(cfg.pairs);
    }
  });

  it("ramps difficulty: later levels are harder than earlier ones overall", () => {
    // Pairs alone is not monotonic — some bands trade pair count for
    // similar-icon sets or shorter previews. Aggregate "difficulty
    // surface" should still be greater at level 30 vs level 1.
    const easy = getMemoryMatchLevel(1);
    const hard = getMemoryMatchLevel(LEVELS_PER_GAME);
    expect(hard.pairs).toBeGreaterThanOrEqual(easy.pairs);
    expect(hard.previewMs).toBeLessThanOrEqual(easy.previewMs);
  });

  it("awards 3/2/1 stars from the move + time bands", () => {
    const cfg = getMemoryMatchLevel(5);
    expect(memoryMatchStars(5, cfg.threeStarMoves, cfg.threeStarTimeSec)).toBe(3);
    expect(
      memoryMatchStars(5, cfg.threeStarMoves + 1, cfg.threeStarTimeSec + 1),
    ).toBeLessThanOrEqual(2);
    expect(memoryMatchStars(5, cfg.pairs * 5, 9999)).toBe(1);
  });
});

describe("24 game level configs", () => {
  it("provides 30 solvable puzzles", () => {
    for (let lvl = 1; lvl <= LEVELS_PER_GAME; lvl++) {
      const nums = generateGame24Puzzle(lvl);
      expect(nums).toHaveLength(4);
      expect(solve24(nums)).not.toBeNull();
      const cfg = getGame24Level(lvl);
      for (const n of nums) {
        expect(n).toBeGreaterThanOrEqual(cfg.numberMin);
        expect(n).toBeLessThanOrEqual(cfg.numberMax);
      }
    }
  });

  it("regression: every generated puzzle is solvable under the level's allowed operators", () => {
    // Without operator-aware solvability, level 1 (only + / -) could
    // hand the player a puzzle that requires × or ÷.
    const { solveWithOps } = require("./gameLevels") as typeof import("./gameLevels");
    for (let lvl = 1; lvl <= LEVELS_PER_GAME; lvl++) {
      const cfg = getGame24Level(lvl);
      // Generate a few puzzles per level to defeat single-sample luck.
      for (let i = 0; i < 5; i++) {
        const nums = generateGame24Puzzle(lvl);
        expect(solveWithOps(nums, cfg.operators)).not.toBeNull();
      }
    }
  });

  it("regression: levels 1–10 are untimed (timeLimitSec === null)", () => {
    for (let lvl = 1; lvl <= 10; lvl++) {
      expect(getGame24Level(lvl).timeLimitSec).toBeNull();
    }
    // …and every later level must have a finite budget.
    for (let lvl = 11; lvl <= LEVELS_PER_GAME; lvl++) {
      const t = getGame24Level(lvl).timeLimitSec;
      expect(t).not.toBeNull();
      expect(t!).toBeGreaterThan(0);
    }
  });

  it("scores stars by solve time vs the level budget", () => {
    const cfg = getGame24Level(15);
    expect(game24Stars(15, cfg.threeStarTimeSec)).toBe(3);
    expect(game24Stars(15, cfg.twoStarTimeSec)).toBe(2);
    expect(game24Stars(15, cfg.twoStarTimeSec + 10)).toBe(1);
  });
});

describe("unlock progression", () => {
  it("highestUnlockedLevel = (max cleared) + 1, starting at 1", () => {
    expect(highestUnlockedLevel({})).toBe(1);
    expect(highestUnlockedLevel({ 1: { stars: 3, bestTimeSec: 5, bestMoves: 8 } })).toBe(2);
    // Only consecutive clears count — gaps stop the unlock walk.
    expect(
      highestUnlockedLevel({
        1: { stars: 3, bestTimeSec: 5, bestMoves: 8 },
        2: { stars: 2, bestTimeSec: 9, bestMoves: 12 },
        5: { stars: 1, bestTimeSec: 30, bestMoves: 30 },
      }),
    ).toBe(3);
  });

  it("locks beyond unlocked, gates Pro past free count", () => {
    const progress: LevelProgressMap = {
      1: { stars: 3, bestTimeSec: 5, bestMoves: 8 },
    };
    expect(levelLockState(1, progress, false)).toBe("unlocked");
    expect(levelLockState(2, progress, false)).toBe("unlocked");
    expect(levelLockState(3, progress, false)).toBe("locked");

    const fullFree: LevelProgressMap = {};
    for (let i = 1; i <= FREE_LEVEL_COUNT; i++) {
      fullFree[i] = { stars: 3, bestTimeSec: 5, bestMoves: 8 };
    }
    expect(levelLockState(FREE_LEVEL_COUNT + 1, fullFree, false)).toBe(
      "pro-locked",
    );
    expect(levelLockState(FREE_LEVEL_COUNT + 1, fullFree, true)).toBe(
      "unlocked",
    );
  });

  it("isLevelCleared and mergeLevelResult preserve best stars/time/moves", () => {
    const empty: LevelProgressMap = {};
    expect(isLevelCleared(1, empty)).toBe(false);
    const after1 = mergeLevelResult(empty, 1, {
      stars: 2,
      bestTimeSec: 30,
      bestMoves: 12,
    });
    expect(isLevelCleared(1, after1)).toBe(true);

    // Worse run must not regress stored best.
    const after2 = mergeLevelResult(after1, 1, {
      stars: 1,
      bestTimeSec: 60,
      bestMoves: 20,
    });
    expect(after2[1].stars).toBe(2);
    expect(after2[1].bestTimeSec).toBe(30);
    expect(after2[1].bestMoves).toBe(12);

    // Better run upgrades each field independently.
    const after3 = mergeLevelResult(after2, 1, {
      stars: 3,
      bestTimeSec: 20,
      bestMoves: 10,
    });
    expect(after3[1].stars).toBe(3);
    expect(after3[1].bestTimeSec).toBe(20);
    expect(after3[1].bestMoves).toBe(10);
  });
});

describe("versusLevelLockState (Task #321)", () => {
  it("locks Versus until the same level is cleared solo", () => {
    const empty: LevelProgressMap = {};
    expect(versusLevelLockState(1, empty, false)).toBe("locked");

    const cleared: LevelProgressMap = {
      1: { stars: 1, bestTimeSec: 30, bestMoves: 12 },
    };
    expect(versusLevelLockState(1, cleared, false)).toBe("unlocked");
    // Solo clear at L1 does NOT unlock Versus at L2.
    expect(versusLevelLockState(2, cleared, false)).toBe("locked");
  });

  it("respects the same Pro paywall as solo", () => {
    const fullFree: LevelProgressMap = {};
    for (let i = 1; i <= FREE_LEVEL_COUNT; i++) {
      fullFree[i] = { stars: 3, bestTimeSec: 5, bestMoves: 8 };
    }
    expect(versusLevelLockState(FREE_LEVEL_COUNT + 1, fullFree, false)).toBe(
      "pro-locked",
    );
    // Even with Pro, an uncleared level stays locked for Versus.
    expect(versusLevelLockState(FREE_LEVEL_COUNT + 1, fullFree, true)).toBe(
      "locked",
    );
  });
});

describe("themed chapters", () => {
  it("partitions all 30 levels across exactly three chapters", () => {
    expect(LEVEL_CHAPTERS).toHaveLength(3);
    const seen = new Set<number>();
    for (const c of LEVEL_CHAPTERS) {
      for (let n = c.startLevel; n <= c.endLevel; n++) seen.add(n);
    }
    expect(seen.size).toBe(LEVELS_PER_GAME);
  });

  it("getChapterForLevel routes each level to the right chapter", () => {
    expect(getChapterForLevel(1).id).toBe("garden");
    expect(getChapterForLevel(10).id).toBe("garden");
    expect(getChapterForLevel(11).id).toBe("city");
    expect(getChapterForLevel(20).id).toBe("city");
    expect(getChapterForLevel(21).id).toBe("cosmos");
    expect(getChapterForLevel(LEVELS_PER_GAME).id).toBe("cosmos");
  });
});

describe("milestones + total stars", () => {
  it("MAX_STARS_PER_GAME is LEVELS_PER_GAME × 3", () => {
    expect(MAX_STARS_PER_GAME).toBe(LEVELS_PER_GAME * 3);
  });

  it("totalStarsEarned sums per-level stars", () => {
    expect(totalStarsEarned({})).toBe(0);
    expect(
      totalStarsEarned({
        1: { stars: 3 },
        2: { stars: 2 },
        3: { stars: 1 },
      }),
    ).toBe(6);
  });

  it("milestones land on every 5th level from 5 to 30", () => {
    expect(LEVEL_MILESTONES.map((m) => m.level)).toEqual([5, 10, 15, 20, 25, 30]);
  });

  it("nextMilestone returns the first uncleared milestone level, or null when all are cleared", () => {
    expect(nextMilestone({})?.level).toBe(5);
    const after5: LevelProgressMap = {
      1: { stars: 1 },
      2: { stars: 1 },
      3: { stars: 1 },
      4: { stars: 1 },
      5: { stars: 2 },
    };
    expect(nextMilestone(after5)?.level).toBe(10);
    const all: LevelProgressMap = {};
    for (let n = 1; n <= LEVELS_PER_GAME; n++) all[n] = { stars: 1 };
    expect(nextMilestone(all)).toBeNull();
  });

  it("milestoneCrossedBy fires only when the just-cleared level is a fresh milestone", () => {
    // Non-milestone level → null even on first clear.
    expect(milestoneCrossedBy({}, 4)).toBeNull();
    // First clear of a milestone level → milestone returned.
    expect(milestoneCrossedBy({}, 5)?.level).toBe(5);
    // Repeat clear of an already-cleared milestone → null
    // (otherwise the celebration toast would re-fire on every replay).
    const already: LevelProgressMap = { 5: { stars: 2 } };
    expect(milestoneCrossedBy(already, 5)).toBeNull();
  });
});
