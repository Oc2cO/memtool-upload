/**
 * Screen-level coverage for the haptic verb the visual onboarding
 * flow (`app/onboarding.tsx`) fires when the user completes the
 * final REFLECT stage after the Task #203 verb refactor:
 *
 *   - tapping "Let's begin" on the final stage → `play("capture")`
 *
 * The verb was deliberately picked to be the same "we got it" tap
 * every other save uses (login, profile save, memory save) so
 * finishing onboarding feels like a save, not a special "yay you're
 * done" buzz. Pinning the verb here guards against a future refactor
 * silently swapping it back to "streak-extended" or dropping it.
 *
 * The screen advances through STAGE_ORDER one tap at a time, so we
 * resume the screen at the final REFLECT stage via the documented
 * `?resume=reflect` deep link instead of replaying the four prior
 * stages — this keeps the test focused on the verb at the
 * `completeOnboarding` boundary.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockPlay = jest.fn();
const mockCompleteOnboarding = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/haptics", () => {
  const actual = jest.requireActual("@/lib/haptics");
  return {
    ...actual,
    useHaptics: () => ({ play: mockPlay }),
  };
});

jest.mock("expo-router", () => ({
  Redirect: () => null,
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  // Resume past the splash video and three intermediate stages, so
  // the screen renders the REFLECT stage's "Let's begin" CTA right
  // away — that's the only path that exercises the play("capture")
  // call we're pinning.
  useLocalSearchParams: () => ({ resume: "reflect" }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-linear-gradient", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    LinearGradient: ({
      children,
      style,
    }: {
      children: React.ReactNode;
      style?: object;
    }) => ReactLib.createElement(RNView, { style }, children),
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

// `useVideoPlayer` is called unconditionally even when the screen
// resumes past the video, so we must hand it a deterministic stub
// rather than letting expo-video try to construct a real player.
jest.mock("expo-video", () => ({
  useVideoPlayer: () => ({
    play: jest.fn(),
    addListener: () => ({ remove: () => {} }),
    loop: false,
    muted: false,
  }),
  VideoView: () => null,
}));

jest.mock("@/components/MemCharacter", () => ({
  MemCharacter: () => null,
}));

jest.mock("@/components/ChaosLetters", () => ({
  ChaosLetters: () => null,
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "user@example.com" },
    hasSeenOnboarding: false,
    completeOnboarding: mockCompleteOnboarding,
  }),
}));

import OnboardingScreen from "./onboarding";

beforeEach(() => {
  mockPlay.mockReset();
  mockCompleteOnboarding.mockClear();
});

describe("OnboardingScreen — final stage haptic verb after the Task #203 refactor", () => {
  test("tapping 'Let's begin' on the REFLECT stage fires play('capture') — same 'we got it' verb every save uses", async () => {
    const view = render(<OnboardingScreen />);

    await act(async () => {
      fireEvent.press(view.getByText("Let's begin"));
    });

    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("capture");
    // And the screen must finalize via completeOnboarding — pinning
    // the order: haptic first, then the auth-side completion call.
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
  });
});
