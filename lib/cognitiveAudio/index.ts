// Public surface for the cognitive sound + haptic layer (Task #341).
//
// Haptic signatures are NOT re-exported here — they continue to
// live in `lib/haptics`. The four cognitive haptic touchpoints the
// task calls out (capture confirm, recap reveal, milestone, game
// feedback) all map onto existing AHAP signatures already shipped
// in Tasks #226 / #243 / #252:
//
//   capture confirm        → "capture"          (lib/haptics)
//   recap reveal           → "day-recap-ready"  (lib/haptics)
//   milestone celebration  → "streak-extended"  (lib/haptics)
//   game correct           → "link-formed"      (lib/haptics)
//   game wrong             → "error"            (lib/haptics)
//
// The audit is documented in `docs/COGNITIVE_AUDIO.md`. Anything
// audio-shaped is exported from this index.

export {
  COGNITIVE_AUDIO_CONTEXTS,
  COGNITIVE_AUDIO_LABELS,
  BINAURAL_HZ,
} from "./types";
export type { CognitiveAudioContext } from "./types";

export {
  COGNITIVE_AUDIO_PREFS_KEY,
  DEFAULT_COGNITIVE_AUDIO_PREFS,
  ensureCognitiveAudioPrefsHydrated,
  getCognitiveAudioPrefsCached,
  getMasterVolumeCached,
  isBinauralEnabledCached,
  isCognitiveAudioEnabledCached,
  markHeadphonesHintShown,
  setBinauralEnabled,
  setCognitiveAudioEnabled,
  setMasterVolume,
  subscribeCognitiveAudioPrefs,
  useCognitiveAudioPrefs,
} from "./preferences";
export type { CognitiveAudioPrefs } from "./preferences";

export {
  AMBIENT_BEDS,
  BINAURAL_TONES,
  hasBundledBed,
  hasBundledBinaural,
} from "./registry";

export {
  areHeadphonesConnected,
  shouldShowHeadphonesHint,
} from "./headphones";

export {
  applyLiveMasterVolume,
  getActiveContext,
  playContext,
  stop,
} from "./service";

export { useCognitiveAudio } from "./useCognitiveAudio";
