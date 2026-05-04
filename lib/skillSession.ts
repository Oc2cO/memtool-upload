/**
 * Helpers shared across the four Skills mini-game screens (Task #337).
 *
 * Pure module — no React. Centralizes the "is this round playable?"
 * decision so a future skill addition or paywall change is a one-file
 * update rather than four parallel edits across game routes.
 */

import { getSkill, isSkillUnlocked, type SkillId } from "./skillsBundle";

export interface SkillRouteParams {
  /** "1" when the route was opened from the challenge deep link. */
  challenge?: string;
  /** uint32 seed string from the deep link. */
  seed?: string;
  senderName?: string;
  /** Sender's score, as a string from the deep link. */
  senderScore?: string;
}

export interface ChallengeContext {
  isChallenge: boolean;
  /** Round seed (deterministic). 0 means "use a fresh random seed". */
  seed: number;
  senderName: string | null;
  senderScore: number | null;
}

export function parseChallengeParams(
  params: SkillRouteParams,
): ChallengeContext {
  const isChallenge = params.challenge === "1";
  const seedNum = params.seed ? Number(params.seed) : NaN;
  const seed =
    Number.isFinite(seedNum) && seedNum >= 0 ? Math.floor(seedNum) >>> 0 : 0;
  const score = params.senderScore ? Number(params.senderScore) : NaN;
  return {
    isChallenge,
    seed,
    senderName:
      typeof params.senderName === "string" && params.senderName.length > 0
        ? params.senderName
        : null,
    senderScore:
      Number.isFinite(score) && score >= 0 ? Math.floor(score) : null,
  };
}

/**
 * Decide whether the user can actually play this round of `skillId`:
 *   - The user owns the skill (bundle or per-skill) → always allowed
 *   - It's a challenge round → ONE free round is allowed even when
 *     the skill is not yet owned (free trial via friend referral)
 *   - Otherwise → blocked, route should redirect to the paywall
 */
export function canPlaySkillRound(
  skillId: SkillId,
  ownedEntitlements: ReadonlySet<string>,
  challenge: ChallengeContext,
): boolean {
  if (isSkillUnlocked(getSkill(skillId), ownedEntitlements)) return true;
  return challenge.isChallenge;
}

/**
 * Pick a fresh random uint32 seed for a non-challenge round. Wrapper
 * exists so tests can stub it.
 */
export function newRoundSeed(): number {
  // Math.random is fine here — the seed is purely UX (so two replays
  // of the same skill don't repeat the same shape) and we don't need
  // crypto randomness.
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
