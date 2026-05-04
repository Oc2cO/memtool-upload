/**
 * Mem coach reaction lines for Skills Bundle 1 (Task #337).
 *
 * Mirrors the per-game/per-outcome line table in lib/memReactions.ts
 * but keyed on SkillId so each new skill gets its own voice rather
 * than reusing the Memory-Match / 24-Game banks. Pure module — the
 * round screen pipes the chosen line through the existing
 * `useMemSpeech` hook.
 */

import type { MemExpression } from "@/components/MemCharacter";
import type { SkillId } from "./skillsBundle";

export type SkillReactionState = "win" | "ok" | "fail";

export interface SkillReactionLine {
  text: string;
  expression: MemExpression;
}

const LINES: Record<SkillId, Record<SkillReactionState, string[]>> = {
  mem_says: {
    win: [
      "Perfect echo. Your sequence memory is sharp.",
      "All in order — that was a clean run.",
      "Locked the whole pattern. Lovely.",
      "Three colours, four colours, all the colours — got them.",
      "Beautiful playback. Mem is impressed.",
    ],
    ok: [
      "Most of it landed. One slip is fine.",
      "Good run — slow the middle next time.",
      "Almost the full chain. Try once more.",
      "You held the start, lost the tail. Common spot.",
      "Solid attempt. The pattern is forming.",
    ],
    fail: [
      "Tough sequence. Watch once, breathe, then echo.",
      "It got away from you. Reset and replay.",
      "Sequences love repetition — try again.",
      "Don't chase it. Watch the whole thing first.",
      "We'll get this one. One more pass.",
    ],
  },
  signal_sort: {
    win: [
      "Every signal sorted. Quick fingers.",
      "Clean sweep — nothing slipped through.",
      "Your reflexes and your reasoning agreed.",
      "Top sort. The bins are tidy.",
      "Flawless triage. Nicely done.",
    ],
    ok: [
      "Mostly clean. Watch the edge cases.",
      "A few got through — pace yourself.",
      "Solid sort with a couple of slips.",
      "Good throughput. Aim for fewer mis-tap.",
      "Decent run. Tighten the rhythm.",
    ],
    fail: [
      "Too fast — try sorting one signal at a time.",
      "The flow ran ahead of you. Slow it down.",
      "Don't guess. Read the label, then tap.",
      "It's a marathon, not a sprint. Reset.",
      "Tough round. Take a breath and re-enter.",
    ],
  },
  pattern_path: {
    win: [
      "Perfect trace. Every cell on the line.",
      "You held the whole path in mind. Beautiful.",
      "Spatial memory is firing. Top run.",
      "Cell by cell, exactly right.",
      "Nailed it. The grid remembers you.",
    ],
    ok: [
      "Most of the path — try retracing aloud next time.",
      "Good trace with a small detour.",
      "Almost the full route. One more pass.",
      "You held the start. Tail needs a beat.",
      "Solid attempt. Visualise before you swipe.",
    ],
    fail: [
      "Path slipped. Watch slower next round.",
      "Don't guess the corners. Follow the dot.",
      "Reset the grid and try again.",
      "Patterns reward patience.",
      "Tough one. Take a breath.",
    ],
  },
  echo_count: {
    win: [
      "Spot on. Your ears were listening.",
      "Exact count. Lovely focus.",
      "Right on the number. Nice ear.",
      "You held every chime. Great run.",
      "Perfect tally. Mem is grinning.",
    ],
    ok: [
      "Off by one — close call.",
      "A chime slipped past. Easy fix next time.",
      "Almost there. Count under your breath.",
      "Good listen, small slip.",
      "Nearly perfect. One more pass.",
    ],
    fail: [
      "Way off — relax and listen first.",
      "Counting and listening is hard. Try again.",
      "The chimes ran ahead. Reset.",
      "Don't guess. Trust your ear.",
      "Tough round. We'll get the next.",
    ],
  },
};

const EXPRESSION: Record<SkillReactionState, MemExpression> = {
  win: "celebrate",
  ok: "happy",
  fail: "sad",
};

/**
 * Deterministic on `(skillId, state, seed)` so the same finish always
 * produces the same line. This matters for friend-challenge replay
 * and for snapshot tests.
 */
export function pickSkillReactionLine(
  skillId: SkillId,
  state: SkillReactionState,
  seed: number,
): SkillReactionLine {
  const bank = LINES[skillId][state];
  const idx = ((seed >>> 0) ^ state.length) % bank.length;
  return { text: bank[idx]!, expression: EXPRESSION[state] };
}
