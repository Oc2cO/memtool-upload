/**
 * Capture-flow coverage for the daily-selfie ritual (Task #375).
 *
 * Pins the contract the rest of the system depends on:
 *
 *   1. Tapping "Daily selfie" on a fresh day opens the front camera
 *      (native), then calls `addMemory` with the `daily-selfie` tag
 *      followed by `attachPhotoToMemory` carrying the same localUri.
 *   2. Tapping it a second time on the same day opens a replace
 *      prompt and is **capture-first then swap**: the original
 *      selfie row is only deleted *after* the user produces a new
 *      asset, so a cancelled retake never destroys the original.
 *      The replacement persists with `bypassCaptureLimit: true`.
 *   3. Web falls back to the library picker but still creates a
 *      real `daily-selfie` tagged memory through the same pipeline.
 */
import React from "react";
import { Alert, Platform } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockAddMemory = jest.fn();
const mockAttachPhoto = jest.fn();
const mockDeleteMemory = jest.fn();
const mockLaunchImageLibrary = jest.fn();
const mockLaunchCamera = jest.fn();
const mockRequestLibraryPerms = jest.fn();
const mockRequestCameraPerms = jest.fn();

let mockMemoriesFixture: Array<Record<string, unknown>> = [];

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: mockBack }),
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
    deleteMemory: mockDeleteMemory,
    todayMemories: [],
    memories: mockMemoriesFixture,
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({
    status: { is_pro: false },
    freeDailyCaptureLimit: 5,
  }),
}));

jest.mock("@/components/ProUpsellCard", () => ({ ProUpsellCard: () => null }));

jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  CameraType: { front: "front", back: "back" },
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibrary(...args),
  launchCameraAsync: (...args: unknown[]) => mockLaunchCamera(...args),
  requestMediaLibraryPermissionsAsync: () => mockRequestLibraryPerms(),
  requestCameraPermissionsAsync: () => mockRequestCameraPerms(),
}));

import CaptureScreen from "../capture";

function setPlatform(os: "ios" | "web") {
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
}

describe("CaptureScreen — daily selfie ritual (Task #375)", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockReplace.mockReset();
    mockPush.mockReset();
    mockBack.mockReset();
    mockAddMemory.mockReset();
    mockAttachPhoto.mockReset();
    mockDeleteMemory.mockReset();
    mockLaunchImageLibrary.mockReset();
    mockLaunchCamera.mockReset();
    mockRequestLibraryPerms.mockReset();
    mockRequestCameraPerms.mockReset();
    mockRequestCameraPerms.mockResolvedValue({ granted: true });
    mockRequestLibraryPerms.mockResolvedValue({ granted: true });
    mockMemoriesFixture = [];
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    setPlatform("ios");
  });

  afterEach(() => alertSpy.mockRestore());

  test("first selfie of the day opens front camera and persists with daily-selfie tag", async () => {
    mockLaunchCamera.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///tmp/selfie.jpg",
          mimeType: "image/jpeg",
          exif: { DateTimeOriginal: "2026-05-03T10:00:00Z" },
        },
      ],
    });
    mockAddMemory.mockResolvedValueOnce({ id: "mem-selfie-1", syncedToCloud: true });

    const view = render(<CaptureScreen />);
    await act(async () => {
      fireEvent.press(view.getByLabelText("Add today's daily selfie"));
    });

    expect(mockLaunchCamera).toHaveBeenCalledTimes(1);
    expect(mockLaunchCamera.mock.calls[0][0]).toMatchObject({ cameraType: "front" });
    expect(mockAddMemory).toHaveBeenCalledTimes(1);
    const [content, options] = mockAddMemory.mock.calls[0];
    expect(content).toBe("Daily selfie");
    expect(options.tags).toEqual(["daily-selfie"]);
    expect(options.dailySelfieDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(options.bypassCaptureLimit).toBe(false);
    expect(mockAttachPhoto).toHaveBeenCalledWith("mem-selfie-1", expect.objectContaining({
      localUri: "file:///tmp/selfie.jpg",
      mimeType: "image/jpeg",
    }));
  });

  test("retake on a same-day selfie is capture-first: cancel keeps the original", async () => {
    // Seed an existing daily selfie for today.
    mockMemoriesFixture = [
      {
        id: "old-selfie",
        userId: "u1@test",
        content: "Daily selfie",
        timestamp: new Date().toISOString(),
        kind: "memory",
        tags: ["daily-selfie"],
      },
    ];
    // User cancels the camera.
    mockLaunchCamera.mockResolvedValueOnce({ canceled: true, assets: [] });

    let alertButtons: Array<{ text: string; onPress?: () => void }> = [];
    alertSpy.mockImplementation((_t, _b, btns) => {
      alertButtons = (btns ?? []) as typeof alertButtons;
    });

    const view = render(<CaptureScreen />);
    await act(async () => {
      fireEvent.press(view.getByLabelText("Add today's daily selfie"));
    });

    // The replace prompt fires.
    const retake = alertButtons.find((b) => b.text === "Retake");
    expect(retake).toBeTruthy();

    await act(async () => {
      retake!.onPress?.();
    });

    expect(mockLaunchCamera).toHaveBeenCalledTimes(1);
    // Camera was cancelled — the old selfie MUST still be present.
    expect(mockDeleteMemory).not.toHaveBeenCalled();
    expect(mockAddMemory).not.toHaveBeenCalled();
  });

  test("retake that succeeds deletes the old row and persists with bypassCaptureLimit", async () => {
    mockMemoriesFixture = [
      {
        id: "old-selfie",
        userId: "u1@test",
        content: "Daily selfie",
        timestamp: new Date().toISOString(),
        kind: "memory",
        tags: ["daily-selfie"],
      },
    ];
    mockLaunchCamera.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///tmp/retake.jpg", mimeType: "image/jpeg" }],
    });
    mockAddMemory.mockResolvedValueOnce({ id: "mem-selfie-2", syncedToCloud: true });

    let alertButtons: Array<{ text: string; onPress?: () => void }> = [];
    alertSpy.mockImplementation((_t, _b, btns) => {
      alertButtons = (btns ?? []) as typeof alertButtons;
    });

    const view = render(<CaptureScreen />);
    await act(async () => {
      fireEvent.press(view.getByLabelText("Add today's daily selfie"));
    });
    const retake = alertButtons.find((b) => b.text === "Retake")!;
    await act(async () => retake.onPress?.());

    // Old row deleted only AFTER the new asset was acquired.
    expect(mockDeleteMemory).toHaveBeenCalledWith("old-selfie");
    expect(mockAddMemory).toHaveBeenCalledTimes(1);
    expect(mockAddMemory.mock.calls[0][1].bypassCaptureLimit).toBe(true);
    expect(mockAttachPhoto).toHaveBeenCalledWith(
      "mem-selfie-2",
      expect.objectContaining({ localUri: "file:///tmp/retake.jpg" }),
    );
  });

  test("web fallback uses the library picker but still creates a daily-selfie memory", async () => {
    setPlatform("web");
    mockLaunchImageLibrary.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "blob:web/abc", mimeType: "image/png" }],
    });
    mockAddMemory.mockResolvedValueOnce({ id: "mem-web-selfie", syncedToCloud: true });

    const view = render(<CaptureScreen />);
    await act(async () => {
      fireEvent.press(view.getByLabelText("Add today's daily selfie"));
    });

    // No native camera call on web.
    expect(mockLaunchCamera).not.toHaveBeenCalled();
    expect(mockLaunchImageLibrary).toHaveBeenCalledTimes(1);
    expect(mockAddMemory).toHaveBeenCalledWith(
      "Daily selfie",
      expect.objectContaining({ tags: ["daily-selfie"] }),
    );
    expect(mockAttachPhoto).toHaveBeenCalledWith(
      "mem-web-selfie",
      expect.objectContaining({ localUri: "blob:web/abc" }),
    );
  });
});
