/**
 * Pure scoring + round-shape generators for Skills Bundle 1
 * (Task #337). One module per skill would have been overkill — every
 * skill's round shape is a few numbers and a deterministic seed, and
 * keeping them together makes it obvious that the friend-challenge
 * link → round mapping is the same recipe everywhere.
 *
 * No React, no AsyncStorage, no audio. Game screens import the
 * `build*Round` helpers to seed their state and the `score*` helpers
 * to convert raw play stats into a final integer score that's
 * comparable across friend challenges.
 */

import { getSkill, type SkillId } from "./skillsBundle";

// ---------------------------------------------------------------------
// Seedable PRNG (Mulberry32). Mirrors the one in lib/memOpponent.ts so
// "same seed → same stream" holds across the codebase. We re-declare
// it here instead of importing to keep skill modules independent of
// the existing 24-Game / Memory-Match opponent code.
// ---------------------------------------------------------------------

interface SeededRng {
  next(): number;
  /** Integer in [0, max). max must be a positive integer. */
  nextInt(max: number): number;
  /** Pick one element from a non-empty array. */
  pick<T>(arr: readonly T[]): T;
}

export function makeRng(seed: number): SeededRng {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt(max: number) {
      if (max <= 0) return 0;
      return Math.floor(next() * max);
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error("pick from empty array");
      return arr[Math.floor(next() * arr.length)]!;
    },
  };
}

/**
 * Combine the friend-challenge round seed with the skill's salt so the
 * same `seed` value never resolves to "the same numbers" across two
 * different skills. Returned as a uint32.
 */
export function deriveSkillSeed(skillId: SkillId, baseSeed: number): number {
  const salt = getSkill(skillId).seedSalt >>> 0;
  // Splittable mix — xor + Math.imul mirrors what the Mulberry32
  // reseed step does, which keeps the distribution flat.
  let s = ((baseSeed >>> 0) ^ salt) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x7feb352d) >>> 0;
  s = Math.imul(s ^ (s >>> 15), 0x846ca68b) >>> 0;
  return (s ^ (s >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------
// Mem Says — Simon-style colour pattern.
//   Round = a sequence of colour indices (0..3) of length depending
//   on level. Score = (longest correct prefix the player echoed) ×
//   100. A perfect echo also adds a 25-point speed bonus when the
//   total response time is under the par window.
// ---------------------------------------------------------------------

export const MEM_SAYS_COLORS = ["red", "blue", "green", "yellow"] as const;
export type MemSaysColor = (typeof MEM_SAYS_COLORS)[number];

export interface MemSaysRound {
  /** Colour-index sequence. Player must echo it in order. */
  sequence: MemSaysColor[];
  /** Per-round par time in seconds for the speed bonus. */
  parTimeSec: number;
}

export function buildMemSaysRound(seed: number, level = 1): MemSaysRound {
  const length = Math.max(4, Math.min(12, 3 + level));
  const rng = makeRng(deriveSkillSeed("mem_says", seed));
  const sequence: MemSaysColor[] = [];
  for (let i = 0; i < length; i++) {
    sequence.push(rng.pick(MEM_SAYS_COLORS));
  }
  return { sequence, parTimeSec: length * 1.2 };
}

export function scoreMemSays(input: {
  round: MemSaysRound;
  echoed: MemSaysColor[];
  elapsedSec: number;
}): number {
  let correct = 0;
  for (
    let i = 0;
    i < input.echoed.length && i < input.round.sequence.length;
    i++
  ) {
    if (input.echoed[i] === input.round.sequence[i]) correct += 1;
    else break;
  }
  let score = correct * 100;
  if (
    correct === input.round.sequence.length &&
    input.elapsedSec <= input.round.parTimeSec
  ) {
    score += 25;
  }
  return score;
}

// ---------------------------------------------------------------------
// Signal Sort — incoming "signals" with a hidden category. Player
//   taps the matching bin (left/right). Round = an ordered list of
//   signals with the right answer already baked in. Score = correct
//   sorts × 50, minus 10 per wrong sort (floored at 0).
// ---------------------------------------------------------------------

export type SignalBin = "left" | "right";

export interface Signal {
  label: string;
  correctBin: SignalBin;
}

export interface SignalSortRound {
  signals: Signal[];
  /** Per-signal time budget in seconds. */
  perSignalTimeSec: number;
}

const SIGNAL_LABELS_LEFT = [
  "Even",
  "Vowel",
  "North",
  "Cold",
  "Past",
  "Soft",
] as const;
const SIGNAL_LABELS_RIGHT = [
  "Odd",
  "Consonant",
  "South",
  "Warm",
  "Future",
  "Loud",
] as const;

export function buildSignalSortRound(seed: number, level = 1): SignalSortRound {
  const length = Math.max(8, Math.min(20, 6 + level * 2));
  const rng = makeRng(deriveSkillSeed("signal_sort", seed));
  const signals: Signal[] = [];
  for (let i = 0; i < length; i++) {
    const goesLeft = rng.next() < 0.5;
    const label = goesLeft
      ? rng.pick(SIGNAL_LABELS_LEFT)
      : rng.pick(SIGNAL_LABELS_RIGHT);
    signals.push({ label, correctBin: goesLeft ? "left" : "right" });
  }
  return { signals, perSignalTimeSec: 1.5 };
}

export function scoreSignalSort(input: {
  round: SignalSortRound;
  answers: SignalBin[];
}): number {
  let correct = 0;
  let wrong = 0;
  for (
    let i = 0;
    i < input.answers.length && i < input.round.signals.length;
    i++
  ) {
    if (input.answers[i] === input.round.signals[i]!.correctBin) correct += 1;
    else wrong += 1;
  }
  return Math.max(0, correct * 50 - wrong * 10);
}

// ---------------------------------------------------------------------
// Pattern Path — a path of grid coordinates the player has to retrace.
//   Score = (longest correct prefix) × 75 + 50 perfect bonus.
// ---------------------------------------------------------------------

export interface PathCell {
  row: number;
  col: number;
}

export interface PatternPathRound {
  gridSize: number;
  path: PathCell[];
}

export function buildPatternPathRound(
  seed: number,
  level = 1,
): PatternPathRound {
  const gridSize = level >= 5 ? 5 : level >= 3 ? 4 : 3;
  const length = Math.max(4, Math.min(10, 3 + level));
  const rng = makeRng(deriveSkillSeed("pattern_path", seed));
  const path: PathCell[] = [];
  // Start at a random cell, then walk to a 4-neighbour each step,
  // resampling if we'd revisit a cell. Bounded retries keep the
  // generator deterministic and cheap.
  const visited = new Set<string>();
  let cur: PathCell = {
    row: rng.nextInt(gridSize),
    col: rng.nextInt(gridSize),
  };
  path.push(cur);
  visited.add(`${cur.row},${cur.col}`);
  while (path.length < length) {
    const candidates: PathCell[] = [
      { row: cur.row - 1, col: cur.col },
      { row: cur.row + 1, col: cur.col },
      { row: cur.row, col: cur.col - 1 },
      { row: cur.row, col: cur.col + 1 },
    ].filter(
      (c) =>
        c.row >= 0 &&
        c.row < gridSize &&
        c.col >= 0 &&
        c.col < gridSize &&
        !visited.has(`${c.row},${c.col}`),
    );
    if (candidates.length === 0) break;
    cur = rng.pick(candidates);
    path.push(cur);
    visited.add(`${cur.row},${cur.col}`);
  }
  return { gridSize, path };
}

export function scorePatternPath(input: {
  round: PatternPathRound;
  trace: PathCell[];
}): number {
  let correct = 0;
  for (
    let i = 0;
    i < input.trace.length && i < input.round.path.length;
    i++
  ) {
    const a = input.trace[i]!;
    const b = input.round.path[i]!;
    if (a.row === b.row && a.col === b.col) correct += 1;
    else break;
  }
  let score = correct * 75;
  if (correct === input.round.path.length) score += 50;
  return score;
}

// ---------------------------------------------------------------------
// Echo Count — the player hears N chimes and types the count.
//   Score = max(0, 100 - |delta| × 25).
// ---------------------------------------------------------------------

export interface EchoCountRound {
  /** True chime count the player has to recover. */
  count: number;
  /** Delay between chimes in milliseconds. */
  intervalMs: number;
}

export function buildEchoCountRound(seed: number, level = 1): EchoCountRound {
  const rng = makeRng(deriveSkillSeed("echo_count", seed));
  const min = Math.max(3, level + 2);
  const max = Math.max(min + 1, level * 2 + 4);
  const count = min + rng.nextInt(max - min + 1);
  const intervalMs = 700 - Math.min(300, level * 30);
  return { count, intervalMs };
}

export function scoreEchoCount(input: {
  round: EchoCountRound;
  guess: number;
}): number {
  if (!Number.isFinite(input.guess)) return 0;
  const delta = Math.abs(Math.floor(input.guess) - input.round.count);
  return Math.max(0, 100 - delta * 25);
}
