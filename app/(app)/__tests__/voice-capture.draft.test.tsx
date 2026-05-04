/**
 * Screen-level coverage for the Task #323 draft-persistence wiring on
 * the voice-capture screen. The lib-level helper is locked by
 * `lib/captureDraftStore.test.ts`; this file pins the *screen*
 * contract:
 *
 *   1. Editing the body / title in the drafting step persists, and a
 *      fresh mount restores the user straight back into the editable
 *      form.
 *   2. A successful save clears the persisted draft.
 *   3. Discarding from the draft form clears the persisted draft.
 *   4. Re-record clears the persisted draft (the old transcript is
 *      explicitly thrown away).
 *   5. A cooldown block (CaptureBlockedError) clears the persisted
 *      draft, mirroring the typed Capture / Log-a-Call branches.
 *   6. Hot account-switch on a mounted screen wipes the previous
 *      user's transcript / title from the form when the new user has
 *      no draft of their own (privacy: no cross-account leak).
 */
import React from "react";
import { Alert } from "react-native";
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

// Same swappable-user-id pattern capture.draft.test.tsx uses so the
// hot account-switch test can flip the signed-in user without
// re-mocking AuthContext.
let mockCurrentUserId: string | null = "alice";

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
  useAuth: () => ({
    user: mockCurrentUserId
      ? { id: mockCurrentUserId, email: `${mockCurrentUserId}@t` }
      : null,
  }),
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
  useSubscription: () => ({ status: { is_pro: mockIsPro } }),
}));

jest.mock("@/components/ProUpsellCard", () => ({ ProUpsellCard: () => null }));

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
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
  AudioModule: {
    requestRecordingPermissionsAsync: jest.fn(() =>
      Promise.resolve({ granted: true, canAskAgain: true, expires: "never" }),
    ),
  },
  RecordingPresets: { HIGH_QUALITY: {} },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";

import VoiceCaptureScreen from "../voice-capture";

const mockedStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

// Same in-memory backing store the typed Capture draft test uses so
// the load-after-write flow walks through the real
// lib/captureDraftStore.ts logic end-to-end.
function installInMemoryStorage() {
  const map = new Map<string, string>();
  mockedStorage.getItem.mockImplementation((k: string) =>
    Promise.resolve(map.has(k) ? (map.get(k) as string) : null),
  );
  mockedStorage.setItem.mockImplementation((k: string, v: string) => {
    map.set(k, v);
    return Promise.resolve();
  });
  mockedStorage.removeItem.mockImplementation((k: string) => {
    map.delete(k);
    return Promise.resolve();
  });
  return map;
}

const SAMPLE_DRAFT = {
  title: "Coffee with Alex",
  body: "Had coffee with Alex this morning.",
  tags: [] as string[],
  people: ["Alex"] as string[],
  tone: "happy" as const,
  isEmpty: false,
};

/**
 * Drive the screen from idle → drafting by simulating a hold-to-
 * record press. Mirrors the helper in voice-capture.test.tsx.
 */
async function recordToDrafting(view: ReturnType<typeof render>) {
  await act(async () => {
    fireEvent(view.getByLabelText("Hold to record a voice memory"), "pressIn");
  });
  await act(async () => {
    fireEvent(view.getByLabelText("Recording — release to stop"), "pressOut");
  });
}

describe("VoiceCaptureScreen — draft persistence (Task #323)", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mockedStorage.getItem.mockReset();
    mockedStorage.setItem.mockReset();
    mockedStorage.removeItem.mockReset();
    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddMemory.mockReset();
    mockStart.mockReset().mockResolvedValue("activity-1");
    mockMarkReady.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockTranscribe
      .mockReset()
      .mockResolvedValue("Had coffee with Alex this morning.");
    mockExtract.mockReset().mockResolvedValue({ ...SAMPLE_DRAFT });
    mockStartStreaming.mockReset().mockResolvedValue(null);
    mockRecorder.prepareToRecordAsync.mockClear();
    mockRecorder.record.mockClear();
    mockRecorder.stop.mockClear();
    mockRecorder.uri = "file:///mock-recording.m4a";
    mockTodayMemories = [];
    mockIsPro = false;
    mockCurrentUserId = "alice";
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    jest.useRealTimers();
  });

  test("editing the body persists, and a fresh mount restores the draft", async () => {
    const store = installInMemoryStorage();

    const first = render(<VoiceCaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    await recordToDrafting(first);

    fireEvent.changeText(
      first.getByPlaceholderText("Edit the cleaned transcript before saving"),
      "edited transcript",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);
    first.unmount();

    // Fresh mount: the same user comes back. The draft must restore
    // and drop the user straight back into the editable form (no
    // mic press required).
    const second = render(<VoiceCaptureScreen />);
    await act(async () => {
      // Flush the loadDraft promise + the subsequent setState batch
      // and any debounce timer the hydration arms so the test can
      // assert on the settled tree.
      await Promise.resolve();
      await Promise.resolve();
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });
    const restored = await second.findByPlaceholderText(
      "Edit the cleaned transcript before saving",
    );
    expect(restored.props.value).toBe("edited transcript");
  });

  test("a successful save clears the persisted draft", async () => {
    const store = installInMemoryStorage();
    mockAddMemory.mockResolvedValueOnce({ syncedToCloud: true, id: "m1" });

    const view = render(<VoiceCaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    await recordToDrafting(view);

    fireEvent.changeText(
      view.getByPlaceholderText("Edit the cleaned transcript before saving"),
      "save me",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
      await Promise.resolve();
    });

    expect(store.size).toBe(0);
  });

  test("discard clears the persisted draft", async () => {
    const store = installInMemoryStorage();
    alertSpy.mockImplementation(
      (
        _title: string,
        _message?: string,
        buttons?: ReadonlyArray<{ text?: string; onPress?: () => void }>,
      ) => {
        buttons?.find((b) => b.text === "Discard")?.onPress?.();
      },
    );

    const view = render(<VoiceCaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    await recordToDrafting(view);

    fireEvent.changeText(
      view.getByPlaceholderText("Edit the cleaned transcript before saving"),
      "throwaway",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);

    await act(async () => {
      fireEvent.press(view.getByText("Discard"));
      await Promise.resolve();
    });

    expect(store.size).toBe(0);
    expect(mockBack).toHaveBeenCalled();
  });

  test("re-record clears the persisted draft", async () => {
    const store = installInMemoryStorage();

    const view = render(<VoiceCaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    await recordToDrafting(view);

    fireEvent.changeText(
      view.getByPlaceholderText("Edit the cleaned transcript before saving"),
      "first take",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);

    await act(async () => {
      fireEvent.press(view.getByText("Re-record"));
      await Promise.resolve();
    });

    expect(store.size).toBe(0);
  });

  test("cooldown block (CaptureBlockedError) clears the persisted draft", async () => {
    const store = installInMemoryStorage();
    const { CaptureBlockedError } = jest.requireActual("@/lib/subscription");
    mockAddMemory.mockImplementationOnce(() =>
      Promise.reject(new CaptureBlockedError()),
    );

    const view = render(<VoiceCaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    await recordToDrafting(view);

    fireEvent.changeText(
      view.getByPlaceholderText("Edit the cleaned transcript before saving"),
      "blocked attempt",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
      await Promise.resolve();
    });

    expect(store.size).toBe(0);
  });

  test("hot account switch wipes the previous user's transcript", async () => {
    const store = installInMemoryStorage();

    // Alice produces a voice draft and edits it.
    mockCurrentUserId = "alice";
    const view = render(<VoiceCaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    await recordToDrafting(view);
    fireEvent.changeText(
      view.getByPlaceholderText("Edit the cleaned transcript before saving"),
      "alice secret transcript",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);

    // Same screen stays mounted; auth flips to Bob (no prior draft).
    // Bob must NOT see Alice's transcript: the editable field has to
    // be cleared and the screen has to drop back to idle (no draft
    // form rendered for him at all).
    mockCurrentUserId = "bob";
    await act(async () => {
      view.rerender(<VoiceCaptureScreen />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      view.queryByPlaceholderText("Edit the cleaned transcript before saving"),
    ).toBeNull();
    expect(view.queryByText("alice secret transcript")).toBeNull();
    expect(view.getByLabelText("Hold to record a voice memory")).toBeTruthy();
  });

  test("a different signed-in user does not see another user's draft", async () => {
    const store = installInMemoryStorage();

    mockCurrentUserId = "alice";
    const aliceView = render(<VoiceCaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    await recordToDrafting(aliceView);
    fireEvent.changeText(
      aliceView.getByPlaceholderText(
        "Edit the cleaned transcript before saving",
      ),
      "alice transcript",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    aliceView.unmount();
    expect(store.size).toBe(1);

    mockCurrentUserId = "bob";
    const bobView = render(<VoiceCaptureScreen />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Bob lands on idle (no draft form, no Alice text).
    expect(
      bobView.queryByPlaceholderText(
        "Edit the cleaned transcript before saving",
      ),
    ).toBeNull();
    expect(bobView.queryByText("alice transcript")).toBeNull();
    expect(bobView.getByLabelText("Hold to record a voice memory")).toBeTruthy();
  });
});
