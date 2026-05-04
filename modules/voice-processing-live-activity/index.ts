// JS surface for the local `voice-processing-live-activity` Expo module.
//
// The module drives an iOS 16.1+ ActivityKit Live Activity (and the
// Dynamic Island on iPhone 14 Pro and newer) while a voice memory is
// being transcribed / extracted. The native side lives in a Swift
// WidgetKit extension shipped together with the speech-to-text +
// FoundationModels native modules in the same custom dev client —
// see `docs/VOICE_LIVE_ACTIVITY.md` for the bridging plan.
//
// On every other platform/version (Android, web, Expo Go, iOS < 16.1,
// or any build where the WidgetKit extension hasn't been linked in
// yet) we short-circuit with a typed `unavailable` result so callers
// can render a meaningful in-app fallback without crashing. The
// existing in-app "Processing memory…" banner on the voice-capture
// screen is the foreground companion for the same lifecycle, so a
// missing Live Activity is never user-visible — the banner already
// covers it.

import { Platform } from "react-native";

export type LiveActivityUnavailableReason =
  | "ios_below_16_1"
  | "live_activities_disabled"
  | "module_not_linked"
  | "non_ios_platform"
  | "no_active_activity"
  | "start_failed"
  | "update_failed"
  | "end_failed"
  | "end_all_failed"
  | "unknown";

export type LiveActivityAvailability = {
  available: boolean;
  reason: LiveActivityUnavailableReason | null;
};

/** Phase the Live Activity should advertise. The native side maps
 *  these to a localized title/subtitle + the right SF Symbol. JS
 *  only sends the phase name so copy can be tweaked without a JS
 *  update. */
export type LiveActivityPhase = "processing" | "ready";

export type LiveActivityStartArgs = {
  /**
   * Deep link URL that opens the voice-capture screen when the user
   * taps the activity from the lock screen / Dynamic Island. Kept on
   * the JS side so the native module never has to hard-code a URL
   * scheme — if the app's expo-router scheme changes, this argument
   * changes with it and the Swift bridge stays untouched.
   */
  deepLinkUrl: string;
};

export type LiveActivityStartResult =
  | { status: "ok"; activityId: string }
  | { status: "unavailable"; reason: LiveActivityUnavailableReason };

export type LiveActivityMutationResult =
  | { status: "ok" }
  | { status: "unavailable"; reason: LiveActivityUnavailableReason };

type NativeShape = {
  getAvailability: () => { available: boolean; reason: string | null };
  startActivity: (
    args: LiveActivityStartArgs,
  ) => Promise<
    | { status: "ok"; activityId: string }
    | { status: "unavailable"; reason: string }
  >;
  updateActivity: (
    activityId: string,
    phase: LiveActivityPhase,
  ) => Promise<{ status: "ok" } | { status: "unavailable"; reason: string }>;
  endActivity: (
    activityId: string,
  ) => Promise<{ status: "ok" } | { status: "unavailable"; reason: string }>;
  endAllActivities: () => Promise<
    | { status: "ok"; endedCount: number }
    | { status: "unavailable"; reason: string }
  >;
};

export type LiveActivityEndAllResult =
  | { status: "ok"; endedCount: number }
  | { status: "unavailable"; reason: LiveActivityUnavailableReason };

let cachedNative: NativeShape | null | undefined;

function getNativeModule(): NativeShape | null {
  if (cachedNative !== undefined) return cachedNative;
  if (Platform.OS !== "ios") {
    cachedNative = null;
    return cachedNative;
  }
  try {
    // `requireNativeModule` throws synchronously when the native
    // module is not linked into the running binary (Expo Go, web,
    // older dev clients built before this module was added). We
    // swallow the throw so callers always get a typed fallback.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require("expo-modules-core") as {
      requireNativeModule: (name: string) => NativeShape;
    };
    cachedNative = core.requireNativeModule("VoiceProcessingLiveActivity");
  } catch {
    cachedNative = null;
  }
  return cachedNative;
}

function normalizeReason(
  reason: string | null | undefined,
): LiveActivityUnavailableReason {
  switch (reason) {
    case "ios_below_16_1":
    case "live_activities_disabled":
    case "module_not_linked":
    case "non_ios_platform":
    case "no_active_activity":
    case "start_failed":
    case "update_failed":
    case "end_failed":
    case "end_all_failed":
      return reason;
    default:
      return "unknown";
  }
}

export function getAvailability(): LiveActivityAvailability {
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

export async function startActivity(
  args: LiveActivityStartArgs,
): Promise<LiveActivityStartResult> {
  if (Platform.OS !== "ios") {
    return { status: "unavailable", reason: "non_ios_platform" };
  }
  const native = getNativeModule();
  if (!native) {
    return { status: "unavailable", reason: "module_not_linked" };
  }
  try {
    const result = await native.startActivity(args);
    if (result.status === "ok") {
      return result;
    }
    return { status: "unavailable", reason: normalizeReason(result.reason) };
  } catch {
    return { status: "unavailable", reason: "start_failed" };
  }
}

export async function updateActivity(
  activityId: string,
  phase: LiveActivityPhase,
): Promise<LiveActivityMutationResult> {
  if (Platform.OS !== "ios") {
    return { status: "unavailable", reason: "non_ios_platform" };
  }
  const native = getNativeModule();
  if (!native) {
    return { status: "unavailable", reason: "module_not_linked" };
  }
  try {
    const result = await native.updateActivity(activityId, phase);
    if (result.status === "ok") {
      return result;
    }
    return { status: "unavailable", reason: normalizeReason(result.reason) };
  } catch {
    return { status: "unavailable", reason: "update_failed" };
  }
}

export async function endActivity(
  activityId: string,
): Promise<LiveActivityMutationResult> {
  if (Platform.OS !== "ios") {
    return { status: "unavailable", reason: "non_ios_platform" };
  }
  const native = getNativeModule();
  if (!native) {
    return { status: "unavailable", reason: "module_not_linked" };
  }
  try {
    const result = await native.endActivity(activityId);
    if (result.status === "ok") {
      return result;
    }
    return { status: "unavailable", reason: normalizeReason(result.reason) };
  } catch {
    return { status: "unavailable", reason: "end_failed" };
  }
}

/**
 * Sweep up every in-flight `Activity<VoiceProcessingAttributes>`
 * the system still knows about. Intended to be called once on cold
 * start so a force-quit (or OS-kill) during a previous recording
 * session doesn't leave a stale "Processing memory…" pill on the
 * lock screen / Dynamic Island.
 *
 * Same fallback contract as the rest of this module's surface:
 * resolves with a typed `unavailable` envelope on every failure
 * path (Android, web, iOS < 16.1, missing extension, throw from
 * the bridge) so callers never need a try/catch.
 */
export async function endAllActivities(): Promise<LiveActivityEndAllResult> {
  if (Platform.OS !== "ios") {
    return { status: "unavailable", reason: "non_ios_platform" };
  }
  const native = getNativeModule();
  if (!native) {
    return { status: "unavailable", reason: "module_not_linked" };
  }
  try {
    const result = await native.endAllActivities();
    if (result.status === "ok") {
      return result;
    }
    return { status: "unavailable", reason: normalizeReason(result.reason) };
  } catch {
    return { status: "unavailable", reason: "end_all_failed" };
  }
}

// Test-only escape hatches so jest can simulate the module being
// linked / unavailable without touching real native code. Mirrors
// the `foundation-models` module's testing surface.
export function __setNativeModuleForTests(module: NativeShape | null): void {
  cachedNative = module;
}

export function __resetNativeModuleForTests(): void {
  cachedNative = undefined;
}
