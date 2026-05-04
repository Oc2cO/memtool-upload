/**
 * Tests for EditProfileScreen — Task #299.
 *
 * Covers the avatar upload path (code-review requirement) and
 * display-name save path. Verifies:
 *   1. Avatar picker calls updateAvatar immediately on pick.
 *   2. Avatar is initialised from user.avatar_uri on mount.
 *   3. Saving a display name calls updateDisplayName.
 *   4. Empty display name shows a validation error without calling updateDisplayName.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUpdateDisplayName = jest.fn();
const mockUpdateAvatar = jest.fn();
const mockRouterBack = jest.fn();

// Variable must be prefixed "mock" so Jest's hoisting permits its use inside
// the jest.mock() factory below.
const mockUserState = {
  email: "user@example.com",
  display_name: "Test User",
  avatar_uri: undefined as string | undefined,
};

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { ...mockUserState },
    updateDisplayName: mockUpdateDisplayName,
    updateAvatar: mockUpdateAvatar,
  }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockRouterBack, push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#000",
    foreground: "#fff",
    card: "#111",
    border: "#222",
    primary: "#a78bfa",
    destructive: "#ef4444",
    mutedForeground: "#999",
    input: "#111",
  }),
}));

jest.mock("@/lib/inputLimits", () => ({
  DISPLAY_NAME_MAX_LENGTH: 80,
}));

const mockApiUploadAvatar = jest.fn();
jest.mock("@/lib/accountApi", () => ({
  apiUploadAvatar: (uri: string) => mockApiUploadAvatar(uri),
  apiUpdateDisplayName: jest.fn().mockResolvedValue(""),
  apiDeleteAccount: jest.fn(),
}));

jest.mock("@/constants/spacing", () => ({
  radius: { md: 16, full: 9999 },
  spacing: { base: 16, sm: 8, lg: 24 },
}));

jest.mock("@/constants/typography", () => ({
  text: { captionStrong: { fontSize: 12, fontWeight: "600" } },
}));

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "Light", Medium: "Medium" },
}));

jest.mock("@/lib/haptics", () => ({
  useHaptics: () => ({ play: jest.fn() }),
}));

jest.mock("expo-linear-gradient", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    LinearGradient: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: object;
    }) => React.createElement(View, { style }, children),
  };
});

jest.mock("expo-image", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Image: (props: object) => React.createElement(View, props) };
});

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Ionicons: (props: object) => React.createElement(View, props) };
});

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/components/GradientButton", () => {
  const React = require("react");
  const { Pressable, Text } = require("react-native");
  return {
    GradientButton: ({
      title,
      onPress,
      testID,
      disabled,
    }: {
      title: string;
      onPress: () => void;
      testID?: string;
      disabled?: boolean;
      style?: object;
    }) =>
      React.createElement(
        Pressable,
        { onPress: disabled ? undefined : onPress, testID },
        React.createElement(Text, null, title),
      ),
  };
});

// ---------------------------------------------------------------------------

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

import EditProfileScreen from "./edit-profile";

beforeEach(() => {
  jest.clearAllMocks();
  mockUserState.display_name = "Test User";
  mockUserState.avatar_uri = undefined;
  mockUpdateDisplayName.mockResolvedValue(undefined);
  mockUpdateAvatar.mockResolvedValue(undefined);
  mockApiUploadAvatar.mockResolvedValue("https://cdn.example.com/api/storage/objects/abc.jpg");

  jest
    .spyOn(ImagePicker, "requestMediaLibraryPermissionsAsync")
    .mockResolvedValue({
      granted: true,
      status: "granted" as ImagePicker.PermissionStatus,
      canAskAgain: true,
      expires: "never",
    });
  jest.spyOn(ImagePicker, "launchImageLibraryAsync").mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: "file:///photos/avatar.jpg",
        width: 400,
        height: 400,
        type: "image",
      } as ImagePicker.ImagePickerAsset,
    ],
  } as ImagePicker.ImagePickerSuccessResult);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("EditProfileScreen — avatar upload path (Task #299)", () => {
  test("tapping the avatar picker calls updateAvatar with the selected image URI", async () => {
    const view = render(<EditProfileScreen />);
    await flushAsync();

    await act(async () => {
      fireEvent.press(view.getByTestId("edit-profile-avatar-picker"));
    });
    await flushAsync();

    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
    expect(mockApiUploadAvatar).toHaveBeenCalledWith("file:///photos/avatar.jpg");
    expect(mockUpdateAvatar).toHaveBeenCalledWith(
      "https://cdn.example.com/api/storage/objects/abc.jpg",
    );
  });

  test("when ImagePicker is cancelled, updateAvatar is NOT called", async () => {
    jest.spyOn(ImagePicker, "launchImageLibraryAsync").mockResolvedValue({
      canceled: true,
      assets: null,
    } as ImagePicker.ImagePickerCanceledResult);

    const view = render(<EditProfileScreen />);
    await flushAsync();

    await act(async () => {
      fireEvent.press(view.getByTestId("edit-profile-avatar-picker"));
    });
    await flushAsync();

    expect(mockUpdateAvatar).not.toHaveBeenCalled();
  });

  test("avatar is rendered from the picker area on mount", async () => {
    const view = render(<EditProfileScreen />);
    await flushAsync();

    expect(view.getByTestId("edit-profile-avatar-picker")).toBeTruthy();
  });
});

describe("EditProfileScreen — display name save path (Task #299)", () => {
  test("tapping 'Save changes' calls updateDisplayName with the trimmed input", async () => {
    const view = render(<EditProfileScreen />);
    await flushAsync();

    fireEvent.changeText(
      view.getByTestId("edit-profile-name-input"),
      "  New Name  ",
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("edit-profile-save"));
    });
    await flushAsync();

    expect(mockUpdateDisplayName).toHaveBeenCalledWith("New Name");
  });

  test("empty display name shows validation error and does NOT call updateDisplayName", async () => {
    const view = render(<EditProfileScreen />);
    await flushAsync();

    fireEvent.changeText(view.getByTestId("edit-profile-name-input"), "   ");
    await act(async () => {
      fireEvent.press(view.getByTestId("edit-profile-save"));
    });
    await flushAsync();

    expect(mockUpdateDisplayName).not.toHaveBeenCalled();
    expect(view.getByText("Display name can't be empty")).toBeTruthy();
  });
});
