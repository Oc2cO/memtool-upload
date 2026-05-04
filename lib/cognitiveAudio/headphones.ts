// Best-effort headphones / wired-output detection for the
// cognitive sound layer (Task #341).
//
// Binaural tones only work when each ear receives a different
// carrier, which means they're inert through a phone speaker. The
// task asks us to surface a "headphones recommended" hint when
// the user enables the binaural sub-layer without headphones —
// once, gated by `headphonesHintShown` in preferences so we never
// re-nag the same install.
//
// Cross-platform headphone detection in Expo currently has no
// first-party API. Rather than pull in another native dependency
// for a single hint, we treat detection as best-effort:
//
//   - Web: assume "no headphones" so the hint always shows once.
//   - Native: try `expo-av`'s `Audio.getStatusAsync` route info
//     where available; fall back to "unknown" (treated as "no
//     headphones") so the hint still surfaces. False positives are
//     fine here — the worst case is a wired-up user sees the hint
//     once, which is harmless.
//
// The detection module exports a single async function so it's
// easy to swap in a real native check later (e.g. via
// react-native-audio-toolkit's `isHeadphonesConnected`) without
// touching the Settings screen.

import { Platform } from "react-native";

type Connectivity = "connected" | "disconnected" | "unknown";

// Test override only. Production code re-probes on every call so a
// user who unplugs after enabling binaural still gets the hint the
// next time the gating logic runs.
let testOverride: Connectivity | null = null;

/**
 * Returns whether the device has headphones / wired output.
 * Resolves to:
 *   - true   — headphones detected
 *   - false  — speaker / no headphones (treat the hint as needed)
 *   - null   — couldn't determine (caller should treat as "no
 *              headphones" for hint purposes)
 *
 * Intentionally NOT cached: connection state changes mid-session
 * (user plugs / unplugs) and the headphone hint logic relies on
 * fresh values to make the right decision on each binaural-enable
 * transition. Tests can override the result with
 * `__setHeadphonesCacheForTests`.
 */
export async function areHeadphonesConnected(): Promise<boolean | null> {
  if (testOverride === "connected") return true;
  if (testOverride === "disconnected") return false;
  if (testOverride === "unknown") return null;
  if (Platform.OS === "web") {
    return false;
  }
  // expo-av exposes a deprecated route check on iOS; expo-audio
  // does not yet. We deliberately keep this best-effort and never
  // throw — a missing native module just means "unknown".
  try {
    const mod = require("expo-audio") as {
      getOutputDevicesAsync?: () => Promise<Array<{ type?: string }>>;
    };
    if (typeof mod.getOutputDevicesAsync === "function") {
      const devices = await mod.getOutputDevicesAsync();
      return devices.some((d) => {
        const t = (d.type ?? "").toLowerCase();
        return (
          t.includes("headphone") ||
          t.includes("headset") ||
          t.includes("bluetooth")
        );
      });
    }
  } catch {
    // Ignore — fall through to "unknown".
  }
  return null;
}

/** True when we should show the binaural headphones hint. */
export async function shouldShowHeadphonesHint(): Promise<boolean> {
  const status = await areHeadphonesConnected();
  // null (unknown) is treated as "no headphones" so the hint
  // surfaces once even on platforms we can't probe.
  return status !== true;
}

export function __resetHeadphonesCacheForTests(): void {
  testOverride = null;
}

export function __setHeadphonesCacheForTests(value: Connectivity): void {
  testOverride = value;
}
