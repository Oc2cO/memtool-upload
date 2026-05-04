/**
 * Screen-level wiring tests for the iOS Live Activity lock-screen
 * pill (Task #248).
 *
 * `lib/voiceProcessingLiveActivity.test.ts` covers the wrapper in
 * isolation, and the existing `voice-capture.test.tsx` pins the
 * screen-level lifecycle by mocking the wrapper directly. This file
 * closes the remaining gap: it exercises the full chain — the screen
 * calling the **real** wrapper, which calls the underlying native
 * module — by swapping in a fake native module via the
 * `__setNativeModuleForTests` escape hatch.
 *
 * The point is to catch regressions where:
 *   - a future refactor renames a wrapper export (start/markReady/end)
 *     and the screen silently no-ops because the import is `undefined`,
 *   - the wrapper's start/update/end ordering contract is violated by
 *     the screen (e.g. the screen forgets to await `startActivity`
 *     before calling `markProcessingActivityReady`, leaving a
 *     dangling activity), or
 *   - a new exit path is added to the screen that forgets to dismiss
 *     the activity, leaving a stale "Memory ready" pill on the lock
 *     screen.
 *
 * The five scenarios pinned below mirror Task #248's "done looks like":
 *   (a) normal save        — start → update → end
 *   (b) discard            — start → update → end
 *   (c) re-record          — start → update → end
 *   (d) screen unmount     — start → end (no update; extraction never
 *                            completes mid-processing)
 *   (e) extraction error   — start → end (no update; the catch path
 *                            tears the pill down before flipping to
 *                            "ready")
 */
import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

import {
  __resetNativeModuleForTests,
  __setNativeModuleForTests,
} from "@/modules/voice-processing-live-activity";

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockAddMemory = jest.fn();

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

// IMPORTANT: this file does NOT mock `@/lib/voiceProcessingLiveActivity`.
// We deliberately let the real wrapper run so the test exercises the
// screen → wrapper → native-module chain end-to-end. The native side is
// swapped out via `__setNativeModuleForTests` per test below.

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
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
  AudioModule: {
    requestRecordingPermissionsAsync: jest.fn(() =>
      Promise.resolve({ granted: true, canAskAgain: true, expires: "never" }),
    ),
  },
  RecordingPresets: { HIGH_QUALITY: {} },
}));

import VoiceCaptureScreen from "../voice-capture";

const SAMPLE_DRAFT = {
  title: "Coffee with Alex",
  body: "Had coffee with Alex this morning.",
  tags: [] as string[],
  people: ["Alex"],
  tone: "happy" as const,
  isEmpty: false,
};

const ACTIVITY_ID = "wired-activity-1";

type Call =
  | { kind: "start"; deepLinkUrl: string }
  | { kind: "update"; activityId: string; phase: string }
  | { kind: "end"; activityId: string };

/**
 * Build a fake native module that records every call into the shared
 * `calls` array so each test can assert ordering. `startActivity`
 * resolves with a deterministic activity id so the subsequent
 * update/end calls can be asserted against the same id — this guards
 * against the screen passing the wrong handle (or a stale one) into
 * the wrapper's mark/end helpers.
 */
function makeFakeNativeModule(calls: Call[]) {
  return {
    getAvailability: () => ({ available: true, reason: null }),
    startActivity: jest.fn(async (args: { deepLinkUrl: string }) => {
      calls.push({ kind: "start", deepLinkUrl: args.deepLinkUrl });
      return { status: "ok" as const, activityId: ACTIVITY_ID };
    }),
    updateActivity: jest.fn(async (activityId: string, phase: string) => {
      calls.push({ kind: "update", activityId, phase });
      return { status: "ok" as const };
    }),
    endActivity: jest.fn(async (activityId: string) => {
      calls.push({ kind: "end", activityId });
      return { status: "ok" as const };
    }),
    endAllActivities: jest.fn(async () => ({
      status: "ok" as const,
      endedCount: 0,
    })),
  };
}

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

// jest-expo's first-test cold-start transform can run long enough to
// trip jest's default 5s timeout when this suite is the only one a CI
// shard picks up. Bump the per-test budget so a slow first compile
// can't masquerade as a real wiring regression.
jest.setTimeout(15000);

describe("VoiceCaptureScreen — Live Activity native wiring (Task #248)", () => {
  let alertSpy: jest.SpyInstance;
  let calls: Call[];

  beforeEach(() => {
    jest.useFakeTimers();

    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddMemory.mockReset();
    mockTranscribe.mockReset();
    mockExtract.mockReset();
    mockStartStreaming.mockReset();
    mockStartStreaming.mockResolvedValue(null);

    mockRecorder.prepareToRecordAsync.mockClear();
    mockRecorder.record.mockClear();
    mockRecorder.stop.mockClear();
    mockRecorder.uri = "file:///mock-recording.m4a";

    mockTodayMemories = [];
    mockIsPro = false;

    mockTranscribe.mockResolvedValue("Had coffee with Alex this morning.");
    mockExtract.mockResolvedValue({ ...SAMPLE_DRAFT });

    calls = [];
    __setNativeModuleForTests(makeFakeNativeModule(calls));

    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    jest.useRealTimers();
    __resetNativeModuleForTests();
  });

  test("normal save: start → update(ready) → end, all on the same activityId", async () => {
    mockAddMemory.mockResolvedValueOnce({ syncedToCloud: true });

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    expect(calls).toEqual([
      { kind: "start", deepLinkUrl: "memtool:///voice-capture" },
      { kind: "update", activityId: ACTIVITY_ID, phase: "ready" },
      { kind: "end", activityId: ACTIVITY_ID },
    ]);
  });

  test("discard: start → update(ready) → end, all on the same activityId", async () => {
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

    expect(calls).toEqual([
      { kind: "start", deepLinkUrl: "memtool:///voice-capture" },
      { kind: "update", activityId: ACTIVITY_ID, phase: "ready" },
      { kind: "end", activityId: ACTIVITY_ID },
    ]);
    expect(mockBack).toHaveBeenCalled();
  });

  test("re-record: start → update(ready) → end, all on the same activityId", async () => {
    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    await act(async () => {
      fireEvent.press(view.getByText("Re-record"));
    });

    expect(calls).toEqual([
      { kind: "start", deepLinkUrl: "memtool:///voice-capture" },
      { kind: "update", activityId: ACTIVITY_ID, phase: "ready" },
      { kind: "end", activityId: ACTIVITY_ID },
    ]);
  });

  test("unmount mid-processing: start → end (no update — extraction never finished)", async () => {
    // Hold extraction open so the screen stays in the "processing"
    // phase. The unmount cleanup effect must dismiss the in-flight
    // activity even though `markProcessingActivityReady` was never
    // reached.
    let resolveExtract: ((draft: typeof SAMPLE_DRAFT) => void) | null = null;
    mockExtract.mockImplementationOnce(
      () =>
        new Promise<typeof SAMPLE_DRAFT>((resolve) => {
          resolveExtract = resolve;
        }),
    );

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    // Sanity: the screen has started the activity but has not yet
    // flipped it to "ready" because extraction is still pending.
    expect(calls).toEqual([
      { kind: "start", deepLinkUrl: "memtool:///voice-capture" },
    ]);

    view.unmount();

    expect(calls).toEqual([
      { kind: "start", deepLinkUrl: "memtool:///voice-capture" },
      { kind: "end", activityId: ACTIVITY_ID },
    ]);

    // Resolve the still-pending extract so jest doesn't leak the
    // promise into the next test.
    await act(async () => {
      resolveExtract?.({ ...SAMPLE_DRAFT });
    });
  });

  test("60s auto-stop: timer-driven release also drives start → update(ready) → end", async () => {
    // The recording phase polls a 250ms interval and calls
    // `stopAndProcess` once elapsed >= 60s. That timer-driven path
    // is the only way the lock-screen pill goes up when the user
    // holds the mic and walks away — if the screen ever stops
    // routing the auto-stop through the same start/markReady/end
    // wiring as the manual release, the entire "phone in pocket"
    // story silently breaks. Press in, advance fake time past the
    // 60s ceiling, and assert the same ordered native calls fire.
    const view = render(<VoiceCaptureScreen />);

    await act(async () => {
      fireEvent(
        view.getByLabelText("Hold to record a voice memory"),
        "pressIn",
      );
    });

    // Advance fake time to exactly the 60s ceiling. The recording
    // phase polls every 250ms, so the 240th tick fires at t=60_000
    // with elapsed === MAX_DURATION_S and triggers `stopAndProcess`.
    // We deliberately stop at exactly 60s (not 60_250) so only one
    // tick crosses the threshold — `stopAndProcess`'s phase guard
    // captures stale React state in a useCallback closure, so a
    // second tick would call it again before the phase→processing
    // re-render runs and double-fire `start` against the fake.
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    // Drain microtasks queued by the awaited start / transcribe /
    // extract chain so the fire-and-forget `markProcessingActivityReady`
    // has landed before we snapshot `calls`.
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(calls).toEqual([
      { kind: "start", deepLinkUrl: "memtool:///voice-capture" },
      { kind: "update", activityId: ACTIVITY_ID, phase: "ready" },
    ]);
    // No exit path was taken yet — the user is sitting on the
    // draft form. End must NOT have fired, otherwise the lock
    // screen would lose the "Memory ready — tap to review" pill
    // before the user could act on it.
    expect(
      calls.some((c) => c.kind === "end"),
    ).toBe(false);
  });

  test("extraction error: start → end (no update — the catch tears it down before 'ready')", async () => {
    mockExtract.mockRejectedValueOnce(new Error("foundation models down"));

    const view = render(<VoiceCaptureScreen />);
    await recordToDrafting(view);

    expect(alertSpy).toHaveBeenCalledWith(
      "Couldn't process that recording",
      expect.any(String),
    );
    expect(calls).toEqual([
      { kind: "start", deepLinkUrl: "memtool:///voice-capture" },
      { kind: "end", activityId: ACTIVITY_ID },
    ]);
  });
});
