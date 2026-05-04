/**
 * Pre-launch polish lock-in (Task #176): the Login screen renders a
 * subtle "Connection looks slow…" hint after ~5s of an in-flight
 * submit so the user knows the app is still trying. The 20s
 * authFetch timeout still backstops a real hang — this is purely
 * the "we're slow but alive" affordance, and a regression that
 * dropped the timer (or the message) would silently leave users
 * staring at a frozen-looking button.
 */
import React from "react";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react-native";

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

const mockLogin = jest.fn();
const mockSignup = jest.fn();
const mockAuth = {
  login: mockLogin,
  signup: mockSignup,
  user: null as { email: string } | null,
  hasSeenOnboarding: false,
};

jest.mock("expo-router", () => {
  const ReactLib = require("react");
  return {
    useRouter: () => mockRouterApi,
    Redirect: ({ href }: { href: string }) =>
      ReactLib.createElement(
        require("react-native").Text,
        { testID: "redirect" },
        href,
      ),
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

jest.mock("@/lib/haptics", () => ({
  useHaptics: () => mockHaptics,
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

jest.mock("@/components/alive/GradientBackground", () => ({
  GradientBackground: () => null,
}));

jest.mock("@/components/alive/AmbientBlobs", () => ({
  AmbientBlobs: () => null,
}));

jest.mock("@/components/alive/RotatingBrandMark", () => ({
  RotatingBrandMark: () => null,
}));

const mockAuthCinematicSkipSpy = jest.fn();
jest.mock("@/components/alive/AuthCinematicStage", () => {
  const ReactLib = require("react");
  return {
    AuthCinematicStage: ReactLib.forwardRef(
      (
        { onSettle }: { onSettle?: () => void },
        ref: React.Ref<{ skip: () => void }>,
      ) => {
        ReactLib.useImperativeHandle(
          ref,
          () => ({ skip: mockAuthCinematicSkipSpy }),
          [],
        );
        // Settle synchronously on mount so the form fade-up runs and
        // pointerEvents flips to "auto" — required for the existing
        // submit/toggle tests to interact with the form controls.
        ReactLib.useEffect(() => {
          onSettle?.();
        }, [onSettle]);
        return null;
      },
    ),
    _resetAuthCinematicForTests: () => {},
    _hasAuthCinematicPlayedForTests: () => false,
  };
});

jest.mock("expo-blur", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    BlurView: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: object;
    }) => ReactLib.createElement(RNView, { style }, children),
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
          testID: "submit-button",
        },
        React.createElement(RN.Text, null, title),
      ),
  };
});

import LoginScreen from "./login";

describe("LoginScreen — slow-connection hint after ~5s of submitting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.user = null;
    mockAuth.hasSeenOnboarding = false;
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Ensure pending timers don't bleed across tests.
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  test("shows 'Connection looks slow…' once the in-flight submit crosses ~5s", async () => {
    // Hold the login mid-flight so `submitting` stays true past the
    // 5s mark — we never resolve this promise, the test only cares
    // about the timer-driven hint flipping on.
    mockLogin.mockImplementation(() => new Promise<void>(() => {}));

    const view = render(<LoginScreen />);

    // Fill the required fields so handleSubmit doesn't short-circuit
    // with the "Please fill in all fields" branch.
    fireEvent.changeText(view.getByPlaceholderText("Email"), "a@b.com");
    fireEvent.changeText(view.getByPlaceholderText("Password"), "hunter2");

    // Pre-condition: hint hidden before the submit even starts.
    expect(view.queryByText("Connection looks slow…")).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByTestId("submit-button"));
      // Allow handleSubmit to reach `setSubmitting(true)` and the
      // useEffect to register the 5s timer.
      await Promise.resolve();
    });

    // Just before the threshold — hint must still be hidden.
    await act(async () => {
      jest.advanceTimersByTime(4999);
    });
    expect(view.queryByText("Connection looks slow…")).toBeNull();

    // Cross the 5s threshold — hint flips on.
    await act(async () => {
      jest.advanceTimersByTime(2);
    });

    await waitFor(() => {
      expect(view.getByText("Connection looks slow…")).toBeTruthy();
    });
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  test("hint does NOT show before submitting starts", () => {
    const view = render(<LoginScreen />);

    // Even after a long idle period, no submit means no hint.
    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(view.queryByText("Connection looks slow…")).toBeNull();
    expect(mockLogin).not.toHaveBeenCalled();
  });
});

/**
 * Task #366: when the OS has Reduce Motion enabled, the post-login
 * Memora-glow handoff collapses from 400ms to ~200ms so the redirect
 * to the home tab feels instant under that accessibility preference.
 * A regression here would make the auth flow feel sluggish for the
 * exact users who asked the system to skip cinematic delays.
 */
describe("LoginScreen — reduce-motion shortens the success handoff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.user = null;
    mockAuth.hasSeenOnboarding = true;
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  test("redirect fires within ~200ms after success when Reduce Motion is on", async () => {
    const RN = require("react-native");
    const rmSpy = jest
      .spyOn(RN.AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true);
    // addEventListener may not exist on the mocked module — stub it
    // so the subscription cleanup doesn't crash either.
    const addSpy = jest
      .spyOn(RN.AccessibilityInfo, "addEventListener")
      .mockReturnValue({ remove: () => {} } as never);

    // Resolve login successfully and flip the auth user so the
    // redirect branch becomes reachable once the handoff timer ends.
    mockLogin.mockImplementation(async () => {
      mockAuth.user = { email: "a@b.com" };
    });

    const view = render(<LoginScreen />);

    // Let the AccessibilityInfo promise resolve into state before
    // pressing submit — otherwise reduceMotion is still false and
    // the handoff would use the 400ms branch.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.changeText(view.getByPlaceholderText("Email"), "a@b.com");
    fireEvent.changeText(view.getByPlaceholderText("Password"), "hunter2");

    await act(async () => {
      fireEvent.press(view.getByTestId("submit-button"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Handoff is in flight — the glow overlay is mounted and the
    // redirect is intentionally held back.
    expect(view.queryByTestId("auth-handoff-glow")).toBeTruthy();
    expect(view.queryByTestId("redirect")).toBeNull();

    // Just before the reduced 200ms threshold, still holding.
    await act(async () => {
      jest.advanceTimersByTime(199);
    });
    expect(view.queryByTestId("redirect")).toBeNull();

    // Cross the threshold — handoff clears and the redirect mounts.
    await act(async () => {
      jest.advanceTimersByTime(2);
    });

    await waitFor(() => {
      expect(view.queryByTestId("redirect")).toBeTruthy();
    });

    rmSpy.mockRestore();
    addSpy.mockRestore();
  });

  test("without Reduce Motion the handoff still holds for the full 400ms", async () => {
    const RN = require("react-native");
    const rmSpy = jest
      .spyOn(RN.AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false);
    const addSpy = jest
      .spyOn(RN.AccessibilityInfo, "addEventListener")
      .mockReturnValue({ remove: () => {} } as never);

    mockLogin.mockImplementation(async () => {
      mockAuth.user = { email: "a@b.com" };
    });

    const view = render(<LoginScreen />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.changeText(view.getByPlaceholderText("Email"), "a@b.com");
    fireEvent.changeText(view.getByPlaceholderText("Password"), "hunter2");

    await act(async () => {
      fireEvent.press(view.getByTestId("submit-button"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // At the reduced-motion threshold the redirect MUST still be
    // held — full-motion users get the 400ms glow-expand.
    await act(async () => {
      jest.advanceTimersByTime(201);
    });
    expect(view.queryByTestId("redirect")).toBeNull();

    // After 400ms total, the redirect lands.
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(view.queryByTestId("redirect")).toBeTruthy();
    });

    rmSpy.mockRestore();
    addSpy.mockRestore();
  });
});
