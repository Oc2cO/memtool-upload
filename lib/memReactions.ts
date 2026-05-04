/**
 * Mem coach reaction lines for the Memory Match + 24 Game level
 * surfaces (Task #324).
 *
 * Five lines per (game × outcome) bucket so successive wins/fails
 * don't always read the same. Selection is deterministic on
 * (level, outcome, stars) so the same finish always speaks the
 * same line — no "two players, same final, different Mem" surprise
 * during pair play and no flakiness in tests.
 *
 * The `expression` drives Mem's face on the overlay (matches the
 * MemExpression vocabulary in `MemCharacter.tsx`):
 *   - 3-star win  → "celebrate"  (sparkle crown + arched eyes)
 *   - low-star win → "happy"     (arched eyes, gentle smile)
 *   - fail        → "sad"        (droopy eyes, frown)
 *   - timeout     → "anxious"    (tall eyes, tight brow)
 *
 * Pure module: no React, no AsyncStorage, no audio. The overlay
 * imports `pickMemReactionLine` and pipes the line through the
 * existing `useMemSpeech` hook so the user's chosen voice + the
 * device TTS path is reused.
 */

import type { MemExpression } from "@/components/MemCharacter";

export type MemReactionGame = "memoryMatch" | "game24";
export type MemReactionState = "win" | "fail" | "timeout";

export interface MemReactionLine {
  text: string;
  expression: MemExpression;
}

const MEMORY_MATCH_WIN_3STAR: string[] = [
  "Three stars — that was clean.",
  "All three stars locked in. Nicely done.",
  "Perfect run. Your memory is sharp today.",
  "Three stars — every move counted.",
  "Top marks. That was a tidy clear.",
];

const MEMORY_MATCH_WIN_LOW: string[] = [
  "Nice clear. Try a few less moves next time.",
  "You got it. A little tighter and that's three stars.",
  "Good job — every clear builds the muscle.",
  "Cleared it. The pattern is sticking.",
  "Solid. One more pass for a stronger time.",
];

const MEMORY_MATCH_FAIL: string[] = [
  "Tough break. The grid resets — let's try again.",
  "Close one. Take a breath and reset.",
  "We'll get it next round.",
  "No worries — pattern memory loves repetition.",
  "Reset and replay. You've got this.",
];

const MEMORY_MATCH_TIMEOUT: string[] = [
  "Time slipped — let's pace it differently.",
  "Out of time. Scan the board first next round.",
  "The clock won that one. Try a calmer scan.",
  "Time's up. A steady eye beats a rushed tap.",
  "Beat the timer next time — you almost had it.",
];

const GAME24_WIN_3STAR: string[] = [
  "Three stars — fast and clean.",
  "Quick math. Three stars to you.",
  "Sharp solve. All three stars.",
  "Crisp answer. Three-star run.",
  "Twenty-four locked in fast. Top marks.",
];

const GAME24_WIN_LOW: string[] = [
  "You found twenty-four. Nice work.",
  "Got it. A little quicker and that's three stars.",
  "Nice solve. The shapes are clicking.",
  "Twenty-four. Try chaining it tighter next time.",
  "Cleared the puzzle — keep that momentum.",
];

const GAME24_FAIL: string[] = [
  "Tricky one. Reset and try a different combo.",
  "Not this time — undo and look for a factor of six.",
  "Step back, try pairing the bigger numbers.",
  "Close. Try multiplying first next round.",
  "We'll get the next puzzle.",
];

const GAME24_TIMEOUT: string[] = [
  "Out of time — keep an eye on factors of twenty-four.",
  "Clock got us. Look for sixes and fours first.",
  "Time's up. Quick scan for an obvious pair next time.",
  "Beat the timer next round — start with multiplication.",
  "Out of time. Steady, then attack the easiest pair.",
];

function pickIndex(level: number, state: MemReactionState, stars: number, len: number): number {
  // Tiny deterministic mixer — keeps successive same-state finishes
  // from speaking the same line, but the same (level, state, stars)
  // always picks the same line so screenshots / tests are stable.
  const stateSalt = state === "win" ? 1 : state === "fail" ? 2 : 3;
  const hash = (level * 31 + stateSalt * 7 + stars * 13) % len;
  return hash < 0 ? hash + len : hash;
}

/**
 * Resolve a Mem reaction line for the given outcome.
 *
 * `stars` is required for win states (1..3); falsy / null for
 * fail + timeout. Out-of-range inputs collapse to the closest
 * sensible bucket so a future caller mistake never crashes the
 * overlay.
 */
export function pickMemReactionLine(
  game: MemReactionGame,
  state: MemReactionState,
  stars: number | null | undefined,
  level: number,
): MemReactionLine {
  const safeStars = typeof stars === "number" ? Math.max(1, Math.min(3, stars)) : 0;
  let bank: string[];
  let expression: MemExpression;
  if (state === "win") {
    if (safeStars >= 3) {
      bank = game === "memoryMatch" ? MEMORY_MATCH_WIN_3STAR : GAME24_WIN_3STAR;
      expression = "celebrate";
    } else {
      bank = game === "memoryMatch" ? MEMORY_MATCH_WIN_LOW : GAME24_WIN_LOW;
      expression = "happy";
    }
  } else if (state === "timeout") {
    bank = game === "memoryMatch" ? MEMORY_MATCH_TIMEOUT : GAME24_TIMEOUT;
    expression = "anxious";
  } else {
    bank = game === "memoryMatch" ? MEMORY_MATCH_FAIL : GAME24_FAIL;
    expression = "sad";
  }
  const idx = pickIndex(level, state, safeStars, bank.length);
  return { text: bank[idx], expression };
}

/**
 * Test seam: lengths exposed so a deterministic-coverage test can
 * assert each bank holds the spec's "~5 lines per outcome".
 */
export const MEM_REACTION_BANK_SIZES = {
  memoryMatch: {
    win3: MEMORY_MATCH_WIN_3STAR.length,
    winLow: MEMORY_MATCH_WIN_LOW.length,
    fail: MEMORY_MATCH_FAIL.length,
    timeout: MEMORY_MATCH_TIMEOUT.length,
  },
  game24: {
    win3: GAME24_WIN_3STAR.length,
    winLow: GAME24_WIN_LOW.length,
    fail: GAME24_FAIL.length,
    timeout: GAME24_TIMEOUT.length,
  },
} as const;
