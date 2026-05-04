/**
 * Unit coverage for VoicePromptControl: state machine, re-record/
 * undo, transcript preview, and the STT-unavailable / failure paths.
 */
import React from "react";
import { Alert, Linking } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockTranscribe = jest.fn();
let mockSttAvailable = true;
let mockSttReason:
  | "authorization_denied"
  | "on_device_unsupported"
  | "ios_too_old"
  | "framework_not_present"
  | "module_not_linked"
  | "non_ios_platform"
  | "recognizer_unavailable"
  | "unknown"
  | null = null;
let mockEngineName: string | null = null;

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

jest.mock("@/lib/voiceCapture", () => ({
  transcribeRecording: (...args: unknown[]) => mockTranscribe(...args),
  isSpeechToTextAvailable: () => mockSttAvailable,
  getSpeechToTextUnavailableReason: () => mockSttReason,
  getSpeechToTextEngineName: () => mockEngineName,
}));

const mockRecorder = {
  prepareToRecordAsync: jest.fn(() => Promise.resolve()),
  record: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
  uri: "file:///mock-prompt.m4a" as string | null,
};

const mockPlayer = {
  play: jest.fn(),
  pause: jest.fn(),
  remove: jest.fn(),
  seekTo: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
};
const mockCreateAudioPlayer = jest.fn(() => mockPlayer);

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
  createAudioPlayer: (...args: unknown[]) => mockCreateAudioPlayer(...args),
}));

const mockDeleteAsync = jest.fn(() => Promise.resolve());
jest.mock(
  "expo-file-system/legacy",
  () => ({ deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args) }),
  { virtual: true },
);

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: "medium", Light: "light" },
}));

import { AudioModule } from "expo-audio";
import { VoicePromptControl } from "../VoicePromptControl";

const requestPermissions =
  AudioModule.requestRecordingPermissionsAsync as jest.Mock;

beforeEach(() => {
  mockTranscribe.mockReset();
  mockTranscribe.mockResolvedValue("Coffee with Alex this morning.");
  mockSttAvailable = true;
  mockSttReason = null;
  mockEngineName = null;
  mockRecorder.prepareToRecordAsync.mockClear();
  mockRecorder.record.mockClear();
  mockRecorder.stop.mockClear();
  mockRecorder.uri = "file:///mock-prompt.m4a";
  requestPermissions.mockReset();
  requestPermissions.mockResolvedValue({
    granted: true,
    canAskAgain: true,
    expires: "never",
  });
  mockPlayer.play.mockClear();
  mockPlayer.pause.mockClear();
  mockPlayer.remove.mockClear();
  mockPlayer.seekTo.mockClear();
  mockPlayer.addListener.mockClear();
  mockCreateAudioPlayer.mockClear();
  mockCreateAudioPlayer.mockImplementation(() => mockPlayer);
  mockDeleteAsync.mockClear();
});

async function pressMic(view: ReturnType<typeof render>) {
  await act(async () => {
    fireEvent.press(view.getByLabelText(/Record voice prompt|Re-record/i));
  });
  // Flush the fire-and-forget startRecording chain.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function tapMic(view: ReturnType<typeof render>) {
  await pressMic(view);
  await view.findByLabelText("Recording — tap to stop");
}
async function tapStop(view: ReturnType<typeof render>) {
  await act(async () => {
    fireEvent.press(view.getByLabelText("Recording — tap to stop"));
  });
  await view.findByLabelText(/Re-record voice prompt|Record voice prompt/i);
}

describe("VoicePromptControl — happy path", () => {
  test("recording phase renders a live waveform indicator", async () => {
    const view = render(<VoicePromptControl onTranscript={jest.fn()} />);
    expect(view.queryByTestId("voice-prompt-control-waveform")).toBeNull();
    await tapMic(view);
    expect(view.getByTestId("voice-prompt-control-waveform")).toBeTruthy();
    // Cleanup: stop recording so the auto-stop timer doesn't keep
    // pushing levels after the assertion.
    await tapStop(view);
  });

  test("post-transcribe preview surfaces what we heard", async () => {
    const onTranscript = jest.fn();
    const view = render(<VoicePromptControl onTranscript={onTranscript} />);
    await tapMic(view);
    await tapStop(view);
    const preview = view.getByTestId("voice-prompt-control-transcript");
    expect(preview).toBeTruthy();
    // The preview wraps the heard text in quotes; assert the text
    // content survives the transformation.
    expect(view.getByText(/Coffee with Alex this morning\./)).toBeTruthy();
  });

  test("idle → recording → processing → idle fires onTranscript with previous=null", async () => {
    const onTranscript = jest.fn();
    const view = render(<VoicePromptControl onTranscript={onTranscript} />);

    await tapMic(view);
    expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
    expect(mockRecorder.record).toHaveBeenCalledTimes(1);

    await tapStop(view);

    expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
    expect(mockTranscribe).toHaveBeenCalledWith("file:///mock-prompt.m4a");
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith({
      text: "Coffee with Alex this morning.",
      previous: null,
    });
    // Returned to idle — the re-record affordance is now reachable.
    expect(view.getByLabelText("Re-record voice prompt")).toBeTruthy();
  });

  test("re-record passes previous transcript and surfaces inline Undo that reverts", async () => {
    const onTranscript = jest.fn();
    const view = render(<VoicePromptControl onTranscript={onTranscript} />);

    // First capture
    await tapMic(view);
    await tapStop(view);

    // Second capture — different text
    mockTranscribe.mockResolvedValueOnce("Lunch with Sam.");
    await tapMic(view);
    await tapStop(view);

    expect(onTranscript).toHaveBeenCalledTimes(2);
    expect(onTranscript).toHaveBeenLastCalledWith({
      text: "Lunch with Sam.",
      previous: "Coffee with Alex this morning.",
    });

    // Inline Undo chip is now on screen — pressing it should
    // re-fire onTranscript with the prior text so the host's
    // body field reverts in lockstep with the control's state.
    const undo = view.getByLabelText("Undo voice transcript replacement");
    await act(async () => fireEvent.press(undo));
    expect(onTranscript).toHaveBeenCalledTimes(3);
    expect(onTranscript).toHaveBeenLastCalledWith({
      text: "Coffee with Alex this morning.",
      previous: "Lunch with Sam.",
    });
  });
});

describe("VoicePromptControl — playback (Task #395)", () => {
  test("after a successful transcript, Play back chip appears and toggles play/pause", async () => {
    const view = render(<VoicePromptControl onTranscript={jest.fn()} />);
    expect(view.queryByTestId("voice-prompt-control-playback")).toBeNull();
    await tapMic(view);
    await tapStop(view);

    const chip = view.getByLabelText("Play back voice note");
    expect(chip).toBeTruthy();

    await act(async () => fireEvent.press(chip));
    expect(mockCreateAudioPlayer).toHaveBeenCalledWith({
      uri: "file:///mock-prompt.m4a",
    });
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);

    // Now in the playing state — chip becomes Pause and tapping
    // again pauses without disposing the player.
    const pauseChip = view.getByLabelText("Pause voice note playback");
    await act(async () => fireEvent.press(pauseChip));
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText("Play back voice note")).toBeTruthy();
  });

  test("re-record disposes the player and deletes the previous temp file", async () => {
    const view = render(<VoicePromptControl onTranscript={jest.fn()} />);
    await tapMic(view);
    await tapStop(view);

    // Trigger playback so a player exists to be torn down.
    await act(async () =>
      fireEvent.press(view.getByLabelText("Play back voice note")),
    );

    mockRecorder.uri = "file:///mock-prompt-2.m4a";
    mockTranscribe.mockResolvedValueOnce("Lunch with Sam.");
    await tapMic(view);

    expect(mockPlayer.remove).toHaveBeenCalled();
    expect(mockDeleteAsync).toHaveBeenCalledWith(
      "file:///mock-prompt.m4a",
      expect.objectContaining({ idempotent: true }),
    );

    await tapStop(view);
    // New chip is back and a fresh player is built on next play.
    await act(async () =>
      fireEvent.press(view.getByLabelText("Play back voice note")),
    );
    expect(mockCreateAudioPlayer).toHaveBeenLastCalledWith({
      uri: "file:///mock-prompt-2.m4a",
    });
  });

  test("Undo removes the playback chip and deletes the temp file", async () => {
    const view = render(<VoicePromptControl onTranscript={jest.fn()} />);
    await tapMic(view);
    await tapStop(view);

    mockRecorder.uri = "file:///mock-prompt-2.m4a";
    mockTranscribe.mockResolvedValueOnce("Lunch with Sam.");
    await tapMic(view);
    await tapStop(view);

    mockDeleteAsync.mockClear();
    await act(async () =>
      fireEvent.press(view.getByLabelText("Undo voice transcript replacement")),
    );
    expect(view.queryByTestId("voice-prompt-control-playback")).toBeNull();
    expect(mockDeleteAsync).toHaveBeenCalledWith(
      "file:///mock-prompt-2.m4a",
      expect.objectContaining({ idempotent: true }),
    );
  });

  test("unmount deletes the retained temp file so audio never lingers", async () => {
    const view = render(<VoicePromptControl onTranscript={jest.fn()} />);
    await tapMic(view);
    await tapStop(view);
    mockDeleteAsync.mockClear();
    view.unmount();
    expect(mockDeleteAsync).toHaveBeenCalledWith(
      "file:///mock-prompt.m4a",
      expect.objectContaining({ idempotent: true }),
    );
  });
});

describe("VoicePromptControl — failure surfaces", () => {
  test("STT unavailable + authorization_denied shows inline Settings deep-link", async () => {
    mockSttAvailable = false;
    mockSttReason = "authorization_denied";
    const onError = jest.fn();
    const alertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementation(() => {});
    const openSettings = jest
      .spyOn(Linking, "openSettings")
      .mockImplementation(() => Promise.resolve());

    const view = render(
      <VoicePromptControl onTranscript={jest.fn()} onError={onError} />,
    );

    // Tap the mic — should NOT start recording. The control surfaces
    // a permission-specific message + an Open Settings affordance
    // wired to Linking.openSettings.
    await pressMic(view);

    expect(mockRecorder.record).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/permission was denied/i);
    // Inline button must reach openSettings — without it the user
    // is stuck since they can't even reach the iOS Settings panel.
    await act(async () =>
      fireEvent.press(
        view.getByLabelText("Open Settings to grant microphone permission"),
      ),
    );
    expect(openSettings).toHaveBeenCalledTimes(1);

    alertSpy.mockRestore();
    openSettings.mockRestore();
  });

  test("transcribe failure reports onError, returns to idle, no transcript fired", async () => {
    mockTranscribe.mockRejectedValueOnce(new Error("whisper unavailable"));
    const onTranscript = jest.fn();
    const onError = jest.fn();
    const view = render(
      <VoicePromptControl
        onTranscript={onTranscript}
        onError={onError}
      />,
    );

    await tapMic(view);
    await tapStop(view);

    expect(onTranscript).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/whisper unavailable/);
    // Mic returns to idle so the user can immediately retry.
    expect(view.getByLabelText("Record voice prompt")).toBeTruthy();
  });

  test("empty transcript reports a calm error and does not fire onTranscript", async () => {
    mockTranscribe.mockResolvedValueOnce("   ");
    const onTranscript = jest.fn();
    const onError = jest.fn();
    const view = render(
      <VoicePromptControl
        onTranscript={onTranscript}
        onError={onError}
      />,
    );
    await tapMic(view);
    await tapStop(view);
    expect(onTranscript).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/didn't catch/i);
  });

  test("permission denied at request time triggers Settings alert and never records", async () => {
    requestPermissions.mockResolvedValueOnce({
      granted: false,
      canAskAgain: false,
      expires: "never",
    });
    const alertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementation(() => {});
    const onError = jest.fn();
    const view = render(
      <VoicePromptControl onTranscript={jest.fn()} onError={onError} />,
    );

    await pressMic(view);

    expect(mockRecorder.record).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    // The Settings alert is the only path back for a user who told
    // iOS "Don't allow" — make sure we always surface it.
    expect(alertSpy).toHaveBeenCalledWith(
      "Microphone access needed",
      expect.any(String),
      expect.any(Array),
    );
    alertSpy.mockRestore();
  });

  test("disabled prop blocks recording without errors", async () => {
    const onTranscript = jest.fn();
    const onError = jest.fn();
    const view = render(
      <VoicePromptControl
        onTranscript={onTranscript}
        onError={onError}
        disabled
      />,
    );
    // Pressable's `disabled` prop drops onPress so this is a no-op.
    await act(async () =>
      fireEvent.press(view.getByLabelText("Record voice prompt")),
    );
    expect(mockRecorder.record).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
