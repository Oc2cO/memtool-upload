/**
 * Screen-level coverage for the haptic verb the onboarding-chat flow
 * (`app/onboarding-chat.tsx`) fires when the celebration moment
 * resolves after the Task #203 verb refactor:
 *
 *   - `handleCelebrationDone` (auto-fired after the celebration's
 *     CELEBRATION.durationMs window) → `play("capture")`
 *
 * The verb was picked so that finishing the chat feels like a save,
 * matching the rest of the app (login, profile save, memory save)
 * instead of being a one-off celebration buzz. Pinning the verb here
 * guards against a future refactor silently swapping it back to
 * "streak-extended" or dropping it.
 *
 * The chat screen normally advances through ONBOARDING_SCRIPT one
 * turn at a time, but the verb we're pinning lives all the way at
 * the end (after `completeChat` flips phase to "celebrate" and the
 * LockedCelebration auto-resolves). Replaying every script turn
 * would make this test brittle and slow, so we mock the script as
 * empty — `completeChat` then fires immediately on first effect tick
 * and the celebration window resolves under fake timers.
 */
import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render } from "@testing-library/react-native";

const mockPlay = jest.fn();
const mockSaveProfile = jest.fn().mockResolvedValue(undefined);
const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();

jest.mock("@/lib/haptics", () => {
  const actual = jest.requireActual("@/lib/haptics");
  return {
    ...actual,
    useHaptics: () => ({ play: mockPlay }),
  };
});

// Keep the script empty so `completeChat` runs on the very first
// effect — the test is about the celebration verb, not the chat
// progression. CELEBRATION.durationMs is kept short so fake timers
// can cleanly resolve it. SKIP_ALL_LABEL just needs to be a string.
jest.mock("@/lib/onboardingChat", () => ({
  ONBOARDING_SCRIPT: [],
  CELEBRATION: { durationMs: 50, message: "Saved" },
  SKIP_ALL_LABEL: "Skip",
}));

jest.mock("@/lib/profile", () => ({
  buildProfileFromAnswers: () => ({}),
}));

jest.mock("expo-router", () => ({
  Redirect: () => null,
  useRouter: () => ({
    back: mockRouterBack,
    replace: mockRouterReplace,
    push: jest.fn(),
  }),
  // No `from` param → not a reset flow → handleCelebrationDone
  // routes via router.replace into the visual onboarding tour. We
  // don't assert on the route here; the verb is what matters.
  useLocalSearchParams: () => ({}),
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
      children?: React.ReactNode;
      style?: object;
    }) => ReactLib.createElement(RNView, { style }, children),
  };
});

jest.mock("@/components/MemCharacter", () => ({
  MemCharacter: () => null,
}));

jest.mock("@/components/ChatThread", () => ({
  ChatThread: () => null,
  ChipsInput: () => null,
  FreeTextInput: () => null,
  SubmittingOverlay: () => null,
}));

jest.mock("@/components/alive/GradientBackground", () => ({
  GradientBackground: () => null,
}));
jest.mock("@/components/alive/AmbientBlobs", () => ({
  AmbientBlobs: () => null,
}));
jest.mock("@/components/alive/RotatingBrandMark", () => ({
  RotatingBrandMark: () => null,
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    // user.email left blank so completeChat skips the network save
    // entirely and falls straight through to the celebration phase.
    // The verb we're pinning is independent of the save outcome.
    user: { id: "u1", email: "" },
    hasSeenOnboarding: false,
  }),
}));

jest.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({ save: mockSaveProfile }),
}));

import OnboardingChatScreen from "./onboarding-chat";

beforeEach(() => {
  mockPlay.mockReset();
  mockSaveProfile.mockClear();
  mockRouterBack.mockClear();
  mockRouterReplace.mockClear();
  // The LockedCelebration awaits AccessibilityInfo.isReduceMotionEnabled()
  // before scheduling the auto-dismiss timer; resolve it deterministically.
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false);
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockReturnValue({ remove: () => {} } as unknown as ReturnType<
      typeof AccessibilityInfo.addEventListener
    >);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("OnboardingChatScreen — celebration haptic verb after the Task #203 refactor", () => {
  test("handleCelebrationDone (auto-fired after CELEBRATION.durationMs) plays 'capture' — the same 'we got it' verb every save uses", async () => {
    jest.useFakeTimers();
    render(<OnboardingChatScreen />);

    // Two flushes:
    //  1. completeChat sets phase → "celebrate" so LockedCelebration
    //     mounts.
    //  2. AccessibilityInfo.isReduceMotionEnabled() resolves so the
    //     LockedCelebration effect can schedule its auto-dismiss
    //     setTimeout(onDone, CELEBRATION.durationMs).
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Drive the celebration's setTimeout. CELEBRATION.durationMs is
    // mocked to 50ms above; advance well past it to be safe.
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    // Flush any microtasks the timer queued (haptics is sync, but
    // the surrounding state setters can queue follow-up work).
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockPlay).toHaveBeenCalledWith("capture");
    // Exactly once — the celebration moment is a single beat, not a
    // re-fired loop.
    expect(
      mockPlay.mock.calls.filter(([name]) => name === "capture"),
    ).toHaveLength(1);
  });
});
