/**
 * Level ladders for Memory Match and 24 Game.
 *
 * See `docs/games/LEVELS_SPEC.md` for the human-readable spec.
 *
 * This file is the single source of truth for:
 *   - per-level configuration (pair count, grid, time budget, etc.)
 *   - star-rating thresholds
 *   - unlock math (which level is the next playable level)
 *   - free-vs-Pro gating (which levels require Pro)
 *
 * Pure module: no React, no AsyncStorage, no network. All state lives
 * in `gameStats.ts` / `GameStatsContext.tsx`. Tests import from here
 * directly.
 */

import { solve24 } from "./game24Solver";

export const LEVELS_PER_GAME = 30;
export const FREE_LEVEL_COUNT = 10;

export type Stars = 1 | 2 | 3;

export interface LevelProgress {
  stars: Stars;
  bestTimeSec?: number | null;
  bestMoves?: number | null;
}

// ---------------------------------------------------------------------
// Memory Match level configs.
// ---------------------------------------------------------------------

export interface MemoryMatchLevelConfig {
  level: number;
  pairs: number;
  cols: number;
  rows: number;
  previewMs: number;
  /** When true, draw from the "similar-looking" icon subset. */
  similarIcons: boolean;
  /** ≤ moves to earn 3 stars. */
  threeStarMoves: number;
  /** ≤ seconds to earn 3 stars. */
  threeStarTimeSec: number;
  /** ≤ moves to earn 2 stars (clear at any moves earns 1). */
  twoStarMoves: number;
}

interface MemoryMatchBand {
  pairs: number;
  cols: number;
  rows: number;
  previewMs: number;
  similar: boolean;
}

// 30 entries. Indexed by level - 1.
const MEMORY_MATCH_BANDS: MemoryMatchBand[] = [
  // 1-3
  { pairs: 3, cols: 2, rows: 3, previewMs: 2200, similar: false },
  { pairs: 4, cols: 4, rows: 2, previewMs: 2200, similar: false },
  { pairs: 4, cols: 4, rows: 2, previewMs: 2200, similar: false },
  // 4-6
  { pairs: 6, cols: 4, rows: 3, previewMs: 1800, similar: false },
  { pairs: 6, cols: 4, rows: 3, previewMs: 1800, similar: false },
  { pairs: 8, cols: 4, rows: 4, previewMs: 1800, similar: false },
  // 7-10
  { pairs: 8, cols: 4, rows: 4, previewMs: 1500, similar: false },
  { pairs: 10, cols: 4, rows: 5, previewMs: 1500, similar: false },
  { pairs: 10, cols: 4, rows: 5, previewMs: 1500, similar: false },
  { pairs: 12, cols: 4, rows: 6, previewMs: 1500, similar: false },
  // 11-15
  { pairs: 12, cols: 4, rows: 6, previewMs: 1200, similar: false },
  { pairs: 14, cols: 4, rows: 7, previewMs: 1200, similar: false },
  { pairs: 14, cols: 4, rows: 7, previewMs: 1200, similar: false },
  { pairs: 15, cols: 5, rows: 6, previewMs: 1200, similar: false },
  { pairs: 16, cols: 4, rows: 8, previewMs: 1200, similar: false },
  // 16-20
  { pairs: 16, cols: 4, rows: 8, previewMs: 1000, similar: false },
  { pairs: 18, cols: 6, rows: 6, previewMs: 1000, similar: false },
  { pairs: 18, cols: 6, rows: 6, previewMs: 1000, similar: false },
  { pairs: 18, cols: 6, rows: 6, previewMs: 1000, similar: false },
  { pairs: 18, cols: 6, rows: 6, previewMs: 1000, similar: false },
  // 21-25
  { pairs: 12, cols: 4, rows: 6, previewMs: 900, similar: true },
  { pairs: 14, cols: 4, rows: 7, previewMs: 900, similar: true },
  { pairs: 14, cols: 4, rows: 7, previewMs: 900, similar: true },
  { pairs: 16, cols: 4, rows: 8, previewMs: 900, similar: true },
  { pairs: 16, cols: 4, rows: 8, previewMs: 900, similar: true },
  // 26-30
  { pairs: 16, cols: 4, rows: 8, previewMs: 700, similar: true },
  { pairs: 18, cols: 6, rows: 6, previewMs: 700, similar: true },
  { pairs: 18, cols: 6, rows: 6, previewMs: 700, similar: true },
  { pairs: 18, cols: 6, rows: 6, previewMs: 700, similar: true },
  { pairs: 18, cols: 6, rows: 6, previewMs: 700, similar: true },
];

export function getMemoryMatchLevel(level: number): MemoryMatchLevelConfig {
  const idx = clampLevelIndex(level);
  const band = MEMORY_MATCH_BANDS[idx];
  const { pairs, cols, rows, previewMs, similar } = band;
  return {
    level: idx + 1,
    pairs,
    cols,
    rows,
    previewMs,
    similarIcons: similar,
    threeStarMoves: pairs + Math.ceil(pairs * 0.5),
    threeStarTimeSec: pairs * 4,
    twoStarMoves: pairs * 2,
  };
}

/**
 * Compute the per-card pixel size for a Memory Match level on a given
 * viewport, constrained by BOTH width and available board height so
 * tall grids (e.g. 4×7, 4×8) never clip on shorter devices. Pure so
 * tests can pin compact-viewport regressions without rendering.
 */
export function computeMemoryMatchCardSize(args: {
  level: number;
  boardWidth: number;
  boardHeight: number;
  gap: number;
  /** Lower clamp so cards stay tappable even on tiny viewports. */
  minCardSize?: number;
}): number {
  const { level, boardWidth, boardHeight, gap } = args;
  const minCardSize = args.minCardSize ?? 32;
  const cfg = getMemoryMatchLevel(level);
  const widthFit = (boardWidth - (cfg.cols - 1) * gap) / cfg.cols;
  const heightFit = (boardHeight - (cfg.rows - 1) * gap) / cfg.rows;
  return Math.max(minCardSize, Math.min(widthFit, heightFit));
}

export function memoryMatchStars(
  level: number,
  moves: number,
  timeSec: number,
): Stars {
  const cfg = getMemoryMatchLevel(level);
  if (moves <= cfg.threeStarMoves && timeSec <= cfg.threeStarTimeSec) return 3;
  if (moves <= cfg.twoStarMoves) return 2;
  return 1;
}

// ---------------------------------------------------------------------
// 24 Game level configs.
// ---------------------------------------------------------------------

export type Game24Operator = "+" | "-" | "*" | "/";

export interface Game24LevelConfig {
  level: number;
  /** Inclusive number range. */
  numberMin: number;
  numberMax: number;
  operators: Game24Operator[];
  /** null = no timer. */
  timeLimitSec: number | null;
  /** When true, reject puzzles that are solvable using only + and ×. */
  trickySet: boolean;
  /** ≤ seconds to earn 3 stars (relative to the budget). */
  threeStarTimeSec: number;
  /** ≤ seconds to earn 2 stars (relative to the budget). */
  twoStarTimeSec: number;
}

interface Game24Band {
  numberMin: number;
  numberMax: number;
  operators: Game24Operator[];
  timeLimitSec: number | null;
  tricky: boolean;
}

const GAME_24_BANDS: Game24Band[] = [
  // 1-3
  { numberMin: 1, numberMax: 6, operators: ["+", "-"], timeLimitSec: null, tricky: false },
  { numberMin: 1, numberMax: 6, operators: ["+", "-"], timeLimitSec: null, tricky: false },
  { numberMin: 1, numberMax: 6, operators: ["+", "-"], timeLimitSec: null, tricky: false },
  // 4-6
  { numberMin: 1, numberMax: 9, operators: ["+", "-", "*"], timeLimitSec: null, tricky: false },
  { numberMin: 1, numberMax: 9, operators: ["+", "-", "*"], timeLimitSec: null, tricky: false },
  { numberMin: 1, numberMax: 9, operators: ["+", "-", "*"], timeLimitSec: null, tricky: false },
  // 7-10
  { numberMin: 1, numberMax: 9, operators: ["+", "-", "*", "/"], timeLimitSec: null, tricky: false },
  { numberMin: 1, numberMax: 9, operators: ["+", "-", "*", "/"], timeLimitSec: null, tricky: false },
  { numberMin: 1, numberMax: 9, operators: ["+", "-", "*", "/"], timeLimitSec: null, tricky: false },
  { numberMin: 1, numberMax: 9, operators: ["+", "-", "*", "/"], timeLimitSec: null, tricky: false },
  // 11-15
  { numberMin: 1, numberMax: 10, operators: ["+", "-", "*", "/"], timeLimitSec: 90, tricky: false },
  { numberMin: 1, numberMax: 10, operators: ["+", "-", "*", "/"], timeLimitSec: 90, tricky: false },
  { numberMin: 1, numberMax: 10, operators: ["+", "-", "*", "/"], timeLimitSec: 90, tricky: false },
  { numberMin: 1, numberMax: 10, operators: ["+", "-", "*", "/"], timeLimitSec: 90, tricky: false },
  { numberMin: 1, numberMax: 10, operators: ["+", "-", "*", "/"], timeLimitSec: 90, tricky: false },
  // 16-20
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 75, tricky: false },
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 75, tricky: false },
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 75, tricky: false },
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 75, tricky: false },
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 75, tricky: false },
  // 21-25
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 60, tricky: true },
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 60, tricky: true },
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 60, tricky: true },
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 60, tricky: true },
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 60, tricky: true },
  // 26-30
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 45, tricky: true },
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 45, tricky: true },
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 45, tricky: true },
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 45, tricky: true },
  { numberMin: 1, numberMax: 13, operators: ["+", "-", "*", "/"], timeLimitSec: 45, tricky: true },
];

export function getGame24Level(level: number): Game24LevelConfig {
  const idx = clampLevelIndex(level);
  const band = GAME_24_BANDS[idx];
  const budget = band.timeLimitSec ?? 50;
  return {
    level: idx + 1,
    numberMin: band.numberMin,
    numberMax: band.numberMax,
    operators: band.operators,
    timeLimitSec: band.timeLimitSec,
    trickySet: band.tricky,
    threeStarTimeSec:
      band.timeLimitSec === null ? 15 : Math.max(5, Math.floor(budget * 0.3)),
    twoStarTimeSec:
      band.timeLimitSec === null ? 40 : Math.max(10, Math.floor(budget * 0.6)),
  };
}

export function game24Stars(level: number, solveTimeSec: number): Stars {
  const cfg = getGame24Level(level);
  if (solveTimeSec <= cfg.threeStarTimeSec) return 3;
  if (solveTimeSec <= cfg.twoStarTimeSec) return 2;
  return 1;
}

// ---------------------------------------------------------------------
// 24 Game puzzle generation (level-aware).
// ---------------------------------------------------------------------

/**
 * Pick a 4-number puzzle that matches the level's constraints AND is
 * solvable by the existing solver.
 *
 * For tricky-set levels, also reject puzzles whose only solutions
 * use just + and × — those are too easy to brute-force.
 */
export function generateGame24Puzzle(level: number): number[] {
  const cfg = getGame24Level(level);
  const range = cfg.numberMax - cfg.numberMin + 1;
  for (let attempt = 0; attempt < 500; attempt++) {
    const nums = Array.from(
      { length: 4 },
      () => Math.floor(Math.random() * range) + cfg.numberMin,
    );
    // Solvability MUST be checked under the level's allowed
    // operator set — otherwise level 1 (which only allows + / -)
    // can hand the player a puzzle that requires × or ÷.
    if (!solveWithOps(nums, cfg.operators)) continue;
    if (cfg.trickySet) {
      // Reject if it's solvable using ONLY + and × (i.e. trivial).
      if (solveWithOps(nums, ["+", "*"])) continue;
    }
    return nums;
  }
  // Documented escape valve so we never deadlock the user, but it
  // STILL respects the level's operator constraint.
  while (true) {
    const nums = Array.from(
      { length: 4 },
      () => Math.floor(Math.random() * range) + cfg.numberMin,
    );
    if (solveWithOps(nums, cfg.operators)) return nums;
  }
}

/**
 * Restricted-operator 24-solver used to detect "trivially solvable"
 * puzzles for the tricky-set gate.
 */
export function solveWithOps(
  nums: number[],
  ops: Game24Operator[],
): string | null {
  type Expr = { value: number; expr: string };
  const initial: Expr[] = nums.map((n) => ({ value: n, expr: n.toString() }));
  return search(initial);

  function search(exprs: Expr[]): string | null {
    if (exprs.length === 1) {
      return Math.abs(exprs[0].value - 24) < 1e-6 ? exprs[0].expr : null;
    }
    for (let i = 0; i < exprs.length; i++) {
      for (let j = 0; j < exprs.length; j++) {
        if (i === j) continue;
        const a = exprs[i];
        const b = exprs[j];
        const rest = exprs.filter((_, idx) => idx !== i && idx !== j);
        for (const op of ops) {
          let v: number;
          if (op === "+") v = a.value + b.value;
          else if (op === "-") v = a.value - b.value;
          else if (op === "*") v = a.value * b.value;
          else {
            if (Math.abs(b.value) < 1e-6) continue;
            v = a.value / b.value;
          }
          const r = search([...rest, { value: v, expr: `(${a.expr}${op}${b.expr})` }]);
          if (r) return r;
        }
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------
// Unlock + Pro gating.
// ---------------------------------------------------------------------

export type LevelProgressMap = Record<number, LevelProgress>;

/**
 * Return the highest unlocked level for a given progress map.
 * Level 1 is always unlocked. Each cleared level (≥ 1 star) unlocks
 * the next.
 */
export function highestUnlockedLevel(progress: LevelProgressMap): number {
  let unlocked = 1;
  for (let n = 1; n <= LEVELS_PER_GAME; n++) {
    if (progress[n] && progress[n].stars >= 1) {
      unlocked = Math.min(LEVELS_PER_GAME, n + 1);
    } else {
      break;
    }
  }
  return unlocked;
}

export type LevelLockState = "unlocked" | "locked" | "pro-locked";

export function levelLockState(
  level: number,
  progress: LevelProgressMap,
  isPro: boolean,
): LevelLockState {
  if (!isPro && level > FREE_LEVEL_COUNT) return "pro-locked";
  if (level <= highestUnlockedLevel(progress)) return "unlocked";
  return "locked";
}

export function isLevelCleared(
  level: number,
  progress: LevelProgressMap,
): boolean {
  return !!progress[level] && progress[level].stars >= 1;
}

/**
 * Versus Mem unlock pairing (Task #321): Versus is unlocked on a level
 * iff the user has CLEARED the same level solo (and the level is not
 * Pro-locked). Free vs Pro applies the same gate as solo so no
 * separate paywall is invented.
 */
export function versusLevelLockState(
  level: number,
  soloProgress: LevelProgressMap,
  isPro: boolean,
): LevelLockState {
  if (!isPro && level > FREE_LEVEL_COUNT) return "pro-locked";
  if (isLevelCleared(level, soloProgress)) return "unlocked";
  return "locked";
}

/**
 * Merge a new level result into the progress map: keep the best star
 * count + best metrics per level. Returns a new map.
 */
export function mergeLevelResult(
  progress: LevelProgressMap,
  level: number,
  result: LevelProgress,
): LevelProgressMap {
  const prev = progress[level];
  const next: LevelProgress = { ...result };
  if (prev) {
    next.stars = Math.max(prev.stars, result.stars) as Stars;
    if (prev.bestTimeSec != null && result.bestTimeSec != null) {
      next.bestTimeSec = Math.min(prev.bestTimeSec, result.bestTimeSec);
    } else {
      next.bestTimeSec = result.bestTimeSec ?? prev.bestTimeSec ?? null;
    }
    if (prev.bestMoves != null && result.bestMoves != null) {
      next.bestMoves = Math.min(prev.bestMoves, result.bestMoves);
    } else {
      next.bestMoves = result.bestMoves ?? prev.bestMoves ?? null;
    }
  }
  return { ...progress, [level]: next };
}

// ---------------------------------------------------------------------
// Themed chapters + milestones for the level-select ladder.
//
// The ladder is split into three themed chapters of 10 levels each:
//   1–10  Garden  (warm pastel — onboarding chapter)
//   11–20 City    (cool blue/purple — mid-game)
//   21–30 Cosmos  (deep violet/teal — endgame)
//
// Milestones land on every 5th level (5, 10, 15, 20, 25, 30) and
// describe the reward unlocked when the player crosses that level
// for the first time. The MilestoneToast component reads from this
// list, and the LevelLadder header surfaces the NEXT unmet milestone.
// ---------------------------------------------------------------------

export interface LevelChapter {
  id: "garden" | "city" | "cosmos";
  title: string;
  subtitle: string;
  startLevel: number;
  endLevel: number;
  /** Background tint behind the chapter banner. */
  background: string;
  /** Banner accent / connector path color. */
  accent: string;
  /** Emoji glyph rendered in the chapter banner. */
  glyph: string;
}

export const LEVEL_CHAPTERS: LevelChapter[] = [
  {
    id: "garden",
    title: "Garden",
    subtitle: "Levels 1–10",
    startLevel: 1,
    endLevel: 10,
    background: "rgba(94, 234, 212, 0.10)",
    accent: "#5eead4",
    glyph: "🌿",
  },
  {
    id: "city",
    title: "City",
    subtitle: "Levels 11–20",
    startLevel: 11,
    endLevel: 20,
    background: "rgba(167, 139, 250, 0.12)",
    accent: "#a78bfa",
    glyph: "🏙️",
  },
  {
    id: "cosmos",
    title: "Cosmos",
    subtitle: "Levels 21–30",
    startLevel: 21,
    endLevel: 30,
    background: "rgba(244, 114, 182, 0.10)",
    accent: "#f472b6",
    glyph: "✨",
  },
];

export function getChapterForLevel(level: number): LevelChapter {
  for (const c of LEVEL_CHAPTERS) {
    if (level >= c.startLevel && level <= c.endLevel) return c;
  }
  return LEVEL_CHAPTERS[LEVEL_CHAPTERS.length - 1];
}

export interface LevelMilestone {
  /** The level the player must clear to earn this milestone. */
  level: number;
  title: string;
  description: string;
  glyph: string;
}

export const LEVEL_MILESTONES: LevelMilestone[] = [
  {
    level: 5,
    title: "First Sprout",
    description: "You're growing your memory garden.",
    glyph: "🌱",
  },
  {
    level: 10,
    title: "Garden Bloom",
    description: "You've cleared the Garden chapter.",
    glyph: "🌸",
  },
  {
    level: 15,
    title: "Skyline Spark",
    description: "Halfway up the City skyline.",
    glyph: "🌆",
  },
  {
    level: 20,
    title: "City Lights",
    description: "The City chapter is yours.",
    glyph: "🌃",
  },
  {
    level: 25,
    title: "Stargazer",
    description: "You've reached the Cosmos.",
    glyph: "🌠",
  },
  {
    level: 30,
    title: "Cosmic Master",
    description: "Every level cleared. Legendary.",
    glyph: "🪐",
  },
];

/** Maximum total stars across the whole ladder (LEVELS_PER_GAME × 3). */
export const MAX_STARS_PER_GAME = LEVELS_PER_GAME * 3;

export function totalStarsEarned(progress: LevelProgressMap): number {
  let total = 0;
  for (let n = 1; n <= LEVELS_PER_GAME; n++) {
    if (progress[n]) total += progress[n].stars;
  }
  return total;
}

/**
 * Next milestone the player has not yet earned, or `null` once every
 * milestone has been cleared (i.e. level 30 is at ≥ 1 star).
 */
export function nextMilestone(
  progress: LevelProgressMap,
): LevelMilestone | null {
  for (const m of LEVEL_MILESTONES) {
    if (!isLevelCleared(m.level, progress)) return m;
  }
  return null;
}

/**
 * Returns the milestone that just became cleared by this result, or
 * `null` if it was already cleared (or if `level` isn't a milestone
 * boundary). Used by the in-level win flow to fire the celebration
 * the FIRST time a player crosses a milestone.
 */
export function milestoneCrossedBy(
  prevProgress: LevelProgressMap,
  level: number,
): LevelMilestone | null {
  const milestone = LEVEL_MILESTONES.find((m) => m.level === level);
  if (!milestone) return null;
  if (isLevelCleared(level, prevProgress)) return null;
  return milestone;
}

function clampLevelIndex(level: number): number {
  if (!Number.isFinite(level) || level < 1) return 0;
  if (level > LEVELS_PER_GAME) return LEVELS_PER_GAME - 1;
  return Math.floor(level) - 1;
}
