/**
 * Pre-launch polish lock-in (Task #176): when the underlying
 * setStress AsyncStorage write rejects, the Wellness screen must
 * show the "Couldn't save — try again" Toast instead of bubbling
 * the error to the global ErrorBoundary (which historically blanked
 * the whole app for a single missed save).
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockRouterApi = { replace: jest.fn(), back: jest.fn(), push: jest.fn() };
const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
const mockColors = {
  background: "#fff",
  foreground: "#000",
  card: "#fff",
  border: "#ccc",
  muted: "#eee",
  mutedForeground: "#666",
  primary: "#007aff",
  primaryForeground: "#fff",
  destructive: "#ef4444",
  accent: "#5eead4",
  input: "#fff",
};
const mockHaptics = { play: jest.fn() };

const mockSetStress = jest.fn();
const mockMood = {
  history: [],
  todayLog: null,
  setRating: jest.fn(),
  setStress: mockSetStress,
  setNote: jest.fn(),
  refreshHistory: jest.fn(),
  isLoading: false,
};

jest.mock("expo-router", () => ({
  useRouter: () => mockRouterApi,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const cleanup = cb();
    if (typeof cleanup === "function") cleanup();
  },
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "test@example.com" } }),
}));

jest.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({ profile: null }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
}));

jest.mock("@/context/MoodContext", () => ({
  useMood: () => mockMood,
}));

jest.mock("@/lib/haptics", () => ({
  useHaptics: () => mockHaptics,
}));

jest.mock("@/lib/aliveUI", () => ({
  useBreathingEnabled: () => false,
}));

jest.mock("@/lib/animationTokens", () => ({
  cardEntering: () => undefined,
}));

jest.mock("@/components/alive/SettleOnMount", () => {
  const RN = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  return {
    SettleOnMount: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: unknown;
    }) => React.createElement(RN.View, { style }, children),
  };
});

jest.mock("@/components/GradientButton", () => {
  const RN = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  return {
    GradientButton: ({
      title,
      onPress,
      disabled,
    }: {
      title: string;
      onPress?: () => void;
      disabled?: boolean;
    }) =>
      React.createElement(
        RN.Pressable,
        {
          onPress,
          disabled,
          accessibilityLabel: title,
          accessibilityRole: "button",
        },
        React.createElement(RN.Text, null, title),
      ),
  };
});

// Surface the Toast's `visible` prop so we can assert it independent
// of the animated opacity (the real Toast keeps the Text mounted at
// all times, so text alone can't tell us if it's actually shown).
jest.mock("@/components/Toast", () => {
  const RN = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  return {
    Toast: ({ visible, message }: { visible: boolean; message: string }) =>
      React.createElement(
        RN.View,
        { testID: "save-error-toast" },
        React.createElement(
          RN.Text,
          { testID: "save-error-toast-visible" },
          visible ? "yes" : "no",
        ),
        React.createElement(
          RN.Text,
          { testID: "save-error-toast-message" },
          message,
        ),
      ),
  };
});

import WellnessScreen from "../wellness";

describe("WellnessScreen — setStress rejection surfaces the save-error Toast", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The screen schedules a 3s setTimeout to auto-dismiss the
    // toast after a save failure. Use fake timers so the pending
    // timer doesn't leak as an open handle into Jest's teardown.
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  test("shows the 'Couldn't save — try again' Toast (instead of crashing) when setStress rejects", async () => {
    mockSetStress.mockRejectedValue(new Error("AsyncStorage write failed"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const view = render(<WellnessScreen />);

    // Pre-condition: toast hidden on cold mount.
    expect(view.getByTestId("save-error-toast-visible").props.children).toBe(
      "no",
    );

    await act(async () => {
      fireEvent.press(view.getByLabelText("Save Stress Level"));
      // Let the rejected promise settle before asserting visible state.
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        view.getByTestId("save-error-toast-visible").props.children,
      ).toBe("yes");
    });
    expect(view.getByTestId("save-error-toast-message").props.children).toBe(
      "Couldn't save — try again",
    );
    expect(mockSetStress).toHaveBeenCalledTimes(1);
    // Save failure must not navigate away — the user stays on the
    // screen and can try again.
    expect(mockRouterApi.back).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
