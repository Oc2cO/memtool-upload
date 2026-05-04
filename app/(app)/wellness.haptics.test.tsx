/**
 * Screen-level coverage for the haptic verbs the Wellness screen
 * (`app/(app)/wellness.tsx`) fires after the Task #203 verb refactor:
 *
 *   - successful stress save → `useHaptics().play("capture")`
 *     (the same "we got it" verb the capture / log-call screens use)
 *   - failed stress save     → `useHaptics().play("error")`
 *
 * Without these, a future refactor of `handleSave` could silently
 * swap the success verb (e.g. to "streak-extended") or drop the
 * failure verb entirely — either of which would make the Wellness
 * screen feel inconsistent with every other save surface in the app.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockPlay = jest.fn();
const mockSetStress = jest.fn();
const mockBack = jest.fn();

jest.mock("@/lib/haptics", () => {
  const actual = jest.requireActual("@/lib/haptics");
  return {
    ...actual,
    useHaptics: () => ({ play: mockPlay }),
  };
});

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const cleanup = cb();
    if (typeof cleanup === "function") cleanup();
  },
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));

jest.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({ profile: null }),
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
    primaryForeground: "#fff",
    destructive: "#ef4444",
    mutedForeground: "#999",
  }),
}));

jest.mock("@/context/MoodContext", () => ({
  useMood: () => ({
    history: [],
    todayLog: null,
    setStress: mockSetStress,
  }),
}));

jest.mock("@/components/alive/SettleOnMount", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    SettleOnMount: ({
      children,
      style,
    }: {
      children: React.ReactNode;
      style?: object;
    }) => ReactLib.createElement(RNView, { style }, children),
  };
});

// GradientButton is the Save affordance — stub it to a plain Pressable
// so fireEvent.press hits handleSave directly without depending on
// the AliveButton/ScalePress nesting inside the real component.
jest.mock("@/components/GradientButton", () => {
  const ReactLib = require("react");
  const { Pressable, Text } = require("react-native");
  return {
    GradientButton: ({
      title,
      onPress,
      disabled,
    }: {
      title: string;
      onPress: () => void;
      disabled?: boolean;
    }) =>
      ReactLib.createElement(
        Pressable,
        { onPress, disabled, accessibilityLabel: title },
        ReactLib.createElement(Text, null, title),
      ),
  };
});

jest.mock("@/components/Toast", () => ({ Toast: () => null }));

import WellnessScreen from "./wellness";

beforeEach(() => {
  mockPlay.mockReset();
  mockSetStress.mockReset();
  mockBack.mockReset();
});

describe("WellnessScreen — useHaptics().play verbs after the Task #203 verb refactor", () => {
  test("successful stress save fires play('capture') — matches the rest of the app's save verb", async () => {
    mockSetStress.mockResolvedValueOnce(undefined);

    const view = render(<WellnessScreen />);
    await act(async () => {
      fireEvent.press(view.getByText("Save Stress Level"));
    });

    expect(mockSetStress).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("capture");
    // And the screen should pop back on success — pinning this guards
    // the ordering: haptic *then* navigation, never haptic-after-back
    // (which would fire on an unmounted screen).
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  test("failed stress save fires play('error') — calm two-thump 'MemTool says no'", async () => {
    // mockImplementationOnce (not mockRejectedValueOnce) — same reason
    // as the capture/log-call tests: the eager form deadlocks act().
    mockSetStress.mockImplementationOnce(() =>
      Promise.reject(new Error("storage hiccup")),
    );
    // The catch path also console.warn's; silence to keep the test
    // output clean without losing the assertion.
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const view = render(<WellnessScreen />);
    await act(async () => {
      fireEvent.press(view.getByText("Save Stress Level"));
    });

    expect(mockSetStress).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("error");
    // Failure must NOT navigate away — the calm error toast keeps
    // the user on the screen so they can retry.
    expect(mockBack).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
