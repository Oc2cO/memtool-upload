/**
 * Screen-level coverage for the photo-attach branch of the Capture
 * screen (Task #372). The capture screen is the only entry point
 * that can actually attach a user-picked photo to a memory, and the
 * contract that the rest of the system depends on is small and
 * exact:
 *
 *   1. Tapping the photo affordance pops the picker (camera path on
 *      native via the Alert action sheet, library path on web).
 *   2. Once a picture is in hand, hitting Save calls `addMemory`
 *      first and only then hands the same `localUri` to
 *      `attachPhotoToMemory(savedId, ...)` so the photo follows the
 *      memory it belongs to.
 *   3. A photo with no text is enough to save — Save must NOT be
 *      disabled when `content` is empty but a photo is picked.
 *      Removing the Pro gate was the entire point of round 2.
 *
 * Without this test, a refactor that drops the pickedPhotoUri
 * branch in `handleSave` (e.g. while cleaning up the draft logic)
 * would silently regress to text-only memories and the queue
 * coverage in `lib/memoryPhotos.test.ts` would never notice.
 */
import React from "react";
import { Alert, Platform } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockAddMemory = jest.fn();
const mockAttachPhoto = jest.fn();
const mockLaunchImageLibrary = jest.fn();
const mockLaunchCamera = jest.fn();
const mockRequestLibraryPerms = jest.fn();
const mockRequestCameraPerms = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    push: jest.fn(),
  }),
  // useCognitiveAudio (mounted by CaptureScreen) calls useFocusEffect
  // on mount; stub it to fire the callback once so any teardown the
  // hook returns still gets exercised, the way useFocusEffect would
  // on a real screen focus.
  useFocusEffect: (cb: () => void | (() => void)) => {
    const cleanup = cb();
    if (typeof cleanup === "function") cleanup();
  },
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
    attachPhotoToMemory: mockAttachPhoto,
    todayMemories: [],
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({
    status: { is_pro: false },
    freeDailyCaptureLimit: 5,
  }),
}));

jest.mock("@/components/ProUpsellCard", () => ({
  ProUpsellCard: () => null,
}));

jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibrary(...args),
  launchCameraAsync: (...args: unknown[]) => mockLaunchCamera(...args),
  requestMediaLibraryPermissionsAsync: () => mockRequestLibraryPerms(),
  requestCameraPermissionsAsync: () => mockRequestCameraPerms(),
}));

import CaptureScreen from "../capture";

describe("CaptureScreen — photo attach (Task #372)", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddMemory.mockReset();
    mockAttachPhoto.mockReset();
    mockLaunchImageLibrary.mockReset();
    mockLaunchCamera.mockReset();
    mockRequestLibraryPerms.mockReset();
    mockRequestCameraPerms.mockReset();
    // Default to "granted" so the picker actually opens. Tests that
    // need to assert the denied-permission Alert path can override.
    mockRequestLibraryPerms.mockResolvedValue({ granted: true });
    mockRequestCameraPerms.mockResolvedValue({ granted: true });
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    // Default to web so the picker takes the library-only branch
    // (no Alert action sheet to navigate). Individual tests can
    // override Platform.OS if they need the native path.
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      get: () => "web",
    });
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("picked photo + Save → addMemory then attachPhotoToMemory with the same localUri", async () => {
    mockLaunchImageLibrary.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///tmp/picked.jpg",
          mimeType: "image/jpeg",
          exif: { DateTimeOriginal: "2026-05-03T10:00:00Z" },
        },
      ],
    });
    mockAddMemory.mockResolvedValueOnce({
      id: "mem-saved-1",
      syncedToCloud: true,
    });

    const view = render(<CaptureScreen />);

    // Type something so we exercise the *photo + text* save path.
    // The photo-only path is asserted in the next test.
    const input = view.getByPlaceholderText("What's on your mind?");
    fireEvent.changeText(input, "rooftop sunset");

    // Tap the "Add a photo" affordance. On web, promptPickPhoto goes
    // straight to the library picker — no action sheet to dismiss.
    await act(async () => {
      fireEvent.press(view.getByLabelText("Add a photo to this memory"));
    });

    expect(mockLaunchImageLibrary).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    expect(mockAddMemory).toHaveBeenCalledTimes(1);
    expect(mockAttachPhoto).toHaveBeenCalledTimes(1);
    const [savedId, payload] = mockAttachPhoto.mock.calls[0];
    // The photo MUST be tied to the just-saved memory's id, not the
    // optimistic clientId — otherwise the server PATCH would land on
    // the wrong row (or 404) and the photo would never appear.
    expect(savedId).toBe("mem-saved-1");
    expect(payload).toMatchObject({
      localUri: "file:///tmp/picked.jpg",
      mimeType: "image/jpeg",
      takenAt: "2026-05-03T10:00:00Z",
    });
  });

  test("photo with no text still saves (Pro gate is gone, photo-only memories allowed)", async () => {
    mockLaunchImageLibrary.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///tmp/silent.jpg", mimeType: "image/jpeg" }],
    });
    mockAddMemory.mockResolvedValueOnce({
      id: "mem-saved-2",
      syncedToCloud: true,
    });

    const view = render(<CaptureScreen />);

    // No text input. Pick a photo, then hit Save.
    await act(async () => {
      fireEvent.press(view.getByLabelText("Add a photo to this memory"));
    });

    const saveBtn = view.getByText("Save");
    // The Save button must be enabled — round 1 had it disabled
    // unless `content.trim()` was non-empty, which broke photo-only
    // saves the round-2 reviewer explicitly asked us to support.
    await act(async () => {
      fireEvent.press(saveBtn);
    });

    expect(mockAddMemory).toHaveBeenCalledTimes(1);
    expect(mockAttachPhoto).toHaveBeenCalledTimes(1);
    expect(mockAttachPhoto.mock.calls[0][1]).toMatchObject({
      localUri: "file:///tmp/silent.jpg",
    });
  });
});
