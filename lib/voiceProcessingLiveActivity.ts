/**
 * Lifecycle helpers around the local `voice-processing-live-activity`
 * Expo module (Task #200).
 *
 * The voice-capture screen's "processing" phase needs the same
 * feedback when the user puts the phone down or switches apps mid-
 * walk. iOS 16.1+ ActivityKit Live Activities are the platform
 * answer; the Dynamic Island lights up on iPhone 14 Pro and newer,
 * and the lock screen renders the same activity on every other
 * supported iPhone. The native side is a Swift WidgetKit extension
 * shipped with the speech-to-text + FoundationModels native modules
 * in the same custom dev client — this file is the JS-side façade
 * the screen actually calls.
 *
 * Why the wrapper exists instead of importing the module directly:
 *
 *   1. The screen needs simple, side-effect-only verbs
 *      (`startProcessingActivity`, `markProcessingActivityReady`,
 *      `endProcessingActivity`) that swallow every failure path.
 *      A missing Live Activity is never user-facing — the in-app
 *      "Processing memory…" banner already covers it. Pushing a
 *      crash up to the screen would regress the brief.
 *   2. The screen tracks at most one in-flight activity at a time,
 *      so the wrapper hides the activity-handle bookkeeping behind
 *      an opaque token (`LiveActivityHandle`).
 *   3. Tests can swap the underlying native module via the same
 *      `__setNativeModuleForTests` escape hatch the
 *      `foundation-models` module uses, so unit tests for the
 *      voice-capture screen can assert the lifecycle without
 *      touching native code.
 */

import {
  endActivity,
  endAllActivities,
  getAvailability,
  startActivity,
  updateActivity,
  type LiveActivityAvailability,
  type LiveActivityPhase,
} from "../modules/voice-processing-live-activity";

/**
 * Opaque handle returned by `startProcessingActivity`. The screen
 * stores this in a ref and passes it back to the mark/end helpers
 * — no need to know it's the native ActivityKit identifier.
 *
 * `null` indicates "no Live Activity was actually started" (e.g.
 * native module not linked, iOS < 16.1, user disabled Live
 * Activities in Settings). The mark/end helpers are no-ops when
 * given a null handle, so the screen can call them unconditionally.
 */
export type LiveActivityHandle = string | null;

/** Deep link the activity should open when the user taps it. */
export const VOICE_CAPTURE_DEEP_LINK = "memtool:///voice-capture";

export function isLiveActivityAvailable(): boolean {
  return getAvailability().available;
}

export function getLiveActivityAvailability(): LiveActivityAvailability {
  return getAvailability();
}

/**
 * Start the "Processing memory…" Live Activity. Returns a handle the
 * caller passes to `markProcessingActivityReady` / `endProcessingActivity`.
 *
 * Resolves with `null` (not a rejection) when:
 *   - the platform isn't iOS, or
 *   - the WidgetKit extension isn't linked into this build, or
 *   - the user has Live Activities turned off in Settings, or
 *   - ActivityKit refused the request for any other reason.
 *
 * Never throws — the in-app banner is the foreground surrogate, so
 * a missing Live Activity is silently degraded.
 */
export async function startProcessingActivity(args?: {
  deepLinkUrl?: string;
}): Promise<LiveActivityHandle> {
  try {
    const result = await startActivity({
      deepLinkUrl: args?.deepLinkUrl ?? VOICE_CAPTURE_DEEP_LINK,
    });
    return result.status === "ok" ? result.activityId : null;
  } catch {
    return null;
  }
}

/**
 * Flip the Live Activity from "Processing memory…" to
 * "Memory ready — tap to review" once extraction completes.
 * No-op when the handle is null (no activity was ever started).
 *
 * The native side is responsible for the actual copy — JS just
 * sends the phase enum so the WidgetKit extension owns the
 * localized strings. See `docs/VOICE_LIVE_ACTIVITY.md`.
 */
export async function markProcessingActivityReady(
  handle: LiveActivityHandle,
): Promise<void> {
  if (handle == null) return;
  await updateActivityQuietly(handle, "ready");
}

/**
 * Dismiss the Live Activity. Called when the user saves or
 * discards the draft, when re-recording, and on screen unmount as
 * a defensive cleanup so an activity never outlives its session.
 * No-op when the handle is null.
 */
export async function endProcessingActivity(
  handle: LiveActivityHandle,
): Promise<void> {
  if (handle == null) return;
  try {
    await endActivity(handle);
  } catch {
    // Swallow — there is no recovery path. If the activity is
    // already ended (e.g. user dismissed it from the lock screen)
    // the next recording will start a fresh one.
  }
}

async function updateActivityQuietly(
  handle: string,
  phase: LiveActivityPhase,
): Promise<void> {
  try {
    await updateActivity(handle, phase);
  } catch {
    // Same rationale as `endProcessingActivity`'s catch — a missing
    // or already-ended activity must not crash the save flow.
  }
}

/**
 * Sweep up any leftover voice-processing Live Activities at cold
 * start.
 *
 * The voice-capture screen ends its Live Activity on save, discard,
 * re-record, and unmount, so in the happy path this helper finds
 * nothing to do. The case it covers is a force-quit (or OS-kill)
 * mid-recording: ActivityKit keeps the lock-screen / Dynamic Island
 * pill alive across app restarts, and without an explicit cleanup
 * the next session inherits a "Processing memory…" pill that will
 * never flip to "Memory ready" — it would just sit there until the
 * user manually swipes it away or iOS hits its 8-hour stale timeout.
 *
 * Wired into `app/_layout.tsx` so it fires once per cold start,
 * before the user can navigate to voice-capture and start a fresh
 * recording session.
 *
 * No-op (silently degraded) on every platform / build that can't
 * host the Live Activity in the first place: Android, web, Expo
 * Go, iOS < 16.1, and any dev client built before the WidgetKit
 * extension was linked in. Never throws — the underlying module
 * already routes every failure path through a typed `unavailable`
 * envelope; we additionally swallow any unexpected synchronous
 * throw so a misbehaving native bridge can't take down app launch.
 */
export async function cleanUpStaleProcessingActivities(): Promise<void> {
  try {
    await endAllActivities();
  } catch {
    // Defence-in-depth — `endAllActivities` already swallows native
    // rejections internally, but a totally broken bridge could throw
    // synchronously before the promise is ever returned. App launch
    // must never crash because of leftover-pill cleanup.
  }
}
