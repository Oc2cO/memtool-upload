// One-time "richer haptics" hint for iPhone users where the new
// Core Haptics player is actually serving the .ahap files.
//
// Background: the JS approximation in `lib/haptics/ahapPlayer.ts`
// fires `expo-haptics` impacts and notifications, while the local
// `expo-core-haptics` module bridges the same .ahap patterns to
// Apple's `CHHapticEngine` for real continuous events and intensity
// ramps. The two feel noticeably different in the hand, but the
// upgrade is invisible — users have no way to know which player
// they're getting unless we tell them once.
//
// This module owns the gating + persistence side of that hint. The
// UI lives in `app/(app)/(tabs)/settings.tsx` (rendered as a small
// dismissable card so it never blocks anything).
//
// Rules:
//  - Only ever true on iPhones where `getAvailability().available`
//    from the native module returns true. Android, web, jest, Expo
//    Go, and iPhones that fell back to JS approximation must never
//    see the hint — those users would be told about a feature they
//    are not actually using.
//  - One-shot per device install. Once dismissed (or auto-dismissed
//    by the user closing the card), the AsyncStorage flag is set
//    and we never recompute or re-show.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { getAvailability } from "../modules/expo-core-haptics";

// Device-scoped (not per-account) because the property we're
// signalling is hardware: "this iPhone is playing .ahap natively".
// Sharing the device across accounts shouldn't pop the hint again.
export const CORE_HAPTICS_HINT_DISMISSED_KEY =
  "memtool:coreHapticsHintDismissed";

export async function hasDismissedCoreHapticsHint(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(CORE_HAPTICS_HINT_DISMISSED_KEY);
    return v !== null;
  } catch {
    // If we can't read the flag, err on the side of NOT nagging —
    // a transient AsyncStorage hiccup shouldn't make the hint
    // suddenly reappear for someone who already dismissed it.
    return true;
  }
}

export async function dismissCoreHapticsHint(): Promise<void> {
  try {
    await AsyncStorage.setItem(
      CORE_HAPTICS_HINT_DISMISSED_KEY,
      new Date().toISOString(),
    );
  } catch {
    // Worst case: we re-show on the next launch. Acceptable.
  }
}

// Convenience predicate the Settings screen calls on focus. Combines
// the hardware availability check with the dismissed flag so callers
// can render unconditionally on `true` without having to know about
// `getAvailability()` themselves.
export async function shouldShowCoreHapticsHint(): Promise<boolean> {
  // Cheapest gate first — `getAvailability()` is synchronous and
  // returns false immediately on Android/web/jest, so we avoid an
  // AsyncStorage round-trip on the platforms that will never show
  // the hint anyway.
  if (!getAvailability().available) return false;
  return !(await hasDismissedCoreHapticsHint());
}
