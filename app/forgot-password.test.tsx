/**
 * Tests for the ForgotPasswordScreen — Task #299.
 *
 * The screen now has a complete four-step in-app flow backed by the API:
 *   1. enter_email  — "Send reset code" calls apiForgotPassword
 *   2. check_email  — non-enumerating confirmation; user taps "Enter reset code"
 *   3. enter_code   — user submits code + new password → apiResetPassword
 *   4. done         — success banner
 *
 * Tests verify:
 *   - Success path through all steps
 *   - Offline / network failure shows inline error (stays on enter_email)
 *   - Mismatched passwords show validation error without calling apiResetPassword
 *   - Invalid/expired code from server shows inline error on enter_code
 *   - Non-enumerating: server always returns 200 for unknown emails
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockHapticsPlay = jest.fn();
const mockApiForgotPassword = jest.fn();
const mockApiResetPassword = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: mockRouterBack,
    replace: mockRouterReplace,
    push: jest.fn(),
  }),
  useLocalSearchParams: () => ({}),
}));

jest.mock("@/lib/haptics", () => ({
  useHaptics: () => ({ play: mockHapticsPlay }),
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "Light" },
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
  }),
}));

jest.mock("@/lib/inputLimits", () => ({
  EMAIL_MAX_LENGTH: 254,
}));

jest.mock("@/lib/accountApi", () => ({
  apiForgotPassword: (email: string) => mockApiForgotPassword(email),
  apiResetPassword: (code: string, pw: string) => mockApiResetPassword(code, pw),
  apiUpdateDisplayName: jest.fn(),
  apiUpdateAvatar: jest.fn(),
  apiDeleteAccount: jest.fn(),
}));

jest.mock("@/components/alive/AuthCinematicStage", () => ({
  AuthCinematicStage: () => null,
  _resetAuthCinematicForTests: () => {},
  _hasAuthCinematicPlayedForTests: () => false,
}));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Ionicons: (props: object) => React.createElement(View, props) };
});

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
        { onPress: disabled ? undefined : onPress, testID, accessibilityLabel: title },
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

import ForgotPasswordScreen from "./forgot-password";

beforeEach(() => {
  jest.useFakeTimers();
  mockRouterBack.mockReset();
  mockRouterReplace.mockReset();
  mockHapticsPlay.mockReset();
  mockApiForgotPassword.mockReset().mockResolvedValue(undefined);
  mockApiResetPassword.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------

describe("ForgotPasswordScreen — enter_email step", () => {
  test("renders email input and Send reset code button on mount", () => {
    const view = render(<ForgotPasswordScreen />);
    expect(view.getByTestId("forgot-password-email-input")).toBeTruthy();
    expect(view.getByTestId("forgot-password-send-code")).toBeTruthy();
  });

  test("tapping 'Send reset code' calls apiForgotPassword and transitions to check_email", async () => {
    const view = render(<ForgotPasswordScreen />);

    fireEvent.changeText(view.getByTestId("forgot-password-email-input"), "alice@example.com");
    await act(async () => {
      fireEvent.press(view.getByTestId("forgot-password-send-code"));
    });
    await flushAsync();

    expect(mockApiForgotPassword).toHaveBeenCalledWith("alice@example.com");
    expect(view.getByTestId("forgot-password-enter-code-btn")).toBeTruthy();
  });

  test("network failure shows inline error and stays on enter_email", async () => {
    mockApiForgotPassword.mockRejectedValueOnce(new Error("Couldn't reach the server — check your connection"));
    const view = render(<ForgotPasswordScreen />);

    fireEvent.changeText(view.getByTestId("forgot-password-email-input"), "alice@example.com");
    await act(async () => {
      fireEvent.press(view.getByTestId("forgot-password-send-code"));
    });
    await flushAsync();

    expect(view.getByTestId("forgot-password-error")).toBeTruthy();
    expect(mockHapticsPlay).toHaveBeenCalledWith("error");
    expect(view.getByTestId("forgot-password-send-code")).toBeTruthy();
  });

  test("unknown email still transitions to check_email (non-enumerating — server always 200)", async () => {
    mockApiForgotPassword.mockResolvedValue(undefined);
    const view = render(<ForgotPasswordScreen />);

    fireEvent.changeText(view.getByTestId("forgot-password-email-input"), "nobody@example.com");
    await act(async () => {
      fireEvent.press(view.getByTestId("forgot-password-send-code"));
    });
    await flushAsync();

    expect(view.getByTestId("forgot-password-enter-code-btn")).toBeTruthy();
  });
});

describe("ForgotPasswordScreen — check_email → enter_code step", () => {
  async function advanceToEnterCode(view: ReturnType<typeof render>) {
    fireEvent.changeText(view.getByTestId("forgot-password-email-input"), "alice@example.com");
    await act(async () => {
      fireEvent.press(view.getByTestId("forgot-password-send-code"));
    });
    await flushAsync();
    await act(async () => {
      fireEvent.press(view.getByTestId("forgot-password-enter-code-btn"));
    });
  }

  test("tapping 'Enter reset code' transitions to enter_code step", async () => {
    const view = render(<ForgotPasswordScreen />);
    await advanceToEnterCode(view);
    expect(view.getByTestId("forgot-password-code-input")).toBeTruthy();
    expect(view.getByTestId("forgot-password-submit-reset")).toBeTruthy();
  });

  test("submitting valid code and matching passwords calls apiResetPassword", async () => {
    const view = render(<ForgotPasswordScreen />);
    await advanceToEnterCode(view);

    fireEvent.changeText(view.getByTestId("forgot-password-code-input"), "123456");
    fireEvent.changeText(view.getByTestId("forgot-password-new-password-input"), "NewPass1!");
    fireEvent.changeText(view.getByTestId("forgot-password-confirm-password-input"), "NewPass1!");

    await act(async () => {
      fireEvent.press(view.getByTestId("forgot-password-submit-reset"));
    });
    await flushAsync();

    expect(mockApiResetPassword).toHaveBeenCalledWith("123456", "NewPass1!");
    expect(mockHapticsPlay).toHaveBeenCalledWith("capture");
  });

  test("mismatched passwords show validation error without calling apiResetPassword", async () => {
    const view = render(<ForgotPasswordScreen />);
    await advanceToEnterCode(view);

    fireEvent.changeText(view.getByTestId("forgot-password-code-input"), "123456");
    fireEvent.changeText(view.getByTestId("forgot-password-new-password-input"), "NewPass1!");
    fireEvent.changeText(view.getByTestId("forgot-password-confirm-password-input"), "Different!");

    await act(async () => {
      fireEvent.press(view.getByTestId("forgot-password-submit-reset"));
    });
    await flushAsync();

    expect(mockApiResetPassword).not.toHaveBeenCalled();
    expect(view.getByTestId("forgot-password-error")).toBeTruthy();
  });

  test("server error on reset shows inline error and stays on enter_code", async () => {
    mockApiResetPassword.mockRejectedValueOnce(new Error("Reset code is invalid or has expired."));
    const view = render(<ForgotPasswordScreen />);
    await advanceToEnterCode(view);

    fireEvent.changeText(view.getByTestId("forgot-password-code-input"), "000000");
    fireEvent.changeText(view.getByTestId("forgot-password-new-password-input"), "NewPass1!");
    fireEvent.changeText(view.getByTestId("forgot-password-confirm-password-input"), "NewPass1!");

    await act(async () => {
      fireEvent.press(view.getByTestId("forgot-password-submit-reset"));
    });
    await flushAsync();

    expect(view.getByTestId("forgot-password-error")).toBeTruthy();
    expect(view.getByTestId("forgot-password-submit-reset")).toBeTruthy();
  });
});
