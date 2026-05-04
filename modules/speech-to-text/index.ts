// JS surface for the local `speech-to-text` Expo module.
//
// Bridges Apple's on-device Speech framework (`SFSpeechRecognizer`
// with `requiresOnDeviceRecognition = true`) so the voice-capture
// screen can turn a recorded `.m4a` file URI into text without
// uploading audio anywhere. The native side lives in
// `ios/SpeechToTextModule.swift` and is gated by
// `#if canImport(Speech)` + runtime `if #available(iOS 13.0, *)`.
//
// On every other platform/version (Android, web, Expo Go, iOS too
// old, locale without on-device support) we short-circuit with a
// typed `unavailable` result so callers always get a typed fallback
// instead of a thrown native error. The voice-capture screen treats
// "no provider registered" as "show the calm transcription-coming-
// soon placeholder", so a missing or refusing native module is never
// user-facing as a crash.
//
// Mirrors the shape of `modules/foundation-models/index.ts` and
// `modules/voice-processing-live-activity/index.ts` exactly so the
// three local modules look and behave the same way.
//
// Streaming transcription (Task #265):
// `transcribeStreaming` wires `startStreamingTranscription` /
// `stopStreamingTranscription` native calls together with the
// `onSpeechPartialResult` event stream so the voice-capture screen
// can render rolling live captions while the user is still speaking.
//
// Session identity:
// `startStreamingTranscription` returns a UUID token that must be
// passed back to `stopStreamingTranscription(token)`. The native
// layer validates this token and no-ops when it doesn't match the
// currently active session. This makes stale JS session handles safe
// to call — they resolve immediately with "unavailable" without
// disturbing a newer concurrent session started by a subsequent
// recording attempt.

import { Platform } from "react-native";

export type STTUnavailableReason =
  | "ios_too_old"
  | "framework_not_present"
  | "module_not_linked"
  | "non_ios_platform"
  | "recognizer_unavailable"
  | "on_device_unsupported"
  | "authorization_denied"
  | "invalid_uri"
  | "transcription_failed"
  | "unknown";

export type STTAvailability = {
  available: boolean;
  reason: STTUnavailableReason | null;
};

export type STTTranscribeResult =
  | { status: "ok"; text: string }
  | { status: "unavailable"; reason: STTUnavailableReason };

export type STTStreamingCallbacks = {
  /** Called for each partial (in-progress) recognition result.
   *  May be called many times before `stop()` is called. */
  onPartial: (text: string) => void;
};

export type STTStreamingSession = {
  /** Stop the microphone tap, end the recognition request, and wait
   *  for the final transcript from the recognizer. Always resolves —
   *  never throws — so callers don't need a try/catch. Stale session
   *  handles (from a prior recording attempt) resolve immediately
   *  with `{ status: "unavailable" }` via the native token mismatch
   *  check, never disturbing a newer concurrent session. */
  stop: () => Promise<STTTranscribeResult>;
};

type NativeShape = {
  getAvailability: () => { available: boolean; reason: string | null };
  transcribe: (
    audioFileUri: string,
  ) => Promise<
    | { status: "ok"; text: string }
    | { status: "unavailable"; reason: string }
  >;
  /** Returns `{ status: "ok", token: "<uuid>" }` on success. The
   *  caller must pass the token to `stopStreamingTranscription` so
   *  the native layer can validate session identity. */
  startStreamingTranscription: () => Promise<
    | { status: "ok"; token: string }
    | { status: "unavailable"; reason: string }
  >;
  /** `token` must match the value returned by the corresponding
   *  `startStreamingTranscription` call. A mismatched token is a
   *  safe no-op — returns `{ status: "unavailable" }` immediately
   *  without touching the current active session. */
  stopStreamingTranscription: (token: string) => Promise<
    | { status: "ok"; text: string }
    | { status: "unavailable"; reason: string }
  >;
};

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
    cachedNative = core.requireNativeModule("SpeechToText");
  } catch {
    cachedNative = null;
  }
  return cachedNative;
}

function normalizeReason(reason: string | null | undefined): STTUnavailableReason {
  switch (reason) {
    case "ios_too_old":
    case "framework_not_present":
    case "module_not_linked":
    case "non_ios_platform":
    case "recognizer_unavailable":
    case "on_device_unsupported":
    case "authorization_denied":
    case "invalid_uri":
    case "transcription_failed":
      return reason;
    default:
      return "unknown";
  }
}

export function getAvailability(): STTAvailability {
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

export async function transcribe(audioFileUri: string): Promise<STTTranscribeResult> {
  if (Platform.OS !== "ios") {
    return { status: "unavailable", reason: "non_ios_platform" };
  }
  const native = getNativeModule();
  if (!native) {
    return { status: "unavailable", reason: "module_not_linked" };
  }
  try {
    const result = await native.transcribe(audioFileUri);
    if (result.status === "ok") {
      return result;
    }
    return { status: "unavailable", reason: normalizeReason(result.reason) };
  } catch {
    return { status: "unavailable", reason: "transcription_failed" };
  }
}

/**
 * Start a streaming recognition session that fires `onPartial` for
 * each intermediate result while the microphone is open.
 *
 * Returns a `StreamingSession` whose `stop()` method tears down the
 * audio engine and waits for the recognizer's final `isFinal`
 * callback before resolving with the best complete transcript.
 *
 * Returns `null` (rather than throwing) when the native module is
 * unavailable, not linked, or denied authorization — so callers can
 * check for null and fall back to the file-based `transcribe` path
 * without a try/catch.
 *
 * Session identity contract: the UUID token returned by the native
 * `startStreamingTranscription` call is captured in the session
 * closure and passed to `stopStreamingTranscription` when `stop()`
 * is called. The native layer validates this token, so a stale JS
 * session handle calling `stop()` after a newer recording has started
 * will receive an immediate "unavailable" no-op response — it never
 * terminates a session it doesn't own.
 */
export async function transcribeStreaming(
  callbacks: STTStreamingCallbacks,
): Promise<STTStreamingSession | null> {
  if (Platform.OS !== "ios") return null;
  const native = getNativeModule();
  if (!native) return null;

  // Subscribe to partial-result events before starting the engine so
  // we never miss the very first partial that arrives immediately
  // after the engine is running.
  let subscription: { remove: () => void } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EventEmitter } = require("expo-modules-core") as {
      EventEmitter: new (nativeModule: unknown) => {
        addListener: (
          eventName: string,
          listener: (event: { text: string }) => void,
        ) => { remove: () => void };
      };
    };
    const emitter = new EventEmitter(native);
    subscription = emitter.addListener("onSpeechPartialResult", (event) => {
      if (typeof event?.text === "string") {
        callbacks.onPartial(event.text);
      }
    });
  } catch {
    // EventEmitter unavailable — we'll still work, just without partials.
  }

  let sessionToken: string;
  try {
    const startResult = await native.startStreamingTranscription();
    if (startResult.status !== "ok") {
      subscription?.remove();
      return null;
    }
    // Capture the token — it is the identity key for this session on
    // the native side. Only a stop call presenting this exact token
    // can terminate this session.
    sessionToken = (startResult as { status: "ok"; token: string }).token;
  } catch {
    subscription?.remove();
    return null;
  }

  return {
    stop: async (): Promise<STTTranscribeResult> => {
      // Remove the listener before calling stop so any final partial
      // event that races with the stop call doesn't fire onPartial
      // after the caller has already moved on to the final result.
      subscription?.remove();
      subscription = null;
      try {
        // Pass the session token so the native layer can validate
        // identity. A stale session calling stop after a newer
        // recording has started receives "unavailable" without
        // disturbing the active session.
        const result = await native.stopStreamingTranscription(sessionToken);
        if (result.status === "ok") {
          return result;
        }
        return {
          status: "unavailable",
          reason: normalizeReason((result as { status: "unavailable"; reason: string }).reason),
        };
      } catch {
        return { status: "unavailable", reason: "transcription_failed" };
      }
    },
  };
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
