// Asset registry for the cognitive sound layer (Task #341).
//
// Each context maps to an ambient bed and a binaural sub-tone.
// Assets are synthesized procedurally by
// `scripts/src/generate-cognitive-audio.ts` and committed under
// `assets/audio/cognitive/` so they ship with the binary. The
// generator keeps every file under ~600 KB (16-bit / 22050 Hz
// short loops); the service loops them at the player level so a
// 6–10s source feels continuous.
//
// To re-generate the assets (e.g. after tweaking carriers or bed
// envelopes), run:
//
//   pnpm --filter @workspace/scripts run generate:cognitive-audio
//
// The registry still treats `null` as "no asset bundled" so the
// service degrades gracefully on web (where `require()` of a wav
// resolves to a URI but the audio module isn't loaded) and inside
// jest (where `require()` of an asset resolves to a numeric module
// id from the asset transformer).

import type { CognitiveAudioContext } from "./types";

/**
 * Bed track per cognitive context. `null` = no usable asset id (e.g.
 * service will skip the bed and (if binaural is enabled) still play
 * the tone alone.
 */
export const AMBIENT_BEDS: Record<CognitiveAudioContext, number | null> = {
  capture: require("../../assets/audio/cognitive/capture-bed.wav"),
  recap: require("../../assets/audio/cognitive/recap-bed.wav"),
  games: require("../../assets/audio/cognitive/games-bed.wav"),
  sleep: require("../../assets/audio/cognitive/sleep-bed.wav"),
};

/**
 * Binaural tone per context — stereo files where the left ear sits
 * at the carrier and the right ear at carrier + delta (delta = the
 * `BINAURAL_HZ` value for the context). The brain perceives the
 * difference, not the carriers, which is why headphones matter.
 */
export const BINAURAL_TONES: Record<CognitiveAudioContext, number | null> = {
  capture: require("../../assets/audio/cognitive/binaural-theta-6hz.wav"),
  recap: require("../../assets/audio/cognitive/binaural-alpha-10hz.wav"),
  games: require("../../assets/audio/cognitive/binaural-beta-14hz.wav"),
  sleep: require("../../assets/audio/cognitive/binaural-delta-2hz.wav"),
};

export function hasBundledBed(context: CognitiveAudioContext): boolean {
  return AMBIENT_BEDS[context] != null;
}

export function hasBundledBinaural(context: CognitiveAudioContext): boolean {
  return BINAURAL_TONES[context] != null;
}
