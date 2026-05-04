/**
 * Mem opponent for Versus Mem mode (Task #321).
 *
 * Pure module. No React, no AsyncStorage, no network. All randomness
 * goes through a seedable PRNG so tests can pin behaviour
 * deterministically.
 *
 * - Memory Match: a tunable "memory model" — Mem remembers each
 *   previously-revealed card with a per-level recall probability
 *   (forgetful early, near-perfect late) and picks the highest-value
 *   pair on its turn.
 * - 24 Game: a "thinking delay" before Mem submits the existing
 *   `solve24` answer, calibrated per level. A small concede chance
 *   keeps tight hands beatable so the user never feels cheated.
 * - Voice lines: a small curated string table per event, with
 *   "no immediate repeat" picking via the shared RNG.
 */

import { LEVELS_PER_GAME } from "./gameLevels";

// ---------------------------------------------------------------------
// Player-selected difficulty (Task #330).
//
// Scales Mem's recall and 24-game thinking delay independently of the
// level number so a player can have a harder Mem on early levels (or
// an easier one on late levels).
// ---------------------------------------------------------------------
export type MemDifficulty = "easy" | "normal" | "hard";

/** Additive offset applied to memoryMatchRecallProbability before clamp. */
const RECALL_OFFSET: Record<MemDifficulty, number> = {
  easy: -0.2,
  normal: 0,
  hard: 0.2,
};

/** Multiplier applied to the 24-game thinking delay baseline. */
const THINKING_DELAY_MULTIPLIER: Record<MemDifficulty, number> = {
  easy: 1.5,
  normal: 1,
  hard: 0.6,
};

// ---------------------------------------------------------------------
// Seedable PRNG (Mulberry32). Same algorithm produces the same stream
// for the same seed, which is what the tests rely on.
// ---------------------------------------------------------------------
export interface SeedableRng {
  next(): number;
}

export function makeSeedableRng(seed: number): SeedableRng {
  let s = (seed >>> 0) || 1;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

// ---------------------------------------------------------------------
// Memory Match opponent.
// ---------------------------------------------------------------------

/**
 * Per-level recall probability — at decision time, Mem "remembers"
 * each previously-revealed card with this probability. Linear ramp
 * from 0.25 at level 1 to 0.95 at level 30 keeps Mem beatable on
 * early levels and near-perfect (but not perfect) on the last ones.
 */
export function memoryMatchRecallProbability(
  level: number,
  difficulty: MemDifficulty = "normal",
): number {
  const clamped = Math.max(1, Math.min(LEVELS_PER_GAME, Math.floor(level)));
  const t = (clamped - 1) / (LEVELS_PER_GAME - 1);
  const min = 0.25;
  const max = 0.95;
  const base = min + t * (max - min);
  const adjusted = base + RECALL_OFFSET[difficulty];
  // Keep recall in a sensible range — never perfect, never zero, so
  // Mem stays beatable on hard yet still capable on easy.
  return Math.max(0.05, Math.min(0.99, adjusted));
}

export interface MemoryMatchPick {
  first: number;
  second: number;
}

export interface MemoryMatchPickArgs {
  /** Index → icon for every card the user or Mem has flipped at least once. */
  revealed: Map<number, string>;
  /** Card indices already matched (excluded from picks). */
  matched: Set<number>;
  totalCards: number;
  rng: SeedableRng;
  level: number;
  difficulty?: MemDifficulty;
}

/**
 * Choose Mem's two card flips for one Memory Match turn.
 *
 * Strategy:
 *  1. Build the "remembered" subset of `revealed` by sampling each
 *     entry against the level's recall probability.
 *  2. If the remembered set contains a known pair, flip it (guaranteed
 *     match).
 *  3. Otherwise pick an unrevealed card; if its icon happens to be
 *     remembered elsewhere, flip that as the second card; otherwise
 *     pick another distinct unrevealed (or any unmatched) card.
 *
 * Always returns two distinct, unmatched indices when at least two
 * unmatched cards exist.
 */
export function chooseMemoryMatchPick(
  args: MemoryMatchPickArgs,
): MemoryMatchPick {
  const { revealed, matched, totalCards, rng, level, difficulty } = args;
  const recall = memoryMatchRecallProbability(level, difficulty ?? "normal");

  const remembered = new Map<number, string>();
  for (const [idx, icon] of revealed) {
    if (matched.has(idx)) continue;
    if (rng.next() < recall) remembered.set(idx, icon);
  }

  const byIcon = new Map<string, number[]>();
  for (const [idx, icon] of remembered) {
    const arr = byIcon.get(icon);
    if (arr) arr.push(idx);
    else byIcon.set(icon, [idx]);
  }
  for (const [, idxs] of byIcon) {
    if (idxs.length >= 2) {
      return { first: idxs[0], second: idxs[1] };
    }
  }

  const unseen: number[] = [];
  for (let i = 0; i < totalCards; i++) {
    if (matched.has(i)) continue;
    if (revealed.has(i)) continue;
    unseen.push(i);
  }

  let first: number;
  if (unseen.length > 0) {
    first = unseen[Math.floor(rng.next() * unseen.length)];
  } else {
    const allUnmatched: number[] = [];
    for (let i = 0; i < totalCards; i++) {
      if (!matched.has(i)) allUnmatched.push(i);
    }
    first = allUnmatched[Math.floor(rng.next() * allUnmatched.length)];
  }

  // If first happens to be a card already revealed (only possible in
  // the fallback branch), see if its icon match is remembered.
  const firstIcon = revealed.get(first);
  if (firstIcon !== undefined) {
    const candidates =
      byIcon.get(firstIcon)?.filter((i) => i !== first) ?? [];
    if (candidates.length > 0) {
      return { first, second: candidates[0] };
    }
  }

  const remainingUnseen = unseen.filter((i) => i !== first);
  if (remainingUnseen.length > 0) {
    const second =
      remainingUnseen[Math.floor(rng.next() * remainingUnseen.length)];
    return { first, second };
  }

  const remainingAny: number[] = [];
  for (let i = 0; i < totalCards; i++) {
    if (!matched.has(i) && i !== first) remainingAny.push(i);
  }
  if (remainingAny.length === 0) {
    // Degenerate: only one card left. Caller should handle this case
    // before invoking us, but stay safe.
    return { first, second: first };
  }
  const second =
    remainingAny[Math.floor(rng.next() * remainingAny.length)];
  return { first, second };
}

// ---------------------------------------------------------------------
// 24 Game opponent.
// ---------------------------------------------------------------------

/**
 * Calibrated "thinking time" in ms before Mem submits the solver's
 * answer. Faster at higher levels; jittered ±30% via the shared RNG so
 * tests can pin it deterministically.
 *
 * Level 1 → ~12s baseline; Level 30 → ~3s baseline.
 */
export function game24ThinkingDelayMs(
  level: number,
  rng: SeedableRng,
  difficulty: MemDifficulty = "normal",
): number {
  const clamped = Math.max(1, Math.min(LEVELS_PER_GAME, Math.floor(level)));
  const t = (clamped - 1) / (LEVELS_PER_GAME - 1);
  const baseMs = (12000 - t * 9000) * THINKING_DELAY_MULTIPLIER[difficulty];
  const jitter = 0.7 + rng.next() * 0.6;
  return Math.max(1500, Math.round(baseMs * jitter));
}

/**
 * Probability that Mem "concedes" a tight hand on this level — i.e.
 * intentionally takes longer (or doesn't submit) so the user has a
 * fighting chance. Higher early, near-zero late.
 */
export function game24ConcedeProbability(level: number): number {
  const clamped = Math.max(1, Math.min(LEVELS_PER_GAME, Math.floor(level)));
  const t = (clamped - 1) / (LEVELS_PER_GAME - 1);
  return Math.max(0.05, 0.3 - t * 0.25);
}

/**
 * Roll a single concede decision against `game24ConcedeProbability`
 * using the shared RNG. Pulled out so the screen and the tests can
 * agree on the single source of truth.
 */
export function game24ShouldConcede(
  level: number,
  rng: SeedableRng,
): boolean {
  return rng.next() < game24ConcedeProbability(level);
}

/**
 * Schedule Mem's 24-game submission. Returns a `cancel` function the
 * screen MUST call on every early-exit path (back button, mode switch,
 * unmount, replay) so a phantom timeout never fires after the user has
 * left the match and records a spurious versus loss.
 *
 * Pulled out as its own helper so the cancellation contract has a
 * single source of truth that can be regression-tested without
 * mounting the whole screen.
 */
export interface ScheduleMemSubmissionArgs {
  level: number;
  rng: SeedableRng;
  onSubmit: () => void;
  difficulty?: MemDifficulty;
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export function scheduleMemSubmission(
  args: ScheduleMemSubmissionArgs,
): { cancel: () => void; delayMs: number } {
  const {
    level,
    rng,
    onSubmit,
    difficulty = "normal",
    setTimeoutFn = (cb, ms) => setTimeout(cb, ms),
    clearTimeoutFn = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  } = args;

  const baseDelay = game24ThinkingDelayMs(level, rng, difficulty);
  const concede = game24ShouldConcede(level, rng);
  const delayMs = concede ? baseDelay * 2 : baseDelay;

  let cancelled = false;
  let handle: unknown = null;
  handle = setTimeoutFn(() => {
    if (cancelled) return;
    onSubmit();
  }, delayMs);

  return {
    delayMs,
    cancel: () => {
      cancelled = true;
      if (handle != null) clearTimeoutFn(handle);
    },
  };
}

// ---------------------------------------------------------------------
// Mem voice lines.
// ---------------------------------------------------------------------

export type MemEvent =
  | "your-turn"
  | "user-match"
  | "user-mismatch"
  | "mem-match"
  | "mem-mismatch"
  | "mem-thinking"
  | "mem-wins"
  | "user-wins"
  | "draw";

const LINES: Record<MemEvent, readonly string[]> = {
  "your-turn": ["Your move.", "Over to you.", "Let's see what you've got."],
  "user-match": ["Nice find.", "Good one.", "Sharp eye."],
  "user-mismatch": ["So close.", "Almost.", "Next time."],
  "mem-match": ["Got one.", "Mine.", "Easy."],
  "mem-mismatch": ["Hmm, almost.", "Oh well.", "I'll get the next."],
  "mem-thinking": ["Thinking…", "Let me see…", "Almost there…"],
  "mem-wins": ["Got it first.", "Beat you to it.", "24!"],
  "user-wins": ["You got me.", "Nice solve.", "Whew, you're quick."],
  draw: ["A tie.", "Dead even.", "Even split."],
};

/**
 * Pick a curated voice line for an event, avoiding `lastLine` if
 * possible so back-to-back picks don't repeat. Uses the shared RNG so
 * tests can pin the choice.
 */
export function pickMemLine(
  event: MemEvent,
  rng: SeedableRng,
  lastLine?: string,
): string {
  const pool = LINES[event];
  if (pool.length === 0) return "";
  const filtered =
    lastLine !== undefined
      ? pool.filter((l) => l !== lastLine)
      : pool.slice();
  const choices = filtered.length > 0 ? filtered : pool;
  return choices[Math.floor(rng.next() * choices.length)];
}

export const MEM_VOICE_LINES = LINES;
