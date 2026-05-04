/**
 * Screen-level coverage for the haptic verbs the Login screen
 * (`app/login.tsx`) fires after the verb-vocabulary refactor in
 * Task #203:
 *
 *   - login/signup success → `useHaptics().play("capture")`
 *     (the same "we got it" verb every other save uses)
 *   - login/signup failure → `useHaptics().play("error")`
 *
 * These are the only two haptic calls the screen makes through the
 * `useHaptics()` surface (a separate iOS selection tick on the
 * mode-toggle pill stays on `expo-haptics` directly and is out of
 * scope for the verb refactor). Pinning both sides here means a
 * future refactor can't silently regress to the wrong verb (e.g.
 * "streak-extended" on success, or no haptic at all on error) —
 * either of which would make sign-in feel either over-celebratory
 * or eerily silent.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockPlay = jest.fn();
const mockLogin = jest.fn();
const mockSignup = jest.fn();

jest.mock("@/lib/haptics", () => {
  const actual = jest.requireActual("@/lib/haptics");
  return {
    ...actual,
    useHaptics: () => ({ play: mockPlay }),
  };
});

// `LoginScreen` calls both `Redirect` (declarative redirect when
// `user` is non-null) and `useRouter` (used elsewhere in the screen
// for imperative navigation hooks). The earlier mock only stubbed
// `Redirect`, which made the `useRouter()` call blow up with
// "useRouter is not a function" before render even reached the
// haptic call sites we're trying to pin.
jest.mock("expo-router", () => ({
  Redirect: () => null,
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-linear-gradient", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    LinearGradient: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      ReactLib.createElement(RNView, { style }, children),
  };
});

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#000",
    foreground: "#fff",
    card: "#111",
    border: "#222",
    input: "#111",
    primary: "#a78bfa",
    destructive: "#ef4444",
    mutedForeground: "#999",
  }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    login: mockLogin,
    signup: mockSignup,
    user: null,
    hasSeenOnboarding: false,
  }),
}));

// The login screen wraps the form in a stack of "alive" presentation
// components (gradient bg, ambient blobs, rotating brand mark, settle-
// on-mount). They all run animations against the reanimated mock and
// none of them affect the haptic call sites we're pinning, so we stub
// them flat to keep the render tree minimal and deterministic.
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

jest.mock("@/components/alive/GradientBackground", () => ({
  GradientBackground: () => null,
}));
jest.mock("@/components/alive/AmbientBlobs", () => ({
  AmbientBlobs: () => null,
}));
jest.mock("@/components/alive/RotatingBrandMark", () => ({
  RotatingBrandMark: () => null,
}));
jest.mock("@/components/alive/AuthCinematicStage", () => {
  const ReactLib = require("react");
  return {
    AuthCinematicStage: ReactLib.forwardRef(
      (
        { onSettle }: { onSettle?: () => void },
        ref: React.Ref<{ skip: () => void }>,
      ) => {
        ReactLib.useImperativeHandle(ref, () => ({ skip: () => {} }), []);
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

// GradientButton is the actual submit affordance — replace it with a
// plain Pressable so fireEvent.press hits handleSubmit directly. The
// real button's gradient/scale-press chain still pipes onPress
// through, but stubbing keeps the test independent of any Pressable
// nesting drift inside GradientButton itself.
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

import LoginScreen from "./login";

beforeEach(() => {
  mockPlay.mockReset();
  mockLogin.mockReset();
  mockSignup.mockReset();
});

describe("LoginScreen — useHaptics().play verbs after the Task #203 verb refactor", () => {
  test("successful login fires play('capture') — the same 'we got it' verb every other save uses", async () => {
    mockLogin.mockResolvedValueOnce(undefined);

    const view = render(<LoginScreen />);
    fireEvent.changeText(view.getByPlaceholderText("Email"), "user@example.com");
    fireEvent.changeText(view.getByPlaceholderText("Password"), "correct-horse");

    await act(async () => {
      fireEvent.press(view.getByText("Sign In"));
    });

    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(mockLogin).toHaveBeenCalledWith("user@example.com", "correct-horse");
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("capture");
  });

  test("login failure fires play('error') — the calm 'MemTool says no' two-thump verb", async () => {
    // mockImplementationOnce (not mockRejectedValueOnce) — the eager
    // form trips jest's unhandled-rejection watcher and can deadlock
    // act() on async submits, same as the capture/log-call tests.
    mockLogin.mockImplementationOnce(() =>
      Promise.reject(new Error("Invalid credentials")),
    );

    const view = render(<LoginScreen />);
    fireEvent.changeText(view.getByPlaceholderText("Email"), "user@example.com");
    fireEvent.changeText(view.getByPlaceholderText("Password"), "wrong-pass");

    await act(async () => {
      fireEvent.press(view.getByText("Sign In"));
    });

    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("error");
  });

  test("validation early-exit (empty fields) fires NO haptic — neither success nor error verb", async () => {
    // The handler bails before the try/catch when the email or
    // password is empty, which means there's no auth attempt and so
    // there must be no haptic either. A future refactor that moved
    // a play() call above the validation check would make every
    // empty submit feel like an outcome, which is wrong.
    const view = render(<LoginScreen />);

    await act(async () => {
      fireEvent.press(view.getByText("Sign In"));
    });

    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });
});
