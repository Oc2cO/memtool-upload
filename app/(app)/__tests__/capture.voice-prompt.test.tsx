/**
 * Capture-screen integration coverage for the photo + voice prompt
 * wiring: visibility, transcript-to-content, single-memory save, and
 * the remove-photo confirm/clear branches.
 */
import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockAddMemory = jest.fn();
const mockAttachPhoto = jest.fn();
const mockTranscribe = jest.fn();
const mockRequestCameraPerms = jest.fn();

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
  useAuth: () => ({ user: { id: "u1", email: "u1@test" } }),
}));

jest.mock("@/context/MemoriesContext", () => ({
  useMemories: () => ({
    addMemory: mockAddMemory,
    todayMemories: [],
    illustrateMemory: jest.fn(),
    deleteIllustration: jest.fn(),
    illustrationsUsedToday: 0,
    illustrationsLimit: 3,
    attachPhotoToMemory: mockAttachPhoto,
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({
    status: { is_pro: false },
    freeDailyCaptureLimit: 10,
  }),
}));

jest.mock("@/components/ProUpsellCard", () => ({
  ProUpsellCard: () => null,
}));
jest.mock("@/components/MemCharacter", () => ({
  MemCharacter: () => null,
}));
jest.mock("@/components/IllustrationLoader", () => ({
  IllustrationLoader: () => null,
}));
jest.mock("@/components/IllustrationPolaroid", () => ({
  IllustrationPolaroid: () => null,
}));
jest.mock("@/components/Toast", () => ({ Toast: () => null }));
jest.mock("@/components/DraftSavedCue", () => ({
  DraftSavedCue: () => null,
}));

jest.mock("@/lib/captureDraftStore", () => ({
  loadDraft: jest.fn(() => Promise.resolve(null)),
  saveDraft: jest.fn(() => Promise.resolve()),
  clearDraft: jest.fn(() => Promise.resolve()),
}));

jest.mock("@/lib/useMemoryFacets", () => ({
  useMemoryFacets: () => ({
    availability: { available: false },
    run: jest.fn(),
  }),
}));

jest.mock("@/lib/cognitiveAudio", () => ({
  useCognitiveAudio: () => undefined,
}));

jest.mock("@/lib/haptics", () => ({
  useHaptics: () => ({ play: jest.fn() }),
}));

jest.mock("@/lib/voiceCapture", () => ({
  transcribeRecording: (...args: unknown[]) => mockTranscribe(...args),
  isSpeechToTextAvailable: () => true,
  getSpeechToTextUnavailableReason: () => null,
  getSpeechToTextEngineName: () => null,
}));

const mockRecorder = {
  prepareToRecordAsync: jest.fn(() => Promise.resolve()),
  record: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
  uri: "file:///mock-prompt.m4a" as string | null,
};

jest.mock("expo-audio", () => ({
  useAudioRecorder: () => mockRecorder,
  useAudioRecorderState: () => ({
    canRecord: true,
    isRecording: false,
    durationMillis: 0,
    metering: undefined,
    url: null,
    mediaServicesDidReset: false,
  }),
  AudioModule: {
    requestRecordingPermissionsAsync: jest.fn(() =>
      Promise.resolve({ granted: true, canAskAgain: true, expires: "never" }),
    ),
  },
  RecordingPresets: { HIGH_QUALITY: {} },
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: "medium", Light: "light" },
  NotificationFeedbackType: { Success: "success" },
}));

jest.mock("expo-image", () => ({
  Image: () => null,
}));

jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  launchCameraAsync: jest.fn(() =>
    Promise.resolve({
      canceled: false,
      assets: [
        {
          uri: "file:///mock-photo.jpg",
          mimeType: "image/jpeg",
          exif: { DateTimeOriginal: "2026:05:03 12:00:00" },
        },
      ],
    }),
  ),
  launchImageLibraryAsync: jest.fn(() =>
    Promise.resolve({
      canceled: false,
      assets: [
        {
          uri: "file:///mock-photo.jpg",
          mimeType: "image/jpeg",
          exif: {},
        },
      ],
    }),
  ),
  requestCameraPermissionsAsync: (...args: unknown[]) =>
    mockRequestCameraPerms(...args),
  requestMediaLibraryPermissionsAsync: jest.fn(() =>
    Promise.resolve({ granted: true }),
  ),
}));

import CaptureScreen from "../capture";

beforeEach(() => {
  mockReplace.mockReset();
  mockBack.mockReset();
  mockAddMemory.mockReset();
  mockAddMemory.mockResolvedValue({ syncedToCloud: true, id: "mem-1" });
  mockAttachPhoto.mockReset();
  mockTranscribe.mockReset();
  mockTranscribe.mockResolvedValue("Coffee with Alex this morning.");
  mockRequestCameraPerms.mockReset();
  mockRequestCameraPerms.mockResolvedValue({ granted: true });
  mockRecorder.prepareToRecordAsync.mockClear();
  mockRecorder.record.mockClear();
  mockRecorder.stop.mockClear();
  mockRecorder.uri = "file:///mock-prompt.m4a";
});

async function attachPhoto(view: ReturnType<typeof render>) {
  // The "Add a photo" alert offers two options on iOS; bypass it by
  // auto-selecting "Take photo" so the camera path runs.
  const alertSpy = jest
    .spyOn(Alert, "alert")
    .mockImplementation(
      (
        _title: string,
        _msg?: string,
        buttons?: ReadonlyArray<{ text?: string; onPress?: () => void }>,
      ) => {
        const take = buttons?.find((b) => b.text === "Take photo");
        take?.onPress?.();
      },
    );
  await act(async () =>
    fireEvent.press(view.getByLabelText("Add a photo to this memory")),
  );
  alertSpy.mockRestore();
}

async function recordTranscript(view: ReturnType<typeof render>) {
  await act(async () =>
    fireEvent.press(view.getByLabelText(/Record voice prompt|Re-record/i)),
  );
  await act(async () =>
    fireEvent.press(view.getByLabelText("Recording — tap to stop")),
  );
}

describe("CaptureScreen — voice prompt wiring (Task #376)", () => {
  test("voice prompt is hidden until a photo is attached", () => {
    const view = render(<CaptureScreen />);
    expect(view.queryByTestId("voice-prompt-control")).toBeNull();
  });

  test("attaching a photo reveals the voice prompt; transcript populates the body and saves through addMemory unchanged", async () => {
    const view = render(<CaptureScreen />);
    await attachPhoto(view);
    expect(view.queryByTestId("voice-prompt-control")).toBeTruthy();

    await recordTranscript(view);

    // Transcript landed in the existing `content` field — one
    // memory per capture, no separate voice memory record.
    const input = view.getByPlaceholderText("What's on your mind?");
    expect(input.props.value).toBe("Coffee with Alex this morning.");

    await act(async () => fireEvent.press(view.getByText("Save")));

    expect(mockAddMemory).toHaveBeenCalledTimes(1);
    expect(mockAddMemory.mock.calls[0][0]).toBe(
      "Coffee with Alex this morning.",
    );
    expect(mockAttachPhoto).toHaveBeenCalledTimes(1);
    expect(mockAttachPhoto.mock.calls[0][0]).toBe("mem-1");
  });

  test("removing the photo silently clears an unedited transcript (no Alert)", async () => {
    const view = render(<CaptureScreen />);
    await attachPhoto(view);
    await recordTranscript(view);

    const alertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementation(() => {});

    await act(async () =>
      fireEvent.press(view.getByLabelText("Remove attached photo")),
    );

    const input = view.getByPlaceholderText("What's on your mind?");
    expect(input.props.value).toBe("");
    expect(alertSpy).not.toHaveBeenCalled();
    expect(view.queryByTestId("voice-prompt-control")).toBeNull();
    alertSpy.mockRestore();
  });

  test("transcription failure leaves the photo and any prior text intact", async () => {
    const view = render(<CaptureScreen />);
    await attachPhoto(view);

    fireEvent.changeText(
      view.getByPlaceholderText("What's on your mind?"),
      "Pre-existing notes about this photo.",
    );

    mockTranscribe.mockRejectedValueOnce(new Error("whisper offline"));

    await act(async () =>
      fireEvent.press(view.getByLabelText("Record voice prompt")),
    );
    await view.findByLabelText("Recording — tap to stop");
    await act(async () =>
      fireEvent.press(view.getByLabelText("Recording — tap to stop")),
    );
    await view.findByLabelText("Record voice prompt");

    const input = view.getByPlaceholderText("What's on your mind?");
    expect(input.props.value).toBe("Pre-existing notes about this photo.");
    expect(view.queryByLabelText("Remove attached photo")).toBeTruthy();
    expect(view.queryByTestId("voice-prompt-control")).toBeTruthy();
  });

  test("removing the photo prompts confirmation when the user has edited the transcript", async () => {
    const view = render(<CaptureScreen />);
    await attachPhoto(view);
    await recordTranscript(view);

    // User types over the auto-filled body — the orphan-clear path
    // must ask before discarding their work.
    fireEvent.changeText(
      view.getByPlaceholderText("What's on your mind?"),
      "My own version of the memory.",
    );

    let captured: ReadonlyArray<{
      text?: string;
      onPress?: () => void;
    }> = [];
    const alertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementation(
        (
          _title: string,
          _msg?: string,
          buttons?: ReadonlyArray<{
            text?: string;
            onPress?: () => void;
          }>,
        ) => {
          captured = buttons ?? [];
        },
      );

    await act(async () =>
      fireEvent.press(view.getByLabelText("Remove attached photo")),
    );

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(captured.find((b) => b.text === "Discard")).toBeTruthy();
    expect(captured.find((b) => b.text === "Keep text")).toBeTruthy();

    await act(async () => {
      captured.find((b) => b.text === "Keep text")?.onPress?.();
    });
    const input = view.getByPlaceholderText("What's on your mind?");
    expect(input.props.value).toBe("My own version of the memory.");
    expect(view.queryByTestId("voice-prompt-control")).toBeNull();

    alertSpy.mockRestore();
  });
});
