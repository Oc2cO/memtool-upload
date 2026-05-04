// Type definitions for the opt-in cognitive sound + haptic layer
// (Task #341). The four cognitive contexts each map to a curated
// ambient bed and an optional binaural sub-layer tuned to the brain
// state we want to support:
//
//   capture  — light ambient (rain / forest), optional theta (~6 Hz)
//   recap    — warm ambient music, optional alpha (~10 Hz)
//   games    — subtle UI bed, optional light beta (~14 Hz)
//   sleep    — slow instrumental / white noise, optional delta (~2 Hz)
//
// The contexts are an enum (string literal union) rather than free
// strings so a typo at a call site (`playContext("recapp")`) becomes
// a compile error rather than a silent no-op.

export type CognitiveAudioContext = "capture" | "recap" | "games" | "sleep";

export const COGNITIVE_AUDIO_CONTEXTS: readonly CognitiveAudioContext[] = [
  "capture",
  "recap",
  "games",
  "sleep",
] as const;

/**
 * Target binaural carrier frequency per context, in Hz. These match
 * the "brain state" each context is supposed to support (theta for
 * reflective capture, alpha for recap reflection, light beta for
 * focused mini-games, delta for sleep wind-down). The exact values
 * are documented constants — change them only with an explicit
 * justification in the commit message, since they're effectively
 * part of the product.
 */
export const BINAURAL_HZ: Record<CognitiveAudioContext, number> = {
  capture: 6,
  recap: 10,
  games: 14,
  sleep: 2,
};

/**
 * Friendly label + one-line description for each context. The
 * Settings panel renders these so the user can see exactly what
 * the toggle is doing — no jargon, no "binaural beat" without
 * context.
 */
export const COGNITIVE_AUDIO_LABELS: Record<
  CognitiveAudioContext,
  { title: string; subtitle: string }
> = {
  capture: {
    title: "Capture",
    subtitle: "Soft ambience while you record a memory.",
  },
  recap: {
    title: "Recap",
    subtitle: "Warm bed under your daily reflection.",
  },
  games: {
    title: "Mini-games",
    subtitle: "Subtle focus layer for Memory Match and Game 24.",
  },
  sleep: {
    title: "Wind-down",
    subtitle: "Slow ambience for the wellness logger.",
  },
};
