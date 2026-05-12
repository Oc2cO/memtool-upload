/**
 * Boot-time bridge that registers Apple's on-device Speech framework
 * as the SpeechToTextProvider used by the voice-capture screen
 * (Task #199).
 *
 * Task #265 extends this bridge to also register a
 * SpeechToTextStreamProvider so the recording screen can render live
 * rolling captions while the user speaks. The streaming provider
 * wraps `transcribeStreaming` from `modules/speech-to-text` and maps
 * the session's `stop()` result to the `string | null` shape the
 * voiceCapture registry expects. Both providers are registered in a
 * single `registerOnDeviceSpeechToText()` call so availability
 * (`isSpeechToTextAvailable()` / `isStreamingTranscriptionAvailable()`)
 * are always in sync.
 *
 * Why a bridge module instead of importing the native module directly
 * into `voiceCapture.ts`:
 *
 *   - `voiceCapture.ts` is consumed by jest unit tests that don't
 *     have the native module linked. Keeping the registration as a
 *     side-effect-only helper means the lib can be mocked at the
 *     boundary without dragging Apple's `Speech` framework into the
 *     test runner.
 *   - The provider is registered exactly once at app boot from
 *     `app/_layout.tsx`, mirroring the same pattern
 *     `initializeRevenueCat()` already uses.
 *   - When the module isn't linked / available (Expo Go, Android,
 *     web, iOS too old, on-device recognition unsupported by the
 *     active locale), the bridge silently no-ops and the screen's
 *     calm "transcription unavailable on this build" placeholder remains visible.
 *     There is no user-facing failure path — the screen guards the
 *     hold-to-record button behind `isSpeechToTextAvailable()`.
 */

import {
  setSpeechToTextProvider,
  setSpeechToTextStreamProvider,
  setSpeechToTextUnavailableReason,
  type SpeechToTextProvider,
  type SpeechToTextStreamProvider,
} from "./voiceCapture";
import {
  getAvailability,
  transcribe,
  transcribeStreaming,
  type STTUnavailableReason,
} from "../modules/speech-to-text";

/** Human-readable engine name surfaced as the "Transcribed on-device"
 *  badge on the drafting view. Centralised here (instead of the
 *  screen) so a future swap to a different on-device engine
 *  (WhisperKit, etc.) only needs to touch this file. */
export const ON_DEVICE_SPEECH_ENGINE = "Apple Speech (on-device)";

// Launch safety: keep live captions off until the streaming Apple
// Speech path can be validated not to compete with expo-audio's file
// recorder for the microphone. File-based transcription stays active.
const ENABLE_STREAMING_TRANSCRIPTION = false;

let registered = false;

export type RegisterResult =
  | { registered: true }
  | { registered: false; reason: STTUnavailableReason };

/**
 * Attempt to register the on-device speech-to-text provider.
 * Idempotent — calling it more than once is a no-op so app-boot
 * ordering quirks (StrictMode double-invokes, fast refresh) don't
 * accidentally swap the provider out from under an in-flight
 * recording.
 *
 * Never throws. Every failure path returns a typed `RegisterResult`
 * so the caller can log a developer-friendly message without a
 * try/catch.
 *
 * Returns `{ registered: false, reason }` (and leaves the registry
 * untouched) when:
 *   - the platform isn't iOS (`non_ios_platform`),
 *   - the dev client wasn't built with this module (`module_not_linked`),
 *   - the device's iOS is too old for `SFSpeechRecognizer`
 *     (`ios_too_old`),
 *   - the active locale's recognizer doesn't support on-device
 *     recognition (`on_device_unsupported`),
 *   - or any other reason the native availability probe surfaced.
 *
 * On success the file-based provider is always registered. The
 * streaming provider (Task #265) remains implemented below but is
 * launch-disabled so hold-to-record has a single microphone owner.
 */
export function registerOnDeviceSpeechToText(): RegisterResult {
  if (registered) return { registered: true };
  const availability = getAvailability();
  if (!availability.available) {
    const reason = availability.reason ?? "unknown";
    // Persist the typed reason into the voice-capture registry so the
    // voice-capture screen can surface a specific explanation for each
    // failure mode without importing the native module itself.
    setSpeechToTextUnavailableReason(reason);
    return {
      registered: false,
      reason,
    };
  }

  // File-based provider (existing path, Task #199): used after the
  // recording stops to transcribe the saved audio file when no
  // streaming final transcript is available or when streaming was
  // not active.
  const provider: SpeechToTextProvider = async (audioFileUri) => {
    const result = await transcribe(audioFileUri);
    if (result.status === "ok") return result.text;
    throw new Error(humanizeReason(result.reason));
  };

  // Streaming provider (Task #265): drives live captions while the
  // user is holding the mic button. The session's `stop()` waits for
  // the recognizer's `isFinal` callback and returns the final
  // transcript text (or null on any error), so the recording screen
  // can prefer it over the file-based transcription path.
  const streamProvider: SpeechToTextStreamProvider = async ({ onPartial }) => {
    const session = await transcribeStreaming({ onPartial });
    if (!session) return null;
    return {
      stop: async () => {
        const result = await session.stop();
        return result.status === "ok" ? result.text : null;
      },
    };
  };

  setSpeechToTextProvider(provider, { engineName: ON_DEVICE_SPEECH_ENGINE });
  setSpeechToTextStreamProvider(
    ENABLE_STREAMING_TRANSCRIPTION ? streamProvider : null,
  );
  registered = true;
  return { registered: true };
}

/**
 * Test-only — undoes a registration so each test starts from a
 * clean slate. Production code never needs this; the provider is
 * registered once at boot and stays for the app's lifetime.
 */
export function __resetSpeechToTextRegistrationForTests(): void {
  registered = false;
  setSpeechToTextProvider(null);
  setSpeechToTextStreamProvider(null);
  // Clear the persisted reason too so a test that simulated an
  // earlier failed registration cannot leak its reason into the
  // next test's render.
  setSpeechToTextUnavailableReason(null);
}

/**
 * Map a machine-readable failure reason from the native module into
 * a calm, user-readable sentence that the voice-capture screen can
 * surface in its existing "Couldn't process that recording" alert.
 * The screen never inspects the raw reason string — it just shows
 * `err.message`.
 */
function humanizeReason(reason: STTUnavailableReason): string {
  switch (reason) {
    case "authorization_denied":
      return "Speech recognition permission was denied. Enable it in Settings to use Speak a memory.";
    case "on_device_unsupported":
      return "On-device speech recognition isn't supported for the device's current language.";
    case "transcription_failed":
      return "Apple Speech couldn't transcribe that recording. Try again, or type the memory below.";
    case "invalid_uri":
      return "The recording file couldn't be read. Try recording again.";
    case "recognizer_unavailable":
      return "Speech recognition is temporarily unavailable. Try again in a moment.";
    case "ios_too_old":
    case "framework_not_present":
    case "module_not_linked":
    case "non_ios_platform":
    case "unknown":
    default:
      return "On-device speech recognition isn't available on this device.";
  }
}
