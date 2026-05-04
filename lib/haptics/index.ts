export { useHaptic, useHaptics } from "./useHaptic";
export type { HapticPlayer, HapticsApi, HapticPlayOptions } from "./useHaptic";
export { HAPTIC_PATTERNS, HAPTIC_NAMES } from "./patterns";
export { playPattern, pickImpactStyle, buildSchedule } from "./ahapPlayer";
export type { PlayHandle, PlayPatternOptions } from "./ahapPlayer";
export type { HapticName, AhapPattern, AhapEvent } from "./types";
export {
  HAPTIC_MUTE_PREFS_KEY,
  HAPTICS_MASTER_ENABLED_KEY,
  bootstrapHapticPreferences,
  ensureHapticMutePrefsHydrated,
  ensureHapticsMasterEnabledHydrated,
  getHapticMutePrefsCached,
  isHapticMutedCached,
  isHapticPreferencesReady,
  isHapticsMasterEnabledCached,
  setHapticMuted,
  setHapticsMasterEnabled,
  subscribeHapticMutePrefs,
  subscribeHapticsMasterEnabled,
  useHapticMutePrefs,
  useHapticPreferencesReady,
  useHapticsMasterEnabled,
} from "./preferences";
export type { HapticMutePrefs } from "./preferences";
