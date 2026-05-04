/**
 * Android hardware-back coverage for the voice-capture screen
 * (Task #223 — pins the BackHandler listener added in Task #218).
 *
 * The screen registers a `hardwareBackPress` listener so the system
 * back gesture can't:
 *   - leave the recorder running mid-record (the audio session would
 *     hold the mic until GC), or
 *   - silently drop a draft mid-edit (without going through the same
 *     "Discard this memory?" prompt the close button shows).
 *
 * This file simulates `Platform.OS === "android"` and drives the
 * captured handler directly so a future refactor of the recorder
 * lifecycle or the phase machine can't regress the behavior without
 * a test failing.
 */
import React from "react";
import { Alert, BackHandler, Platform } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockAddMemory = jest.fn();

const mockStart = jest.fn();
const mockMarkReady = jest.fn();
const mockEnd = jest.fn();

const mockTranscribe = jest.fn();
const mockExtract = jest.fn();
const mockStartStreaming = jest.fn();

let mockTodayMemories: unknown[] = [];
let mockIsPro = false;

jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    push: jest.fn(),
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#fff",
    border: "#ccc",
    primary: "#007aff",
    primaryForeground: "#fff",
    mutedForeground: "#666",
    radius: 8,
  }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "test-user", email: "test@t" } }),
}));

jest.mock("@/context/MemoriesContext", () => ({
  useMemories: () => ({
    addMemory: mockAddMemory,
    get todayMemories() {
      return mockTodayMemories;
    },
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({
    status: { is_pro: mockIsPro },
  }),
}));

jest.mock("@/components/ProUpsellCard", () => {
  const ReactActual = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  return {
    ProUpsellCard: ({ title }: { title: string }) =>
      ReactActual.createElement(RN.Text, { testID: "pro-upsell-card" }, title),
  };
});

jest.mock("@/lib/voiceProcessingLiveActivity", () => ({
  startProcessingActivity: (...args: unknown[]) => mockStart(...args),
  markProcessingActivityReady: (...args: unknown[]) => mockMarkReady(...args),
  endProcessingActivity: (...args: unknown[]) => mockEnd(...args),
  VOICE_CAPTURE_DEEP_LINK: "memtool:///voice-capture",
}));

jest.mock("@/lib/voiceCapture", () => ({
  transcribeRecording: (...args: unknown[]) => mockTranscribe(...args),
  extractFromTranscript: (...args: unknown[]) => mockExtract(...args),
  isSpeechToTextAvailable: () => true,
  isFoundationModelsAvailable: () => false,
  isStreamingTranscriptionAvailable: () => false,
  startStreamingTranscription: (...args: unknown[]) =>
    mockStartStreaming(...args),
  getSpeechToTextEngineName: () => null,
  getSpeechToTextUnavailableReason: () => null,
}));

const mockRecorder = {
  prepareToRecordAsync: jest.fn(() => Promise.resolve()),
  record: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
  uri: "file:///mock-recording.m4a" as string | null,
};

jest.mock("expo-audio", () => ({
  useAudioRecorder: () => mockRecorder,
  useAudioRecorderState: () => ({
    isRecording: false,
    durationMillis: 0,
  }),
  AudioModule: {
    requestRecordingPermissionsAsync: jest.fn(() =>
      Promise.resolve({ granted: true, canAskAgain: true, expires: "never" }),
    ),
  },
  RecordingPresets: { HIGH_QUALITY: {} },
}));

import VoiceCaptureScreen from "../voice-capture";

const HANDLE = "activity-1";

const SAMPLE_DRAFT = {
  title: "Coffee with Alex",
  body: "Had coffee with Alex this morning.",
  tags: [] as string[],
  people: ["Alex"],
  tone: "happy" as const,
  isEmpty: false,
};

/**
 * Capture the latest `hardwareBackPress` handler the screen
 * registers. The screen re-runs the `useEffect` whenever the phase
 * changes (handler closure depends on `phase`), so we always invoke
 * the most recent registration to mimic what the OS would do.
 */
let backHandlerSpy: jest.SpyInstance;
let registeredHandlers: Array<() => boolean> = [];
const subscriptionRemove = jest.fn();

function currentBackHandler(): () => boolean {
  const handler = registeredHandlers[registeredHandlers.length - 1];
  if (!handler) {
    throw new Error(
      "BackHandler.addEventListener was never called — the screen is " +
        "expected to register a hardwareBackPress listener on Android.",
    );
  }
  return handler;
}

// Booting the screen pulls in a deep mock surface (router, contexts,
// audio, voice pipeline) and the recording phase test needs the
// hydration effect plus the press flow to settle, which can run past
// jest's default 5s on a cold worker.
jest.setTimeout(20000);

describe("VoiceCaptureScreen — Android hardware back (Task #223)", () => {
  let alertSpy: jest.SpyInstance;
  let originalPlatformOS: typeof Platform.OS;

  beforeEach(() => {
    jest.useFakeTimers();

    // Pretend we're on Android so the BackHandler effect actually
    // registers — iOS short-circuits the listener registration.
    originalPlatformOS = Platform.OS;
    Platform.OS = "android";

    registeredHandlers = [];
    subscriptionRemove.mockReset();
    backHandlerSpy = jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation((
        ..._args: Parameters<typeof BackHandler.addEventListener>
      ): ReturnType<typeof BackHandler.addEventListener> => {
        const cb = _args[1] as () => boolean;
        registeredHandlers.push(cb);
        return { remove: subscriptionRemove };
      });

    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddMemory.mockReset();
    mockAddMemory.mockResolvedValue({ syncedToCloud: true });

    mockStart.mockReset();
    mockMarkReady.mockReset();
    mockEnd.mockReset();
    mockStart.mockResolvedValue(HANDLE);
    mockMarkReady.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);

    mockTranscribe.mockReset();
    mockExtract.mockReset();
    mockTranscribe.mockResolvedValue("Had coffee with Alex this morning.");
    mockExtract.mockResolvedValue({ ...SAMPLE_DRAFT });

    mockStartStreaming.mockReset();
    mockStartStreaming.mockResolvedValue(null);

    mockRecorder.prepareToRecordAsync.mockClear();
    mockRecorder.record.mockClear();
    mockRecorder.stop.mockClear();
    mockRecorder.stop.mockImplementation(() => Promise.resolve());
    mockRecorder.uri = "file:///mock-recording.m4a";

    mockTodayMemories = [];
    mockIsPro = false;

    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    backHandlerSpy.mockRestore();
    Platform.OS = originalPlatformOS;
    jest.useRealTimers();
  });

  test("back during recording stops the recorder and returns to idle", async () => {
    const view = render(<VoiceCaptureScreen />);

    // Hold the mic button to enter the recording phase.
    await act(async () => {
      fireEvent(
        view.getByLabelText("Hold to record a voice memory"),
        "pressIn",
      );
    });

    // Pre-condition: recording phase is showing the release button,
    // and the recorder is running (no stop yet).
    expect(view.queryByLabelText("Recording — release to stop")).toBeTruthy();
    expect(mockRecorder.stop).not.toHaveBeenCalled();

    // Fire the back press the OS would dispatch.
    let result = false;
    await act(async () => {
      result = currentBackHandler()();
    });

    // The handler must own the event so the system doesn't also pop
    // the modal — otherwise the recorder would be stopped AND the
    // user would be navigated away in the same gesture.
    expect(result).toBe(true);

    // The recorder must be stopped so the audio session releases the
    // mic immediately instead of waiting for GC.
    expect(mockRecorder.stop).toHaveBeenCalledTimes(1);

    // The screen should be back at idle, with the hold-to-record
    // button rendered again and the release button gone.
    expect(view.queryByLabelText("Hold to record a voice memory")).toBeTruthy();
    expect(view.queryByLabelText("Recording — release to stop")).toBeNull();

    // Must NOT have navigated — back was swallowed.
    expect(mockBack).not.toHaveBeenCalled();
  });

  test("back during drafting opens the discard alert and does not navigate", async () => {
    const view = render(<VoiceCaptureScreen />);

    // Drive idle → recording → processing → drafting via the press
    // gesture, mirroring the helper used in voice-capture.test.tsx.
    await act(async () => {
      fireEvent(
        view.getByLabelText("Hold to record a voice memory"),
        "pressIn",
      );
    });
    await act(async () => {
      fireEvent(
        view.getByLabelText("Recording — release to stop"),
        "pressOut",
      );
    });

    // Pre-condition: the draft form is on screen and no discard
    // alert has fired yet from any other code path.
    alertSpy.mockClear();
    mockBack.mockClear();

    // Fire back from the drafting phase.
    let result = false;
    await act(async () => {
      result = currentBackHandler()();
    });

    // Must swallow the event so the modal doesn't pop while the
    // discard prompt is on screen.
    expect(result).toBe(true);

    // The discard confirmation alert must have fired — if it didn't,
    // the user's draft would be silently dropped on the next pop.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      "Discard this memory?",
      expect.any(String),
      expect.any(Array),
    );

    // The handler itself must NOT navigate — only the user tapping
    // the "Discard" button inside the alert is allowed to do that.
    expect(mockBack).not.toHaveBeenCalled();
  });

  test("back during idle / processing / saving falls through (returns false)", async () => {
    // ---- idle: nothing has happened yet, back must fall through.
    const view = render(<VoiceCaptureScreen />);
    expect(currentBackHandler()()).toBe(false);

    // ---- processing: stall transcription so the screen sits in the
    // processing phase. The handler must still fall through — we don't
    // want back-during-processing to abandon a memory the user already
    // committed to recording.
    let resolveTranscribe: ((value: string) => void) | undefined;
    mockTranscribe.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveTranscribe = resolve;
        }),
    );

    await act(async () => {
      fireEvent(
        view.getByLabelText("Hold to record a voice memory"),
        "pressIn",
      );
    });
    await act(async () => {
      fireEvent(
        view.getByLabelText("Recording — release to stop"),
        "pressOut",
      );
    });

    // Sanity: we're parked in processing (no draft form yet), and the
    // handler currently registered closes over phase === "processing".
    expect(view.queryByLabelText("Recording — release to stop")).toBeNull();
    expect(view.queryByLabelText("Hold to record a voice memory")).toBeNull();
    expect(currentBackHandler()()).toBe(false);

    // Let processing complete so we can drive into the saving phase.
    await act(async () => {
      resolveTranscribe?.("Had coffee with Alex this morning.");
    });

    // ---- saving: stall the addMemory promise so the screen stays in
    // the brief "saving" window. Back must still fall through.
    let resolveAddMemory: ((value: { syncedToCloud: boolean }) => void)
      | undefined;
    mockAddMemory.mockImplementationOnce(
      () =>
        new Promise<{ syncedToCloud: boolean }>((resolve) => {
          resolveAddMemory = resolve;
        }),
    );

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    expect(currentBackHandler()()).toBe(false);

    // Resolve the pending save so the test exits cleanly.
    await act(async () => {
      resolveAddMemory?.({ syncedToCloud: true });
    });
  });
});
