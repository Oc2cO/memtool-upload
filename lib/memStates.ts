/**
 * Mem companion emotional-state catalog (Task #340).
 *
 * The brand spec gives Mem a small, expressive vocabulary so she can
 * *react* to what's happening on screen — instead of just "showing
 * up". This module is the single source of truth for that vocabulary:
 * which states exist, what each one means, where each one fires, and
 * — critically — what each one must NOT convey. The pattern is
 * deliberately data-only so future screens can look up a state, get
 * the right `<MemCharacter expression>` value, and stay consistent
 * with every other Mem placement without re-deriving the vocabulary.
 *
 * Hard rule (from the brand bible): Mem is nurturing, never punitive.
 * Even `concerned` and `waiting` read as "I'm here with you" — never
 * as guilt-trip or disappointment. The wellness app rule trumps the
 * streak-loss-enforcer pattern other apps use.
 */

import type { MemExpression } from "@/components/MemCharacter";

export type MemStateName =
  | "curious"
  | "thoughtful"
  | "celebrating"
  | "glowing"
  | "waiting"
  | "concerned"
  | "resting";

export interface MemStateSpec {
  /** Stable id used by callers and the Settings docs link. */
  name: MemStateName;
  /** The `MemCharacter` expression that renders this state. */
  expression: MemExpression;
  /** One-line description of what this state conveys. */
  meaning: string;
  /** Where this state should fire today (canonical surfaces). */
  firesAt: readonly string[];
  /** Things this state must NEVER convey. The wellness guard-rail. */
  mustNotConvey: readonly string[];
}

export const MEM_STATES: Record<MemStateName, MemStateSpec> = {
  curious: {
    name: "curious",
    expression: "curious",
    meaning:
      "First-meeting / greeting. Mem is interested in *you*, not the task.",
    firesAt: ["Onboarding MEET stage", "Onboarding chat greeting"],
    mustNotConvey: ["sales pitch", "checklist energy", "evaluation"],
  },
  thoughtful: {
    name: "thoughtful",
    expression: "thoughtful",
    meaning:
      "Listening, holding space. Mem is paying attention while you compose.",
    firesAt: ["Capture form (typing or speaking a memory)"],
    mustNotConvey: ["judgement", "impatience", "hurry"],
  },
  celebrating: {
    name: "celebrating",
    expression: "celebrating",
    meaning:
      "A clear win — recap with captures, milestone cleared, streak extended.",
    firesAt: [
      "Daily recap reveal (when there's something to celebrate)",
      "Streak / milestone moments",
      "Game-level overlay (existing — three-star wins)",
    ],
    mustNotConvey: ["loud confetti", "bro energy", "score-shaming"],
  },
  glowing: {
    name: "glowing",
    expression: "glowing",
    meaning:
      "An insight just landed — themes / mood patterns surfaced in the recap.",
    firesAt: ["Daily recap reveal (when AI themes / mood-trend exist)"],
    mustNotConvey: ["surveillance vibes", "'we caught a pattern' creepiness"],
  },
  waiting: {
    name: "waiting",
    expression: "waiting",
    meaning:
      "Gently here, not nagging. Mem is present after a missed check-in.",
    firesAt: ["Home tab when the user hasn't captured today"],
    mustNotConvey: ["disappointment", "guilt", "streak-loss alarm"],
  },
  concerned: {
    name: "concerned",
    expression: "concerned",
    meaning:
      "Caring presence when something soft is happening (low mood, sync error).",
    firesAt: ["Reserved — low-mood / sync-error surfaces (other tasks)"],
    mustNotConvey: ["alarm", "punishment", "medical/clinical tone"],
  },
  resting: {
    name: "resting",
    expression: "resting",
    meaning:
      "Companion, not surveillance. Mem is just here — no demands, no telemetry.",
    firesAt: ["Settings / profile surfaces"],
    mustNotConvey: ["evaluation", "metrics", "'we're watching' vibe"],
  },
} as const;

/**
 * Resolve the recap-reveal state from the recap payload.
 *
 * Per the brand spec, recap reveal is a celebratory surface — it
 * resolves only to `glowing` (the AI surfaced themes / mood-trend,
 * something landed) or `celebrating` (captures exist, that itself is
 * a win). The empty / missed-check-in case is handled outside the
 * reveal (the home tab uses `waiting`, the recap empty card uses its
 * own copy without firing this helper) so the reveal never reads as
 * "you didn't show up today".
 */
export function pickRecapState(opts: {
  hasThemes: boolean;
  hasMoodTrend: boolean;
}): MemStateName {
  if (opts.hasThemes || opts.hasMoodTrend) return "glowing";
  return "celebrating";
}

/**
 * Resolve the home-tab companion state.
 *
 * The home greeting strip should never punish a missed day, but a
 * gentle `waiting` Mem when the user hasn't captured today (and has
 * captured before, so she has *someone* to wait for) gives the
 * streak-aware moment its caring shape. First-time users see
 * `curious` instead — Mem is meeting them.
 */
export function pickHomeState(opts: {
  todayCaptureCount: number;
  totalCaptureCount: number;
}): MemStateName {
  if (opts.totalCaptureCount === 0) return "curious";
  if (opts.todayCaptureCount === 0) return "waiting";
  return "resting";
}
