// Eagerly trigger expo's lazy WinterCG globals (structuredClone, URL,
// TextDecoder, ...). If they fire for the first time during jest
// teardown, jest-runtime rejects the late require() with "trying to
// import a file outside of the scope of the test code".
void globalThis.__ExpoImportMetaRegistry;
void globalThis.structuredClone;
void globalThis.URL;
void globalThis.URLSearchParams;
void globalThis.TextDecoder;
void globalThis.TextDecoderStream;
void globalThis.TextEncoderStream;

jest.mock("react-native-purchases");

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    multiGet: jest.fn(() => Promise.resolve([])),
    multiSet: jest.fn(() => Promise.resolve()),
    multiRemove: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

// Task #387: stripPhotoMetadata re-encodes picked images via
// expo-image-manipulator to drop GPS EXIF before upload. Under
// jest there's no native module, so stub the API to echo the
// input URI back as a fake JPEG result. Tests that need to assert
// on the sanitisation can override this mock per-suite.
jest.mock("expo-image-manipulator", () => ({
  __esModule: true,
  manipulateAsync: jest.fn((uri) =>
    Promise.resolve({ uri, width: 100, height: 100 }),
  ),
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: {
    Light: "light",
    Medium: "medium",
    Heavy: "heavy",
    Soft: "soft",
    Rigid: "rigid",
  },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

jest.mock("react-native-reanimated", () =>
  require("react-native-reanimated/mock"),
);

// react-native-keyboard-controller ships its own jest mock at
// `react-native-keyboard-controller/jest`. jest-expo's preset doesn't
// auto-wire it, so we register it here once. Without this, components
// that call `useReanimatedKeyboardAnimation` (e.g. the Task #284
// messenger composer in `ChatThread.tsx`) crash in tests because the
// real module needs the native KeyboardController view tree.
jest.mock("react-native-keyboard-controller", () =>
  require("react-native-keyboard-controller/jest"),
);

// expo-audio touches `AudioModule.AudioPlayer.prototype` at module
// load (a TODO in the upstream src/ExpoAudio.ts), which throws when
// the native module isn't present (CI / jest). Stub the surface our
// components consume so loading the module doesn't crash.
jest.mock("expo-audio", () => ({
  __esModule: true,
  AudioModule: {
    requestRecordingPermissionsAsync: jest.fn(() =>
      Promise.resolve({ granted: true, status: "granted" }),
    ),
    setAudioModeAsync: jest.fn(() => Promise.resolve()),
  },
  RecordingPresets: {
    HIGH_QUALITY: {},
    LOW_QUALITY: {},
  },
  useAudioRecorder: () => ({
    prepareToRecordAsync: jest.fn(() => Promise.resolve()),
    record: jest.fn(),
    stop: jest.fn(() => Promise.resolve()),
    uri: null,
  }),
  useAudioRecorderState: () => ({ isRecording: false, metering: 0 }),
  useAudioPlayer: () => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    remove: jest.fn(),
  }),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  setIsAudioActiveAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock("expo-speech", () => ({
  __esModule: true,
  speak: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
  isSpeakingAsync: jest.fn(() => Promise.resolve(false)),
  pause: jest.fn(() => Promise.resolve()),
  resume: jest.fn(() => Promise.resolve()),
  getAvailableVoicesAsync: jest.fn(() => Promise.resolve([])),
  maxSpeechInputLength: 4000,
  VoiceQuality: { Default: "Default", Enhanced: "Enhanced" },
}));

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => () => {}),
    fetch: jest.fn(() =>
      Promise.resolve({ isConnected: true, isInternetReachable: true }),
    ),
  },
}));
