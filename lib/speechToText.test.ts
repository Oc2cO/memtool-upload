/**
 * Unit tests for the on-device speech-to-text boot bridge
 * (`lib/speechToText.ts`, Task #199).
 *
 * Mocks the local `modules/speech-to-text` JS surface so the bridge
 * can be exercised end-to-end (availability probe → provider
 * registration → transcript dispatch) without dragging Apple's
 * Speech framework into the test runner. The screen's own coverage
 * (`app/(app)/__tests__/voice-capture.test.tsx`) mocks
 * `@/lib/voiceCapture` directly, so this file is the single place
 * that proves the registry actually flips when the native module
 * reports availability.
 */

import {
  ON_DEVICE_SPEECH_ENGINE,
  __resetSpeechToTextRegistrationForTests,
  registerOnDeviceSpeechToText,
} from "./speechToText";
import {
  getSpeechToTextEngineName,
  isSpeechToTextAvailable,
  resetVoiceCaptureProviders,
  transcribeRecording,
} from "./voiceCapture";

const mockGetAvailability = jest.fn();
const mockTranscribe = jest.fn();

jest.mock("../modules/speech-to-text", () => ({
  getAvailability: (...args: unknown[]) => mockGetAvailability(...args),
  transcribe: (...args: unknown[]) => mockTranscribe(...args),
}));

beforeEach(() => {
  mockGetAvailability.mockReset();
  mockTranscribe.mockReset();
  __resetSpeechToTextRegistrationForTests();
  resetVoiceCaptureProviders();
});

describe("registerOnDeviceSpeechToText", () => {
  test("does not register when the native module reports unavailable", () => {
    mockGetAvailability.mockReturnValue({
      available: false,
      reason: "module_not_linked",
    });

    const result = registerOnDeviceSpeechToText();

    expect(result).toEqual({ registered: false, reason: "module_not_linked" });
    expect(isSpeechToTextAvailable()).toBe(false);
    expect(getSpeechToTextEngineName()).toBeNull();
  });

  test("flips the registry and labels the engine when available", () => {
    mockGetAvailability.mockReturnValue({ available: true, reason: null });

    const result = registerOnDeviceSpeechToText();

    expect(result).toEqual({ registered: true });
    // The screen guards the mic button behind this flag — once the
    // bridge has registered, hold-to-record must light up.
    expect(isSpeechToTextAvailable()).toBe(true);
    // The drafting badge text comes straight from this label, so
    // the value is part of the user-facing contract.
    expect(getSpeechToTextEngineName()).toBe(ON_DEVICE_SPEECH_ENGINE);
  });

  test("registered provider delegates to the native transcribe call", async () => {
    mockGetAvailability.mockReturnValue({ available: true, reason: null });
    mockTranscribe.mockResolvedValue({
      status: "ok",
      text: "had coffee with Alex",
    });

    registerOnDeviceSpeechToText();

    const text = await transcribeRecording("file:///recording.m4a");
    expect(text).toBe("had coffee with Alex");
    expect(mockTranscribe).toHaveBeenCalledWith("file:///recording.m4a");
  });

  test("registered provider throws a humanized message on native failure", async () => {
    mockGetAvailability.mockReturnValue({ available: true, reason: null });
    mockTranscribe.mockResolvedValue({
      status: "unavailable",
      reason: "transcription_failed",
    });

    registerOnDeviceSpeechToText();

    await expect(transcribeRecording("file:///recording.m4a")).rejects.toThrow(
      /Apple Speech couldn't transcribe/i,
    );
  });

  test("authorization_denied surfaces a settings hint", async () => {
    mockGetAvailability.mockReturnValue({ available: true, reason: null });
    mockTranscribe.mockResolvedValue({
      status: "unavailable",
      reason: "authorization_denied",
    });

    registerOnDeviceSpeechToText();

    await expect(transcribeRecording("file:///x.m4a")).rejects.toThrow(
      /Settings/i,
    );
  });

  test("is idempotent — second call is a no-op even after availability flips", () => {
    mockGetAvailability.mockReturnValue({ available: true, reason: null });
    expect(registerOnDeviceSpeechToText()).toEqual({ registered: true });

    // Even if a subsequent availability probe would say "no", the
    // already-registered provider must stay put — production code
    // calls register once at app boot and must not be re-evaluated
    // mid-session by a fast refresh / StrictMode double-invoke.
    mockGetAvailability.mockReturnValue({
      available: false,
      reason: "module_not_linked",
    });

    expect(registerOnDeviceSpeechToText()).toEqual({ registered: true });
    expect(isSpeechToTextAvailable()).toBe(true);
    expect(getSpeechToTextEngineName()).toBe(ON_DEVICE_SPEECH_ENGINE);
    // The probe should only have run once — the second call short-
    // circuited on the `registered` flag.
    expect(mockGetAvailability).toHaveBeenCalledTimes(1);
  });

  test("falls back to 'unknown' when the native availability probe returns no reason", () => {
    mockGetAvailability.mockReturnValue({ available: false, reason: null });

    const result = registerOnDeviceSpeechToText();

    expect(result).toEqual({ registered: false, reason: "unknown" });
  });
});

describe("setSpeechToTextProvider engine-name semantics", () => {
  // Defends the documented contract on `setSpeechToTextProvider`:
  // every call sets `sttEngineName` from scratch — there is no
  // silent inheritance from a previous registration. Without this
  // contract, a future caller that swaps in a different STT engine
  // without re-passing options would leave the screen displaying
  // the old "Apple Speech (on-device)" badge above transcripts
  // produced by the new engine.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setSpeechToTextProvider } = require("./voiceCapture") as typeof import("./voiceCapture");

  const fakeProviderA = async () => "from a";
  const fakeProviderB = async () => "from b";

  test("clears the engine name when a non-null provider is registered without options", () => {
    setSpeechToTextProvider(fakeProviderA, { engineName: "Engine A" });
    expect(getSpeechToTextEngineName()).toBe("Engine A");

    // Swapping to a different provider without options must NOT
    // leave the old "Engine A" label hanging — the new provider
    // would otherwise be silently misattributed on the badge.
    setSpeechToTextProvider(fakeProviderB);
    expect(getSpeechToTextEngineName()).toBeNull();
    expect(isSpeechToTextAvailable()).toBe(true);
  });

  test("clears the engine name when options omits engineName", () => {
    setSpeechToTextProvider(fakeProviderA, { engineName: "Engine A" });
    setSpeechToTextProvider(fakeProviderB, {});
    expect(getSpeechToTextEngineName()).toBeNull();
  });

  test("sets the engine name on every successful registration", () => {
    setSpeechToTextProvider(fakeProviderA, { engineName: "Engine A" });
    expect(getSpeechToTextEngineName()).toBe("Engine A");

    setSpeechToTextProvider(fakeProviderB, { engineName: "Engine B" });
    expect(getSpeechToTextEngineName()).toBe("Engine B");
  });

  test("clears the engine name when the provider is cleared", () => {
    setSpeechToTextProvider(fakeProviderA, { engineName: "Engine A" });
    setSpeechToTextProvider(null);
    expect(getSpeechToTextEngineName()).toBeNull();
    expect(isSpeechToTextAvailable()).toBe(false);
  });
});
