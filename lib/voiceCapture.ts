/**
 * Voice capture pipeline for "Speak a memory" mode (Task #171).
 *
 * Two pluggable provider hooks:
 *
 *   1. SpeechToTextProvider — turns a recording file URI into raw
 *      text. The shipping target is WhisperKit on-device (Task brief
 *      §3.4), but WhisperKit needs a custom dev-client / EAS build
 *      and an iOS-only Swift package, neither of which exists yet
 *      in this Expo managed workflow. Until that native module
 *      lands, the screen treats `isSpeechToTextAvailable()` as
 *      `false` and renders a calm "Voice transcription is coming
 *      soon" placeholder + the manual-text fallback. A separate
 *      follow-up task wires the real provider via
 *      `setSpeechToTextProvider()` from native module init.
 *
 *   2. StructuredExtractor — turns a transcript into a
 *      `StructuredMemoryDraft`. The shipping target is the iOS-26
 *      Foundation Models native module (the dependency the brief
 *      calls out). Until it ships, the default extractor is the
 *      pure heuristic from `voiceMemoryPipeline.ts`. The native
 *      module, when registered, can swap in via
 *      `setStructuredExtractor()` and will produce a richer draft
 *      using the same `StructuredMemoryDraft` shape so the screen
 *      doesn't need to know which path produced the result.
 *
 *   3. SpeechToTextStreamProvider (Task #265) — drives live
 *      captions while the user is speaking. Returns a session handle
 *      whose `stop()` resolves with the final transcript so the
 *      existing drafting pipeline is unchanged. The streaming slot
 *      is optional: when null the recording screen simply omits the
 *      caption line and falls back to the file-based STT provider
 *      after stop.
 *
 * Why a setter-based registry instead of a constant module import:
 * the native modules will register themselves at app boot from
 * their own bridging code, and they need the registration to be a
 * side-effect-only call so the rest of the app keeps booting on
 * platforms where the module can't load. This is the same pattern
 * `lib/aiEngine.ts::configureEngineMutator` uses for its mutator
 * — copying that shape keeps the codebase consistent.
 *
 * All async returns reject (not resolve with `null`) on failure so
 * the screen can surface a real error message instead of treating
 * an empty result as "user said nothing". The `*Available()`
 * helpers let the screen check up-front whether to even render
 * the voice button.
 */

import {
  extractStructuredMemory as heuristicExtract,
  type StructuredMemoryDraft,
} from "./voiceMemoryPipeline";
import type { STTUnavailableReason } from "../modules/speech-to-text";

export type { STTUnavailableReason } from "../modules/speech-to-text";
export type {
  StructuredMemoryDraft,
  EmotionalTone,
  VoiceSuggestedTag,
} from "./voiceMemoryPipeline";

export type SpeechToTextProvider = (audioFileUri: string) => Promise<string>;
export type StructuredExtractor = (
  transcript: string,
) => Promise<StructuredMemoryDraft>;

/**
 * A streaming STT session returned by a `SpeechToTextStreamProvider`.
 *
 * `stop()` tears down the audio tap and waits for the recognizer's
 * final `isFinal` callback before resolving — the final text is
 * always higher-confidence than the last partial seen by `onPartial`.
 * Resolves with `null` when the final result is unavailable (e.g.
 * the user didn't speak) so callers can fall back to file-based STT.
 *
 * **Design note — `stop()`-returns-final vs `onFinal` callback:**
 * The task brief mentioned an `onFinal` callback, but this API uses
 * `stop()` returning a Promise instead. This is intentional:
 *
 *   - The caller controls WHEN finalization happens (on button release),
 *     so a push `onFinal` callback would require extra bookkeeping to
 *     suppress it after the caller has already decided to stop.
 *   - `stop()` keeps the stopping logic sequential and avoids a
 *     callback-vs-promise hybrid that is harder to reason about in a
 *     component that already uses async/await throughout.
 *   - The equivalent `onFinal` semantics are simply: `const finalText
 *     = await session.stop()` — the two are isomorphic.
 */
export type SpeechToTextStreamSession = {
  stop: () => Promise<string | null>;
};

/**
 * A streaming STT provider starts a live recognition session and
 * fires `onPartial` for each intermediate result. Returns a session
 * handle (or `null` when the provider cannot start, e.g. mic
 * permission denied) — callers check for null and fall back to the
 * file-based `SpeechToTextProvider` path.
 */
export type SpeechToTextStreamProvider = (callbacks: {
  onPartial: (text: string) => void;
}) => Promise<SpeechToTextStreamSession | null>;

interface ProviderRegistry {
  stt: SpeechToTextProvider | null;
  stream: SpeechToTextStreamProvider | null;
  extractor: StructuredExtractor | null;
  /**
   * Human-readable name of the engine backing `stt`, surfaced as a
   * small badge on the voice-capture drafting view so the user can
   * confirm which on-device provider produced their transcript.
   * Null when no STT provider is registered or when a provider was
   * registered without a label.
   */
  sttEngineName: string | null;
  /**
   * Typed reason code from the last failed `registerOnDeviceSpeechToText`
   * call. Null when registration succeeded or has not been attempted.
   * Stored here (rather than returned from the registration call directly
   * to the screen) so the voice-capture screen can read it without
   * importing the native module — preserving the test-isolation contract
   * in `lib/speechToText.ts`.
   */
  sttUnavailableReason: STTUnavailableReason | null;
}

/**
 * Module-level singleton registry. Reset by tests via
 * `resetVoiceCaptureProviders()` so a test that wires a fake
 * provider cannot leak its provider into the next test.
 *
 * Default `extractor` is `null` here — `extractFromTranscript()`
 * falls through to the heuristic when null. We don't pre-populate
 * with the heuristic so the registry's null-state is observable
 * (i.e. tests can assert "no native extractor was registered" by
 * reading `getVoiceCaptureProviders().extractor === null`).
 */
const registry: ProviderRegistry = {
  stt: null,
  stream: null,
  extractor: null,
  sttEngineName: null,
  sttUnavailableReason: null,
};

/**
 * Register the on-device speech-to-text provider. The optional
 * `engineName` is shown verbatim on the drafting view's "Transcribed
 * on-device" badge so the user knows which engine produced the text;
 * passing `null` (or omitting the option) means no badge is rendered.
 *
 * Contract: every call sets `sttEngineName` from scratch. The name
 * is taken from `options?.engineName` (or null when omitted), with
 * no silent inheritance from a previous registration. This means a
 * caller swapping providers must re-pass the engine name on every
 * call — preventing a stale label from outliving its provider when
 * a future caller registers a different engine without options.
 */
export function setSpeechToTextProvider(
  p: SpeechToTextProvider | null,
  options?: { engineName?: string | null },
): void {
  registry.stt = p;
  registry.sttEngineName = p == null ? null : options?.engineName ?? null;
}

/**
 * Register the streaming STT provider (Task #265). The streaming
 * provider runs concurrently with expo-audio's file recorder so the
 * screen can show live captions without waiting for stop(). Setting
 * to `null` disables live captions; the file-based `stt` provider
 * (if registered) still handles post-stop transcription.
 */
export function setSpeechToTextStreamProvider(
  p: SpeechToTextStreamProvider | null,
): void {
  registry.stream = p;
}

export function setStructuredExtractor(p: StructuredExtractor | null): void {
  registry.extractor = p;
}

/**
 * Test helper. Restores all slots to their boot-time `null` state.
 * Production code should never call this — register at boot, leave
 * registered for the app's lifetime.
 */
export function resetVoiceCaptureProviders(): void {
  registry.stt = null;
  registry.stream = null;
  registry.extractor = null;
  registry.sttEngineName = null;
  registry.sttUnavailableReason = null;
}

/** Read-only view of the registry. Useful for tests + the screen's
 *  "transcription not available yet" branch. */
export function getVoiceCaptureProviders(): Readonly<ProviderRegistry> {
  return {
    stt: registry.stt,
    stream: registry.stream,
    extractor: registry.extractor,
    sttEngineName: registry.sttEngineName,
    sttUnavailableReason: registry.sttUnavailableReason,
  };
}

/**
 * Store the typed reason code that caused registration to fail.
 * Called by `lib/speechToText.ts:registerOnDeviceSpeechToText()` on
 * every failure path so the voice-capture screen can surface a
 * specific explanation without importing the native module itself.
 * Passing `null` clears the reason (used by test resets).
 */
export function setSpeechToTextUnavailableReason(
  reason: STTUnavailableReason | null,
): void {
  registry.sttUnavailableReason = reason;
}

/**
 * Returns the typed reason code from the last failed registration
 * attempt, or `null` when registration succeeded or has not been
 * attempted yet. The voice-capture screen reads this to pick the
 * right one-line explanation for each failure mode.
 */
export function getSpeechToTextUnavailableReason(): STTUnavailableReason | null {
  return registry.sttUnavailableReason;
}

/**
 * `true` once the WhisperKit-or-equivalent native module has
 * registered itself. The screen guards the hold-to-record button
 * behind this flag — pressing it on an unsupported platform would
 * otherwise dead-end at the `transcribeRecording()` reject.
 */
export function isSpeechToTextAvailable(): boolean {
  return registry.stt != null;
}

/**
 * `true` when a streaming STT provider is registered. The recording
 * screen uses this to decide whether to start a streaming session
 * alongside the file recorder — when false it simply omits the
 * caption line and relies on `transcribeRecording()` after stop.
 */
export function isStreamingTranscriptionAvailable(): boolean {
  return registry.stream != null;
}

/**
 * Human-readable name of the engine backing the registered STT
 * provider, or null when no provider is registered (or one was
 * registered without a label). Used by the voice-capture drafting
 * view to render the "Transcribed on-device · {engineName}" badge.
 */
export function getSpeechToTextEngineName(): string | null {
  return registry.sttEngineName;
}

/**
 * `true` once the on-device Foundation Models native module has
 * registered itself. The screen surfaces a small "Apple
 * Intelligence" badge when this is on, so the user knows their
 * draft was produced by the native model and not the heuristic
 * fallback. Either path produces an editable draft — the badge is
 * informational only.
 */
export function isFoundationModelsAvailable(): boolean {
  return registry.extractor != null;
}

/**
 * Run the registered speech-to-text provider on an audio file. The
 * file URI comes from `expo-audio`'s `AudioRecorder.uri` after
 * `recorder.stop()` resolves. We do NOT upload the audio anywhere —
 * the on-device contract is enforced by the provider itself; this
 * facade is just a thin delegating layer.
 *
 * Rejects with a clear message if no provider is registered so the
 * screen can show a "transcription unavailable" toast instead of
 * silently producing an empty draft.
 */
export async function transcribeRecording(audioFileUri: string): Promise<string> {
  if (registry.stt == null) {
    throw new Error(
      "Voice transcription is not available in this installed build. " +
        "Install a build that includes voice transcription.",
    );
  }
  const text = await registry.stt(audioFileUri);
  return typeof text === "string" ? text : "";
}

/**
 * Start a streaming transcription session using the registered
 * streaming provider. Fires `onPartial` for each in-progress result
 * while the microphone is open.
 *
 * Returns a `SpeechToTextStreamSession` (or `null` if no streaming
 * provider is registered or the provider declined to start). The
 * session's `stop()` tears down the audio engine and returns the
 * final transcript text, or `null` when the recognizer produced no
 * usable output — callers should fall back to the file-based path
 * in the null case.
 */
export async function startStreamingTranscription(callbacks: {
  onPartial: (text: string) => void;
}): Promise<SpeechToTextStreamSession | null> {
  if (registry.stream == null) return null;
  try {
    return await registry.stream(callbacks);
  } catch {
    return null;
  }
}

/**
 * Turn a transcript into a structured draft. Uses the registered
 * Foundation Models provider when present; otherwise falls through
 * to the pure heuristic from `voiceMemoryPipeline.ts`.
 *
 * Both paths must produce a `StructuredMemoryDraft`. The native
 * extractor is allowed to throw — we catch and fall back to the
 * heuristic so a transient on-device LLM failure doesn't dead-end
 * the user with an empty draft. The screen never needs to know
 * which path produced the result.
 */
export async function extractFromTranscript(
  transcript: string,
): Promise<StructuredMemoryDraft> {
  if (registry.extractor != null) {
    try {
      const native = await registry.extractor(transcript);
      // Guard against a misbehaving native provider returning a
      // malformed object — fall back to the heuristic if any of
      // the contract fields are missing.
      if (
        native &&
        typeof native.title === "string" &&
        typeof native.body === "string" &&
        Array.isArray(native.tags) &&
        Array.isArray(native.people) &&
        typeof native.tone === "string"
      ) {
        return native;
      }
    } catch {
      // Fall through to heuristic — better a usable draft than a
      // dead-end error screen.
    }
  }
  return heuristicExtract(transcript);
}
