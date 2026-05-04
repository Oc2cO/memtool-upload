// Plays an AHAP pattern with the best engine available on this
// device:
//
//  - On iPhone with Core Haptics linked, we hand the parsed .ahap
//    dictionary straight to `CHHapticEngine.makePattern(from:)` via
//    the local `expo-core-haptics` module. This gives the user the
//    real signature: smooth crescendos, true continuous events,
//    frequency control — none of which the JS approximation can
//    reproduce.
//
//  - On every other platform (Android, web, jest, an Expo Go build
//    that doesn't have the module linked, or an iPhone where Core
//    Haptics refuses to start) we fall back to a best-effort JS
//    interpreter that maps each AHAP event to the closest
//    `expo-haptics` primitive based on Intensity × Sharpness. The
//    sequence and spacing is preserved so the *shape* of the
//    signature is still recognisable, even when each individual tap
//    comes from `UIImpactFeedbackGenerator`.
//
// Call sites stay on `useHaptic(name).play()` — the iOS-vs-fallback
// switch is invisible to them.

import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

import * as coreHaptics from "../../modules/expo-core-haptics";
import type { AhapEvent, AhapEventParameter, AhapPattern } from "./types";

const TICK_INTERVAL_MS = 55;

function readParam(
  params: AhapEventParameter[],
  id: AhapEventParameter["ParameterID"],
  fallback: number,
): number {
  const found = params.find((p) => p.ParameterID === id);
  if (!found) return fallback;
  if (
    typeof found.ParameterValue !== "number" ||
    Number.isNaN(found.ParameterValue)
  ) {
    return fallback;
  }
  return Math.min(1, Math.max(0, found.ParameterValue));
}

// Map (intensity, sharpness) ∈ [0,1]² → one of the five
// ImpactFeedbackStyle values. The buckets were chosen so each verb's
// signature uses a distinct style, not just "Medium for everything".
export function pickImpactStyle(
  intensity: number,
  sharpness: number,
): Haptics.ImpactFeedbackStyle {
  if (intensity >= 0.85 && sharpness >= 0.65) {
    return Haptics.ImpactFeedbackStyle.Rigid;
  }
  if (intensity >= 0.75) {
    return Haptics.ImpactFeedbackStyle.Heavy;
  }
  if (intensity >= 0.5) {
    return Haptics.ImpactFeedbackStyle.Medium;
  }
  if (intensity >= 0.3 && sharpness < 0.4) {
    return Haptics.ImpactFeedbackStyle.Soft;
  }
  return Haptics.ImpactFeedbackStyle.Light;
}

type Scheduled = { handle: ReturnType<typeof setTimeout> };

// Visible for tests — caller decides how to fire each event so we can
// assert the schedule without poking at expo-haptics' internals.
export function buildSchedule(
  pattern: AhapPattern,
): Array<{ atMs: number; event: AhapEvent }> {
  return pattern.Pattern.map((entry) => ({
    atMs: Math.max(0, Math.round(entry.Event.Time * 1000)),
    event: entry.Event,
  })).sort((a, b) => a.atMs - b.atMs);
}

function fireTransient(event: AhapEvent): void {
  const intensity = readParam(event.EventParameters, "HapticIntensity", 0.5);
  const sharpness = readParam(event.EventParameters, "HapticSharpness", 0.5);
  const style = pickImpactStyle(intensity, sharpness);
  Haptics.impactAsync(style).catch(() => {});
}

function fireContinuous(event: AhapEvent): Scheduled[] {
  const duration = Math.max(0, event.EventDuration ?? 0);
  if (duration <= 0) return [];
  const intensity = readParam(event.EventParameters, "HapticIntensity", 0.3);
  const ticks = Math.max(
    1,
    Math.floor((duration * 1000) / TICK_INTERVAL_MS),
  );
  const handles: Scheduled[] = [];
  for (let i = 0; i < ticks; i++) {
    // We approximate "continuous" by firing a sequence of quiet
    // selectionAsync ticks. Selection is the lightest available
    // primitive, which best matches the texture of a low-intensity
    // continuous event without adding loud thumps. For higher
    // intensity continuous events we substitute a soft impact every
    // other tick to give them more weight.
    const useImpact = intensity >= 0.5 && i % 2 === 0;
    const handle = setTimeout(() => {
      if (useImpact) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
      } else {
        Haptics.selectionAsync().catch(() => {});
      }
    }, i * TICK_INTERVAL_MS);
    handles.push({ handle });
  }
  return handles;
}

// `path` records which engine the play actually went down so callers
// (currently just the dev haptics bench) can show the tester whether
// they just felt the rich Core Haptics signature or the JS
// approximation. The decision is made synchronously at call time —
// if Core Haptics is asked to play but later silently falls back
// (engine refused mid-flight), `path` will still read `'core'`. The
// availability badge on the bench is the source of truth for "is the
// engine actually up right now"; `path` only reflects the routing
// decision made at the start of *this* play.
export type PlayHandle = {
  cancel: () => void;
  path: "core" | "js";
};

export type PlayPatternOptions = {
  // Used by the dev-only haptics bench to force the JS approximation
  // even on a device where Core Haptics is available, so a tester
  // can A/B compare the rich vs JS version of the same signature on
  // the same hardware in the same minute. Off by default — every
  // production call site goes through the real engine when present.
  forceFallback?: boolean;
};

// JS-side scheduler. Used as the fallback when Core Haptics is
// unavailable, and as the primary path on Android / web / jest.
function scheduleJsPattern(pattern: AhapPattern): PlayHandle {
  const schedule = buildSchedule(pattern);
  const allHandles: Scheduled[] = [];

  for (const slot of schedule) {
    const top = setTimeout(() => {
      if (slot.event.EventType === "HapticTransient") {
        fireTransient(slot.event);
      } else {
        const continuousHandles = fireContinuous(slot.event);
        allHandles.push(...continuousHandles);
      }
    }, slot.atMs);
    allHandles.push({ handle: top });
  }

  return {
    path: "js",
    cancel: () => {
      for (const h of allHandles) {
        clearTimeout(h.handle);
      }
    },
  };
}

// Schedule every event in the pattern. Returns a handle so the caller
// can cancel pending scheduled events if the screen unmounts before
// the pattern finishes. On platforms without a system haptic engine
// (web, Android emulator without vibration, etc.) `expo-haptics` is a
// no-op so the timeouts fire harmlessly.
export function playPattern(
  pattern: AhapPattern,
  options: PlayPatternOptions = {},
): PlayHandle {
  // Web has no haptic hardware and `expo-haptics` is a no-op there;
  // skip scheduling entirely so we don't pile up timers in jsdom.
  if (Platform.OS === "web") {
    return { cancel: () => {}, path: "js" };
  }

  // Prefer the real Core Haptics engine on iPhone. Returning early
  // here keeps Android, jest, and Expo Go on the existing JS path
  // unchanged (no regression — Core Haptics is iOS-only and the JS
  // module reports `non_ios_platform` / `module_not_linked` for
  // them). `forceFallback` lets the dev bench short-circuit this
  // even on hardware that does support Core Haptics, so a tester
  // can A/B the rich vs JS version on the same device.
  if (!options.forceFallback && Platform.OS === "ios") {
    const availability = coreHaptics.getAvailability();
    if (availability.available) {
      return playWithCoreHaptics(pattern);
    }
  }

  return scheduleJsPattern(pattern);
}

// Hand the parsed .ahap dictionary to Core Haptics. Because the
// native call is async but `playPattern` is synchronous, we hold a
// `cancelled` flag and a slot for whichever handle wins the race:
//
//  - If cancel() is called before the native promise resolves, we
//    cancel the eventual native handle (or fallback) on resolution.
//  - If native rejects or reports unavailable mid-flight (engine
//    failed to start, hardware lost), we transparently fall back to
//    the JS scheduler so the user still gets *some* feedback.
function playWithCoreHaptics(pattern: AhapPattern): PlayHandle {
  let cancelled = false;
  let nativeHandle: coreHaptics.CoreHapticsPlayHandle | null = null;
  let fallbackHandle: PlayHandle | null = null;

  coreHaptics
    .play(pattern)
    .then(({ result, handle }) => {
      if (cancelled) {
        handle.cancel();
        return;
      }
      if (result.status === "ok") {
        nativeHandle = handle;
        return;
      }
      // Native told us it couldn't play this pattern (engine
      // refused to start, pattern dictionary was malformed, etc.).
      // Fall back to the JS approximation so the user still feels
      // *something* on this verb.
      fallbackHandle = scheduleJsPattern(pattern);
    })
    .catch(() => {
      if (cancelled) return;
      fallbackHandle = scheduleJsPattern(pattern);
    });

  return {
    path: "core",
    cancel: () => {
      cancelled = true;
      if (nativeHandle) nativeHandle.cancel();
      if (fallbackHandle) fallbackHandle.cancel();
    },
  };
}
