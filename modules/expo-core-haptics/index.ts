// JS surface for the local `expo-core-haptics` Expo module.
//
// On iPhone (iOS, with the supporting Haptic Engine hardware) this
// module bridges to Apple's `CHHapticEngine` so we can play the
// hand-authored .ahap patterns directly — true continuous events,
// smooth intensity ramps, frequency control, the whole vocabulary.
// On every other platform (Android, web, jest, Expo Go without the
// dev client) we short-circuit with a typed `unavailable` result so
// `ahapPlayer.ts` can transparently fall back to the JS
// approximation without crashing or branching everywhere.
//
// The native side is gated by `#if canImport(CoreHaptics)` and a
// runtime `CHHapticEngine.capabilitiesForHardware().supportsHaptics`
// check — see `ios/CoreHapticsModule.swift`.

import { Platform } from "react-native";

export type CoreHapticsUnavailableReason =
  | "non_ios_platform"
  | "module_not_linked"
  | "hardware_not_supported"
  | "engine_start_failed"
  | "invalid_pattern"
  | "unknown";

export type CoreHapticsAvailability = {
  available: boolean;
  reason: CoreHapticsUnavailableReason | null;
};

export type CoreHapticsPlayResult =
  | { status: "ok" }
  | { status: "unavailable"; reason: CoreHapticsUnavailableReason };

// The shape we forward to the native side. It is just the parsed
// JSON of an .ahap file — Apple's `CHHapticPattern(dictionary:)`
// constructor accepts exactly that shape, so we don't need a Swift
// model in between.
//
// `Pattern` is intentionally typed as `readonly unknown[]` so the
// caller can pass the strictly-typed `AhapPattern` from
// `lib/haptics/types.ts` without a cast, while the native side is
// still free to receive any AHAP-shaped JSON the user might author
// in the future (continuous events, parameter curves, etc.).
export type AhapPatternJson = {
  Version: number;
  Metadata?: Record<string, unknown>;
  Pattern: readonly unknown[];
};

export type CoreHapticsNative = {
  getAvailability: () => { available: boolean; reason: string | null };
  // Returns a numeric handle the caller can pass to `stop` to cancel
  // a pattern that is still playing (e.g. component unmounted before
  // a long continuous tail finished).
  play: (
    pattern: AhapPatternJson,
  ) => Promise<
    | { status: "ok"; handle: number }
    | { status: "unavailable"; reason: string }
  >;
  stop: (handle: number) => void;
};

let cachedNative: CoreHapticsNative | null | undefined;

function getNativeModule(): CoreHapticsNative | null {
  if (cachedNative !== undefined) return cachedNative;
  if (Platform.OS !== "ios") {
    cachedNative = null;
    return cachedNative;
  }
  try {
    // `requireNativeModule` throws synchronously when the native
    // module is not linked into the running binary (Expo Go, web,
    // jest, older dev clients built before this module was added).
    // We swallow the throw so callers always get a typed fallback.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require("expo-modules-core") as {
      requireNativeModule: (name: string) => CoreHapticsNative;
    };
    cachedNative = core.requireNativeModule("CoreHaptics");
  } catch {
    cachedNative = null;
  }
  return cachedNative;
}

function normalizeReason(
  reason: string | null | undefined,
): CoreHapticsUnavailableReason {
  switch (reason) {
    case "non_ios_platform":
    case "module_not_linked":
    case "hardware_not_supported":
    case "engine_start_failed":
    case "invalid_pattern":
      return reason;
    default:
      return "unknown";
  }
}

export function getAvailability(): CoreHapticsAvailability {
  if (Platform.OS !== "ios") {
    return { available: false, reason: "non_ios_platform" };
  }
  const native = getNativeModule();
  if (!native) {
    return { available: false, reason: "module_not_linked" };
  }
  try {
    const result = native.getAvailability();
    return {
      available: !!result.available,
      reason: result.available ? null : normalizeReason(result.reason),
    };
  } catch {
    return { available: false, reason: "unknown" };
  }
}

export type CoreHapticsPlayHandle = {
  cancel: () => void;
};

// Fire-and-forget play of an AHAP pattern. The returned handle lets
// the caller cancel a long continuous tail if the originating
// component unmounts. If the native side rejects (engine error,
// invalid pattern, hardware lost mid-play) we resolve to
// `{ status: "unavailable" }` so the caller can fall back to the JS
// approximation on the next play instead of throwing.
export async function play(
  pattern: AhapPatternJson,
): Promise<{ result: CoreHapticsPlayResult; handle: CoreHapticsPlayHandle }> {
  const noop: CoreHapticsPlayHandle = { cancel: () => {} };
  if (Platform.OS !== "ios") {
    return {
      result: { status: "unavailable", reason: "non_ios_platform" },
      handle: noop,
    };
  }
  const native = getNativeModule();
  if (!native) {
    return {
      result: { status: "unavailable", reason: "module_not_linked" },
      handle: noop,
    };
  }
  try {
    const native_result = await native.play(pattern);
    if (native_result.status === "ok") {
      const handle = native_result.handle;
      return {
        result: { status: "ok" },
        handle: {
          cancel: () => {
            try {
              native.stop(handle);
            } catch {
              // Stopping a pattern that already finished is fine.
            }
          },
        },
      };
    }
    return {
      result: {
        status: "unavailable",
        reason: normalizeReason(native_result.reason),
      },
      handle: noop,
    };
  } catch {
    return {
      result: { status: "unavailable", reason: "unknown" },
      handle: noop,
    };
  }
}

// Test-only escape hatch so jest can simulate the module being
// linked / unavailable without touching real native code. Same
// pattern as the local `foundation-models` module.
export function __setNativeModuleForTests(
  module: CoreHapticsNative | null,
): void {
  cachedNative = module;
}

export function __resetNativeModuleForTests(): void {
  cachedNative = undefined;
}
