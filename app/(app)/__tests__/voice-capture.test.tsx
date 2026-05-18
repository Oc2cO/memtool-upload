/**
 * Screen-level coverage for the voice-capture screen's iOS Live
 * Activity lifecycle (Task #229; complements the wrapper unit tests
 * shipped with Task #200).
 *
 * `lib/voiceProcessingLiveActivity.test.ts` already covers the
 * wrapper in isolation, but the screen at `app/(app)/voice-capture.tsx`
 * is the actual orchestrator — it must:
 *
 *   1. start the activity the moment the user releases the mic
 *      (phase → "processing"),
 *   2. mark the activity "ready" once extraction finishes,
 *   3. end the activity on every exit path: save, discard,
 *      re-record, AND screen unmount (defensive cleanup so an
 *      activity can never outlive its session).
 *
 * Without this test, a future edit to the phase machine could
 * silently drop a `start` or leave a stale "Memory ready" pill on
 * the lock screen — neither would be caught by the wrapper tests
 * because the wrapper has no idea who's calling it.
 *
 * The screen pulls in expo-router, safe-area, expo-audio, several
 * contexts, and the voice pipeline. We mock the entire surface — the
 * same mocking style `capture.test.tsx` and `log-call.test.tsx`
 * already use — so the screen can boot in jest without a custom dev
 * client or a real microphone.
 */
import React from "react";
import { Alert, Linking } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

import {
  CaptureBlockedError,
  FREE_DAILY_CAPTURE_LIMIT,
} from "@/lib/subscription";

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockAddMemory = jest.fn();

const mockStart = jest.fn();
const mockMarkReady = jest.fn();
const mockEnd = jest.fn();

const mockTranscribe = jest.fn();
const mockExtract = jest.fn();
const mockStartStreaming = jest.fn();

// Mutable knobs the screen reads through the mocked hooks below.
// Tests flip these in `beforeEach` (or inline before `render`) to
// drive specific branches without re-mocking the modules.
let mockTodayMemories: unknown[] = [];
let mockIsPro = false;
let mockSttAvailable = true;
// Task #264: per-test override for the persisted STT unavailability
// reason. Defaults to null so existing tests hit the generic
// "default" branch of `sttUnavailableMessage`. Tests targeting the
// permission-denied branch flip this to "authorization_denied" to
// exercise the Open Settings UI.
let mockSttUnavailableReason:
  | "authorization_denied"
  | "on_device_unsupported"
  | "ios_too_old"
  | "framework_not_present"
  | "module_not_linked"
  | "non_ios_platform"
  | "recognizer_unavailable"
  | "unknown"
  | null = null;
// Task #265: streaming off by default so existing tests exercise the
// non-streaming (file-based transcription) code path unchanged.
let mockStreamingAvailable = false;
// Task #266: per-test override for the engine name surfaced in the
// drafting-view "Transcribed on-device · …" badge. Defaults to null
// so the existing Live-Activity / state-machine suites don't depend
// on the badge text. The badge-focused suite below flips this to a
// real label to assert the JSX actually renders.
let mockSttEngineName: string | null = null;

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

// Task #323 added a `useAuth()` call to voice-capture for per-user
// draft keying. These tests don't exercise that path, but the screen
// still requires an AuthProvider context — mock a stable signed-in
// user so the hook resolves without an "AuthProvider" throw.
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

// Render the upsell card as a recognizable text node. Voice capture should
// not mount it for the old daily-cap path, so tests can assert absence.
jest.mock("@/components/ProUpsellCard", () => {
  const ReactActual = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  return {
    ProUpsellCard: ({ title }: { title: string }) =>
      ReactActual.createElement(RN.Text, { testID: "pro-upsell-card" }, title),
  };
});

// The wrapper module under observation. Keeping it as bare jest.fn()
// indirections (instead of jest.mock factories that return the fns
// directly) lets each test reset the mocks via mockReset() without
// re-mocking the module.
jest.mock("@/lib/voiceProcessingLiveActivity", () => ({
  startProcessingActivity: (...args: unknown[]) => mockStart(...args),
  markProcessingActivityReady: (...args: unknown[]) => mockMarkReady(...args),
  endProcessingActivity: (...args: unknown[]) => mockEnd(...args),
  VOICE_CAPTURE_DEEP_LINK: "memtool:///voice-capture",
}));

// Mock the voice pipeline so the screen can drive through processing
// without a real WhisperKit / Foundation Models module. STT must be
// reported available, otherwise the screen short-circuits to an
// "unsupported" alert before ever entering the processing phase.
//
// Task #265: `isStreamingTranscriptionAvailable` reads from the
// mutable `mockStreamingAvailable` knob (defaults false) so tests
// can enable streaming by flipping that variable without re-mocking
// the module. `startStreamingTranscription` delegates to the top-
// level `mockStartStreaming` jest.fn() so per-test overrides work
// via `.mockImplementationOnce()`.
jest.mock("@/lib/voiceCapture", () => ({
  transcribeRecording: (...args: unknown[]) => mockTranscribe(...args),
  extractFromTranscript: (...args: unknown[]) => mockExtract(...args),
  isSpeechToTextAvailable: () => mockSttAvailable,
  isFoundationModelsAvailable: () => false,
  isStreamingTranscriptionAvailable: () => mockStreamingAvailable,
  startStreamingTranscription: (...args: unknown[]) =>
    mockStartStreaming(...args),
  // Task #199: the screen reads this to render the
  // "Transcribed on-device · {engineName}" badge in the drafting
  // view. Reads from the mutable `mockSttEngineName` knob so the
  // badge-focused suite (Task #266) can flip it to a real label
  // without re-mocking the module; defaults to null so the other
  // suites remain untouched.
  getSpeechToTextEngineName: () => mockSttEngineName,
  // Task #264: the screen reads this to pick a specific one-line
  // explanation for each STT unavailability case. Reads from the
  // mutable `mockSttUnavailableReason` knob so individual tests can
  // drive the permission-denied / dev-debug-card branches without
  // re-mocking the module.
  getSpeechToTextUnavailableReason: () => mockSttUnavailableReason,
}));

// Single mutable recorder instance — useAudioRecorder is a hook so
// we return the same object on every render. The screen reads
// `recorder.uri` after `recorder.stop()` resolves, so the URI must
// be set before the press flow.
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

// Reset streaming mocks before every test regardless of which describe
// block is running. This keeps the existing describe blocks' beforeEach
// blocks unchanged while ensuring the Task #265 knobs start clean.
beforeEach(() => {
  mockStreamingAvailable = false;
  mockStartStreaming.mockReset();
  mockStartStreaming.mockResolvedValue(null);
  // Task #266: reset the engine-name knob so each test opts in to a
  // non-null value explicitly. The badge-focused suite below sets it
  // in its own beforeEach.
  mockSttEngineName = null;
});

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
 * Drive the screen from idle → drafting by simulating a hold-to-
 * record press. The idle phase renders one Pressable
 * (`onPressIn → startRecording`) and the recording phase renders a
 * different Pressable (`onPressOut → stopAndProcess`) — so press-in
 * targets the idle button and press-out targets the recording
 * button after the first re-render. After this resolves,
 * `mockStart` and `mockMarkReady` have fired and the draft form is
 * on screen, ready for save / discard / re-record / unmount.
 */
async function recordToDrafting(view: ReturnType<typeof render>) {
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
}

describe("VoiceCaptureScreen — Live Activity lifecycle (Task #229)", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    // Fake timers so the recording phase's polling setInterval and
    // the post-save router.back() setTimeout never fire mid-test.
    // Microtasks (await) are unaffected.
    jest.useFakeTimers();

    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddMemory.mockReset();

    mockStart.mockReset();
    mockMarkReady.mockReset();
    mockEnd.mockReset();

    mockTranscribe.mockReset();
    mockExtract.mockReset();

    mockRecorder.prepareToRecordAsync.mockClear();
    mockRecorder.record.mockClear();
    mockRecorder.stop.mockClear();
    mockRecorder.uri = "file:///mock-recording.m4a";

    // Reset the mutable hook knobs to the defaults the Live Activity
    // suite assumes (under the cap, free tier, STT enabled).
    mockTodayMemories = [];
    mockIsPro = false;
    mockSttAvailable = true;
    mockSttUnavailableReason = null;

    mockStart.mockResolvedValue(HANDLE);
    mockMarkReady.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockTranscribe.mockResolvedValue("Had coffee with Alex this morning.");
    mockExtract.mockResolvedValue({ ...SAMPLE_DRAFT });

    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    jest.useRealTimers();
  });

  test("start fires when entering processing AND mark-ready fires after extraction", async () => {
    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    // 1. The lock-screen pill went up the moment the user released
    //    the button — the in-app banner is no longer the only
    //    surface narrating the wait.
    expect(mockStart).toHaveBeenCalledTimes(1);

    // 2. Extraction finished, so the pill flipped to "Memory ready —
    //    tap to review". Crucially, the mark-ready call must carry
    //    the SAME handle returned by start; passing null would no-op
    //    and leave the pill stuck on "Processing memory…".
    expect(mockMarkReady).toHaveBeenCalledTimes(1);
    expect(mockMarkReady).toHaveBeenCalledWith(HANDLE);

    // 3. The activity stays up until the user resolves the draft.
    //    End must NOT have fired yet — the next four tests cover
    //    each exit path individually.
    expect(mockEnd).not.toHaveBeenCalled();
  });

  test("end fires on save", async () => {
    mockAddMemory.mockResolvedValueOnce({ syncedToCloud: true });

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    // The save committed, so the pill must come down in lockstep
    // with the in-app "Saved" toast — otherwise the lock screen
    // would keep advertising a draft that no longer exists.
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledWith(HANDLE);
  });

  test("end fires on discard", async () => {
    // The Discard button pops a confirmation alert; auto-confirm by
    // invoking the destructive button's onPress so the test drives
    // the same code path a real user would.
    alertSpy.mockImplementation(
      (
        _title: string,
        _message?: string,
        buttons?: ReadonlyArray<{
          text?: string;
          onPress?: () => void;
        }>,
      ) => {
        const discard = buttons?.find((b) => b.text === "Discard");
        discard?.onPress?.();
      },
    );

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    await act(async () => {
      fireEvent.press(view.getByText("Discard"));
    });

    // Discarded → tear the pill down so the lock screen doesn't
    // keep promising a memory the user just threw away.
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledWith(HANDLE);
    expect(mockBack).toHaveBeenCalled();
  });

  test("end fires on re-record", async () => {
    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    await act(async () => {
      fireEvent.press(view.getByText("Re-record"));
    });

    // Re-record starts a fresh session — the old activity must be
    // dismissed so the next stopAndProcess can spin up a brand-new
    // one without two activities overlapping on the lock screen.
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledWith(HANDLE);
  });

  test("end fires when stop() leaves recorder.uri null (recording lost)", async () => {
    // Drop the URI before the press flow so the screen takes the
    // "Recording lost" branch in stopAndProcess. The handle is
    // already parked from the awaited startProcessingActivity, so
    // the screen must explicitly tear it down — otherwise the
    // user is left with a "Processing memory…" pill the failed
    // recording can never resolve.
    mockRecorder.uri = null;

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    // The user sees the calm "Recording lost" alert, not a stuck
    // processing pill.
    expect(alertSpy).toHaveBeenCalledWith(
      "Recording lost",
      expect.any(String),
    );

    // Extraction never ran, so mark-ready should never have been
    // called. If it had, that would mean the screen flipped the
    // pill to "Memory ready" for audio it doesn't actually have.
    expect(mockMarkReady).not.toHaveBeenCalled();

    // Critically: the lock-screen pill must come down with the
    // same handle the screen received from startProcessingActivity.
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledWith(HANDLE);
  });

  test("end fires when transcribeRecording throws", async () => {
    // Force the transcription stage to fail. The screen catches,
    // shows "Couldn't process that recording", and must end the
    // activity so the failure isn't masked by a stale pill.
    mockTranscribe.mockRejectedValueOnce(new Error("whisper unavailable"));

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    expect(alertSpy).toHaveBeenCalledWith(
      "Couldn't process that recording",
      expect.any(String),
    );
    // Extraction never ran (transcription threw first), so the
    // pill stayed in "Processing memory…" — meaning end is the
    // ONLY thing that can clear it.
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockMarkReady).not.toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledWith(HANDLE);
  });

  test("end fires when extractFromTranscript throws", async () => {
    // Same failure surface as the transcription branch above, but
    // one step deeper into the pipeline. Both throw paths share a
    // single catch in stopAndProcess; we cover both so a future
    // refactor that splits them can't silently drop one.
    mockExtract.mockRejectedValueOnce(new Error("foundation models down"));

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    expect(alertSpy).toHaveBeenCalledWith(
      "Couldn't process that recording",
      expect.any(String),
    );
    // Transcription succeeded, but extraction blew up before the
    // ready flip. The pill must be torn down, not left at
    // "Processing memory…".
    expect(mockMarkReady).not.toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledWith(HANDLE);
  });

  test("legacy capture-limit rejection leaves the draft in place without subscription routing", async () => {
    // Voice capture is a normal new-memory path and should respect
    // the capture limit. If a stale backend or
    // old mock still returns the legacy daily-limit error, the screen
    // should keep the draft available for retry instead of sending
    // the user to an upsell route.
    const legacyLimitError = new Error("Daily capture limit reached");
    legacyLimitError.name = "CaptureLimitReachedError";
    mockAddMemory.mockRejectedValueOnce(legacyLimitError);

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    expect(mockEnd).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalledWith("/subscription");
    expect(mockBack).not.toHaveBeenCalled();
    expect(view.getByText("Save")).toBeTruthy();

    // The save attempt still used the normal new-memory payload.
    expect(mockAddMemory).toHaveBeenCalledWith(expect.any(String), {
      tags: [],
    });
  });

  test("end fires on unmount", async () => {
    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    // Pre-condition: the draft is on screen, the handle is still
    // parked, and no exit-path end call has happened yet. If this
    // assertion fires the unmount cleanup test below would be
    // trivially satisfied by an earlier end call.
    expect(mockEnd).not.toHaveBeenCalled();

    view.unmount();

    // The defensive cleanup effect in voice-capture.tsx must dismiss
    // the activity on unmount — without it, a user who killed the
    // app mid-draft would be stuck with a "Memory ready" pill that
    // no app could clear.
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledWith(HANDLE);
  });
});

/**
 * Screen-level coverage for the five-phase state machine itself
 * (Task #201). Task #171 pinned the pure pipeline (heuristic
 * extractor + cap math) but left the screen — the daily-cap branch,
 * the STT-unavailable branch, the recording → processing → drafting
 * transition, the Save handler's payload, and the empty-transcript
 * hint — without any automated coverage. Each test below pins one
 * of those five branches so a future refactor of `useAudioRecorder`,
 * `getCaptureLimitState`, or the heuristic extractor can't silently
 * break the flow.
 *
 * The mocks reused from the Live Activity suite above (router,
 * safe-area, useColors, MemoriesContext, SubscriptionContext,
 * voiceProcessingLiveActivity, voiceCapture, expo-audio) all stay in
 * place. The mutable knobs (`mockTodayMemories`, `mockIsPro`,
 * `mockSttAvailable`) let each test below drive a different branch
 * without re-mocking the modules.
 */
describe("VoiceCaptureScreen — five-phase state machine (Task #201)", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();

    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddMemory.mockReset();

    mockStart.mockReset();
    mockMarkReady.mockReset();
    mockEnd.mockReset();

    mockTranscribe.mockReset();
    mockExtract.mockReset();

    mockRecorder.prepareToRecordAsync.mockClear();
    mockRecorder.record.mockClear();
    mockRecorder.stop.mockClear();
    mockRecorder.uri = "file:///mock-recording.m4a";

    mockTodayMemories = [];
    mockIsPro = false;
    mockSttAvailable = true;
    mockSttUnavailableReason = null;

    mockStart.mockResolvedValue(HANDLE);
    mockMarkReady.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockTranscribe.mockResolvedValue("Had coffee with Alex this morning.");
    mockExtract.mockResolvedValue({ ...SAMPLE_DRAFT });

    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    jest.useRealTimers();
  });

  test("old daily-cap state still renders the voice capture mic without an upsell", () => {
    // Core memory creation is unlimited/free by default right now.
    // Even if the mocked account has enough memories to trip the
    // old free-tier daily ceiling, voice capture must stay available
    // and must not show the Pro daily-limit card.
    mockTodayMemories = Array.from(
      { length: FREE_DAILY_CAPTURE_LIMIT },
      (_, i) => ({ id: `m-${i}` }),
    );
    mockIsPro = false;

    const view = render(<VoiceCaptureScreen />);

    // The old daily-limit upsell is absent, and the record control
    // is still available.
    expect(view.queryByTestId("pro-upsell-card")).toBeNull();
    expect(view.queryByText("Daily capture limit reached")).toBeNull();
    expect(view.getByLabelText("Hold to record a voice memory")).toBeTruthy();
  });

  test("STT-unavailable branch: pressing the mic pops a reason-specific alert and never records", async () => {
    // Build without the native STT module — `isSpeechToTextAvailable()`
    // returns false and `getSpeechToTextUnavailableReason()` returns null
    // (the mock default), which hits the `default` branch of the
    // `sttUnavailableMessage` helper. The screen must surface a calm
    // one-line explanation instead of the generic "coming soon" placeholder
    // that gave users no actionable information (Task #264).
    mockSttAvailable = false;

    const view = render(<VoiceCaptureScreen />);

    await act(async () => {
      fireEvent(
        view.getByLabelText("Hold to record a voice memory"),
        "pressIn",
      );
    });

    // 1. The reason-specific alert fired. When reason is null the helper
    //    returns the `default` copy. We pin the title to guard against
    //    a future regression that drops the alert entirely.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe("Voice transcription unavailable");
    expect(body).toMatch(/voice transcription isn't available/i);

    // 2. No "Open capture" routing — for the generic / non-permission
    //    case the only button is "OK". Verify the router was untouched.
    const hasOpenCapture = (
      buttons as ReadonlyArray<{ text?: string }>
    ).some((b) => b.text === "Open capture");
    expect(hasOpenCapture).toBe(false);
    expect(mockReplace).not.toHaveBeenCalled();

    // 3. Critically, the recorder was never armed. If `record()`
    //    had been called the audio session would still be open —
    //    the whole point of the early-return is that the mic stays
    //    untouched on unsupported builds.
    expect(mockRecorder.prepareToRecordAsync).not.toHaveBeenCalled();
    expect(mockRecorder.record).not.toHaveBeenCalled();
  });

  test("module_not_linked explains the installed build is missing voice transcription", async () => {
    mockSttAvailable = false;
    mockSttUnavailableReason = "module_not_linked";

    const view = render(<VoiceCaptureScreen />);

    const message =
      "Voice transcription is not available in this installed build. Install a build that includes voice transcription.";
    expect(view.queryByText(message)).toBeTruthy();

    await act(async () => {
      fireEvent(
        view.getByLabelText("Hold to record a voice memory"),
        "pressIn",
      );
    });

    expect(alertSpy).toHaveBeenCalledWith(
      "Voice transcription unavailable",
      message,
      [{ text: "OK", style: "cancel" }],
    );
    expect(mockRecorder.prepareToRecordAsync).not.toHaveBeenCalled();
  });

  test("authorization_denied: idle card shows Open Settings and pressing the mic offers an Open Settings alert action (Task #264)", async () => {
    // The OS-level mic / speech-recognition prompt was denied. The
    // user can't fix this from inside the app — they have to flip
    // the switch in iOS Settings — so the screen MUST surface a
    // one-tap deep link to that screen instead of dead-ending them
    // on a silent mic. Without this assertion a future refactor that
    // dropped the special-case for `authorization_denied` (e.g.
    // collapsed every reason into the same "OK"-only alert) would
    // ship and leave permission-denied users stranded.
    mockSttAvailable = false;
    mockSttUnavailableReason = "authorization_denied";

    // Stub Linking.openSettings so we can assert it fired without
    // actually trying to leave the test environment.
    const openSettingsSpy = jest
      .spyOn(Linking, "openSettings")
      .mockImplementation(() => Promise.resolve());

    try {
      const view = render(<VoiceCaptureScreen />);

      // 1. Idle-phase card surfaces the permission-specific copy and
      //    its own Open Settings button (the "lock" branch of the
      //    unavailable card).
      expect(
        view.queryByText(/speech recognition permission was denied/i),
      ).toBeTruthy();
      const cardOpenSettings = view.getByText("Open Settings");
      fireEvent.press(cardOpenSettings);
      expect(openSettingsSpy).toHaveBeenCalledTimes(1);
      openSettingsSpy.mockClear();

      // 2. Pressing the mic still pops the alert (the early-return
      //    path), and the alert's button list MUST contain an
      //    "Open Settings" action that wires through to
      //    Linking.openSettings — that's the one-tap escape hatch.
      await act(async () => {
        fireEvent(
          view.getByLabelText("Hold to record a voice memory"),
          "pressIn",
        );
      });

      expect(alertSpy).toHaveBeenCalledTimes(1);
      const [title, body, buttons] = alertSpy.mock.calls[0];
      expect(title).toBe("Speech recognition permission denied");
      expect(body).toMatch(/speech recognition permission was denied/i);

      const openSettings = (
        buttons as ReadonlyArray<{ text?: string; onPress?: () => void }>
      ).find((b) => b.text === "Open Settings");
      expect(openSettings).toBeTruthy();
      openSettings?.onPress?.();
      expect(openSettingsSpy).toHaveBeenCalledTimes(1);

      // 3. The mic was never armed — the early-return is the whole
      //    point of the auth-denied branch.
      expect(mockRecorder.prepareToRecordAsync).not.toHaveBeenCalled();
      expect(mockRecorder.record).not.toHaveBeenCalled();
    } finally {
      openSettingsSpy.mockRestore();
    }
  });

  test("dev debug card renders the raw STT unavailability reason when one is set (Task #264)", async () => {
    // The dev-only debug card is the developer's primary signal that
    // the on-device STT module reported a specific failure code at
    // boot. Without this card a regression that silently dropped the
    // reason on the floor (e.g. failing to call
    // setSpeechToTextUnavailableReason from registerOnDeviceSpeechToText)
    // would only show up as the generic "default" copy in the user
    // card — easy to miss in dev. Pinning the raw code visibility
    // here means a missing reason fails this test loudly.
    mockSttAvailable = false;
    mockSttUnavailableReason = "framework_not_present";

    const view = render(<VoiceCaptureScreen />);

    // The label is locked because it's the only signal the
    // developer gets about the raw code in dev builds.
    expect(view.queryByText(/DEV · STT reason/i)).toBeTruthy();
    expect(view.queryByText("framework_not_present")).toBeTruthy();
  });

  test("recording → processing → drafting: stubbed transcript lands in the editable form", async () => {
    // The pure pipeline tests in voiceMemoryPipeline.test.ts /
    // voiceCapture.test.ts cover the extractor in isolation. This
    // test pins the screen-level wiring: the transcript must reach
    // `extractFromTranscript`, and the resulting draft fields must
    // populate the on-screen TextInputs. Without this assertion a
    // future state-machine refactor could drop a phase transition
    // or wire the wrong field into the form.
    mockTranscribe.mockResolvedValue("Had coffee with Alex this morning.");
    mockExtract.mockResolvedValue({
      title: "Coffee with Alex",
      body: "Had coffee with Alex this morning.",
      tags: ["social"],
      people: ["Alex"],
      tone: "happy",
      isEmpty: false,
    });

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    // The transcript flowed through to the extractor unchanged —
    // pinning this guards against an accidental .trim() / locale
    // normalization that would silently eat punctuation.
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(mockExtract).toHaveBeenCalledTimes(1);
    expect(mockExtract).toHaveBeenCalledWith(
      "Had coffee with Alex this morning.",
    );

    // The draft form rendered with the extracted values. Both the
    // title input and the body input must be populated — the body
    // is the one the Save handler trims and persists, so a missing
    // body would block the Save button below.
    expect(view.getByDisplayValue("Coffee with Alex")).toBeTruthy();
    expect(
      view.getByDisplayValue("Had coffee with Alex this morning."),
    ).toBeTruthy();

    // The Re-record / Discard / Save controls are now on screen —
    // the next test exercises Save, but pinning their presence here
    // guarantees the drafting phase actually rendered (not a stuck
    // "Processing memory…" banner).
    expect(view.getByText("Re-record")).toBeTruthy();
    expect(view.getByText("Discard")).toBeTruthy();
    expect(view.getByText("Save")).toBeTruthy();
  });

  test("Save calls addMemory with the user's edited body and tag selection", async () => {
    // The extractor seeds the form with one suggested tag ("social")
    // and the original body. The user then tweaks the body and
    // toggles tags — Save must persist what's currently in the form,
    // not the original draft. This is the assertion that guards
    // against a future refactor that accidentally re-reads `draft.*`
    // instead of the `edit*` state.
    mockExtract.mockResolvedValue({
      title: "Coffee with Alex",
      body: "Had coffee with Alex this morning.",
      tags: ["social"],
      people: ["Alex"],
      tone: "happy",
      isEmpty: false,
    });
    mockAddMemory.mockResolvedValueOnce({ syncedToCloud: true });

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    // Edit the body — the Save handler trims and uses this value.
    const bodyInput = view.getByDisplayValue(
      "Had coffee with Alex this morning.",
    );
    fireEvent.changeText(
      bodyInput,
      "Had coffee with Alex — he's launching next week.",
    );

    // Toggle tags: drop the suggested "#social" and add "#work" +
    // "#idea". Tapping a chip flips its membership in `editTags`.
    fireEvent.press(view.getByText("#social"));
    fireEvent.press(view.getByText("#work"));
    fireEvent.press(view.getByText("#idea"));

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    // The handler trims the body, prefixes the title (because the
    // body doesn't start with it), and forwards the user's tag
    // selection. Both arguments matter: a wrong content string
    // would lose the user's edits, and a wrong tags array would
    // mean the chips were decorative.
    expect(mockAddMemory).toHaveBeenCalledTimes(1);
    const [content, options] = mockAddMemory.mock.calls[0];
    expect(content).toBe(
      "Coffee with Alex\n\nHad coffee with Alex — he's launching next week.",
    );
    expect(options).toEqual({
      tags: ["work", "idea"],
    });
  });

  test("empty-transcript hint surfaces in the drafting phase", async () => {
    // The extractor flags an unintelligible recording with
    // `isEmpty: true` instead of throwing — the screen must keep
    // the form open (so the user can still type) AND surface a
    // calm hint explaining what happened. Without the hint a
    // user with a bad mic would just see an empty form and have
    // no idea why the transcript came back blank.
    mockTranscribe.mockResolvedValue("");
    mockExtract.mockResolvedValue({
      title: "",
      body: "",
      tags: [],
      people: [],
      tone: "neutral",
      isEmpty: true,
    });

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    // The hint copy is locked because it's the only signal the
    // user gets that the recording failed silently — drift here
    // would turn the screen into a confusing dead-end.
    expect(
      view.queryByText(
        /didn't catch much from that recording/i,
      ),
    ).toBeTruthy();

    // The form is still on screen (Re-record + the body input
    // both render), so the user can either retype or try again
    // without leaving the screen.
    expect(view.getByText("Re-record")).toBeTruthy();
    expect(view.getByPlaceholderText(/Edit the cleaned transcript/i)).toBeTruthy();
  });
});

/**
 * Screen-level coverage for the voice-capture cooldown branch
 * (Task #259). `capture.test.tsx` already pins the same contract for
 * the typed Capture screen: when `addMemory` rejects with a
 * `CaptureBlockedError`, the user sees the calm "capture temporarily
 * unavailable" alert and is NOT bounced to `/subscription` — a
 * server-blocked account has no Pro plan to buy out of, so pushing
 * them at the upsell screen would feel like an abuse trap.
 *
 * The voice-capture screen runs the exact same catch ladder in
 * `handleSave` (`voice-capture.tsx` ~line 457), but had no equivalent
 * test. Without this assertion a future refactor of `handleSave`
 * could fold the `CaptureBlockedError` branch into the
 * `CaptureLimitReachedError` branch — silently routing every blocked
 * voice-memo user into `/subscription` — and the existing test suite
 * wouldn't catch it.
 */
describe("VoiceCaptureScreen — cooldown branch (Task #259)", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();

    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddMemory.mockReset();

    mockStart.mockReset();
    mockMarkReady.mockReset();
    mockEnd.mockReset();

    mockTranscribe.mockReset();
    mockExtract.mockReset();

    mockRecorder.prepareToRecordAsync.mockClear();
    mockRecorder.record.mockClear();
    mockRecorder.stop.mockClear();
    mockRecorder.uri = "file:///mock-recording.m4a";

    mockTodayMemories = [];
    mockIsPro = false;
    mockSttAvailable = true;
    mockSttUnavailableReason = null;

    mockStart.mockResolvedValue(HANDLE);
    mockMarkReady.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockTranscribe.mockResolvedValue("Had coffee with Alex this morning.");
    mockExtract.mockResolvedValue({ ...SAMPLE_DRAFT });

    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    jest.useRealTimers();
  });

  test("addMemory throws CaptureBlockedError → cooldown alert fires AND no /subscription redirect", async () => {
    // Use mockImplementationOnce instead of mockRejectedValueOnce so
    // the rejection is created lazily inside the handler's await,
    // not at mock-setup time. The eager form leaves jest's
    // unhandled-rejection watcher briefly seeing an orphan rejection
    // which then deadlocks the act() wrapper — same workaround
    // capture.test.tsx uses for the typed-screen equivalent.
    mockAddMemory.mockImplementationOnce(() =>
      Promise.reject(new CaptureBlockedError()),
    );

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    // 1. The cooldown alert was popped, with the calm copy that
    //    calls out the auto-clear at UTC midnight. Locking both the
    //    title and the message body protects against either string
    //    drifting independently and accidentally turning into a
    //    generic error.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, body] = alertSpy.mock.calls[0];
    expect(title).toBe("Capture temporarily unavailable");
    expect(body).toMatch(/paused new memories/i);
    expect(body).toMatch(/lift automatically tomorrow/i);

    // 2. Critically, the user was NOT routed to the upsell. This is
    //    the whole reason `CaptureBlockedError` exists as a separate
    //    type from `CaptureLimitReachedError` — a blocked account has
    //    no Pro plan to buy out of, and pushing them at /subscription
    //    would feel like an upsell trap.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });
});

/**
 * Screen-level coverage for the live streaming caption feature
 * (Task #265).
 *
 * These tests enable streaming (`mockStreamingAvailable = true`) so
 * they exercise the caption code path that the other describe blocks
 * intentionally skip. Two behaviors are pinned:
 *
 *   1. Partial caption renders during recording once the streaming
 *      recognizer fires its first partial result.
 *   2. When the streaming session's `stop()` returns a non-empty
 *      final transcript, the screen prefers it over the file-based
 *      `transcribeRecording` path — the file-based call must NOT fire.
 *
 * The streaming session is stubbed via `mockStartStreaming` (a
 * module-level jest.fn() that the `@/lib/voiceCapture` mock
 * delegates to). Each test supplies its own `mockImplementationOnce`
 * so the session's `stop()` and `onPartial` behavior can be
 * controlled independently.
 *
 * API contract note: Task #265's brief mentions `onFinal` as a
 * callback, but the implementation uses `session.stop()` returning
 * a Promise<string | null> instead. This is intentional:
 *   - The caller controls WHEN to finalize (on button release), so a
 *     push `onFinal` callback would require extra coordination to
 *     suppress after stop has been requested.
 *   - `stop()` returning final text keeps the calling code sequential
 *     and avoids a callback-vs-promise hybrid API.
 * The tests below are written against the `stop()`-returns-final
 * contract, which is the canonical surface.
 */
describe("VoiceCaptureScreen — streaming caption UI (Task #265)", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();

    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddMemory.mockReset();

    mockStart.mockReset();
    mockMarkReady.mockReset();
    mockEnd.mockReset();

    mockTranscribe.mockReset();
    mockExtract.mockReset();

    mockRecorder.prepareToRecordAsync.mockClear();
    mockRecorder.record.mockClear();
    mockRecorder.stop.mockClear();
    mockRecorder.uri = "file:///mock-recording.m4a";

    mockTodayMemories = [];
    mockIsPro = false;
    mockSttAvailable = true;
    mockSttUnavailableReason = null;

    mockStart.mockResolvedValue(HANDLE);
    mockMarkReady.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockTranscribe.mockResolvedValue("file transcript");
    mockExtract.mockResolvedValue({ ...SAMPLE_DRAFT });

    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    jest.useRealTimers();
  });

  test("partial caption renders mid-recording and streaming final is preferred over file transcription", async () => {
    // Capture the `onPartial` callback so the test can fire
    // synthetic partial events to simulate the recognizer.
    let capturedOnPartial: ((text: string) => void) | null = null;
    const mockStop = jest.fn(async () => "streaming final transcript");

    mockStreamingAvailable = true;
    mockStartStreaming.mockImplementationOnce(
      ({ onPartial }: { onPartial: (t: string) => void }) => {
        capturedOnPartial = onPartial;
        return Promise.resolve({ stop: mockStop });
      },
    );

    const view = render(<VoiceCaptureScreen />);

    // Start recording — the streaming session is created inside the
    // fire-and-forget .then() which flushes within the act block.
    await act(async () => {
      fireEvent(
        view.getByLabelText("Hold to record a voice memory"),
        "pressIn",
      );
    });

    // Before any partial arrives the caption should be absent.
    expect(view.queryByText("had coffee…")).toBeNull();

    // Fire a partial result from the stubbed recognizer.
    await act(async () => {
      capturedOnPartial?.("had coffee…");
    });

    // The caption text must now be on screen so the user gets
    // rolling feedback while they're still speaking.
    expect(view.queryByText("had coffee…")).toBeTruthy();

    // Release the button — stopAndProcess calls session.stop() which
    // returns the streaming final transcript.
    await act(async () => {
      fireEvent(
        view.getByLabelText("Recording — release to stop"),
        "pressOut",
      );
    });

    expect(mockStop).toHaveBeenCalledTimes(1);

    // The streaming final was non-empty, so extractFromTranscript
    // must receive it — NOT the file transcript from transcribeRecording.
    expect(mockExtract).toHaveBeenCalledWith("streaming final transcript");
    // File-based transcription must be skipped entirely.
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  test("falls back to file transcription when streaming stop() returns null", async () => {
    // The recognizer produced no output (user didn't speak, or the
    // recognition request timed out on the native side). The screen
    // must fall back to the file-based path so the recording isn't
    // silently discarded.
    const mockStop = jest.fn(async (): Promise<string | null> => null);

    mockStreamingAvailable = true;
    mockStartStreaming.mockImplementationOnce(() =>
      Promise.resolve({ stop: mockStop }),
    );

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    expect(mockStop).toHaveBeenCalledTimes(1);
    // Streaming final was null → file-based transcription must fire.
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(mockTranscribe).toHaveBeenCalledWith("file:///mock-recording.m4a");
  });
});

/**
 * Drafting-view "Transcribed on-device · {engine}" badge coverage
 * (Task #266). Task #199 added the badge so users can confirm which
 * on-device engine produced their transcript, but the existing
 * suites above all mock `getSpeechToTextEngineName` to null (to keep
 * their assertions narrowly focused on the Live Activity / phase
 * machine / streaming pipeline). That left the badge JSX itself
 * untested — a future refactor could silently delete it.
 *
 * These two tests close that gap by flipping the mutable
 * `mockSttEngineName` knob to a real label and asserting:
 *   1. the badge text appears in the drafting view, and
 *   2. the badge is hidden when the heuristic returned an empty
 *      draft (no transcript to attribute).
 */
describe("VoiceCaptureScreen — drafting-view engine badge (Task #266)", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();

    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddMemory.mockReset();

    mockStart.mockReset();
    mockMarkReady.mockReset();
    mockEnd.mockReset();

    mockTranscribe.mockReset();
    mockExtract.mockReset();

    mockRecorder.prepareToRecordAsync.mockClear();
    mockRecorder.record.mockClear();
    mockRecorder.stop.mockClear();
    mockRecorder.uri = "file:///mock-recording.m4a";

    mockTodayMemories = [];
    mockIsPro = false;
    mockSttAvailable = true;
    mockSttUnavailableReason = null;
    // The whole point of this suite — surface a real engine label so
    // the badge JSX (gated on `sttEngineName && !draft.isEmpty`) can
    // actually render.
    mockSttEngineName = "Apple Speech (on-device)";

    mockStart.mockResolvedValue(HANDLE);
    mockMarkReady.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockTranscribe.mockResolvedValue("Had coffee with Alex this morning.");
    mockExtract.mockResolvedValue({ ...SAMPLE_DRAFT });

    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    jest.useRealTimers();
  });

  test("renders the 'Transcribed on-device · {engine}' badge in the drafting view", async () => {
    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    // The badge JSX is gated on `sttEngineName && !draft.isEmpty`.
    // A non-empty draft + a real engine label must produce the
    // attribution pill — if a future refactor drops the JSX or the
    // engine-name read, this assertion fails.
    expect(
      view.queryByText("Transcribed on-device · Apple Speech (on-device)"),
    ).toBeTruthy();
  });

  test("hides the badge when the heuristic produced an empty draft", async () => {
    // Flip the extractor to an isEmpty draft — the screen renders
    // the empty-hint card instead of an attribution pill because
    // there's no transcript to attribute. Without this branch the
    // badge would falsely claim "Transcribed on-device" for an
    // empty result.
    mockExtract.mockResolvedValueOnce({ ...SAMPLE_DRAFT, isEmpty: true });

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    expect(
      view.queryByText("Transcribed on-device · Apple Speech (on-device)"),
    ).toBeNull();
  });
});
