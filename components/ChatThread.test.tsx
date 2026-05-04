/**
 * Render coverage for the Task #284 modernized messenger-style
 * composer + the new `aboveInput` slot on `ChatThread`. The two
 * facts we pin here are what users actually see on the opening tour:
 *
 *   1. The circular send button only becomes accessible/pressable
 *      once the trimmed input is non-empty. Before any text is
 *      typed, it's hidden (`pointerEvents="none"` + opacity 0) so
 *      it never competes visually with the placeholder.
 *
 *   2. `ChatThread` only renders the `aboveInput` skip-link slot
 *      when the parent provides it — onboarding passes the link
 *      (Task #284 step 3), AI chat leaves it empty.
 *
 * These facts are not covered by the existing screen-level haptic
 * tests (which mock the whole ChatThread away), so without this
 * file a future refactor could silently break either invariant.
 */
import React from "react";
import { AccessibilityInfo, StyleSheet, Text } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";

import {
  ChatThread,
  FreeTextInput,
  type ChatMessage,
} from "@/components/ChatThread";

const PALETTE = {
  bg: "#0a0612",
  bgDeep: "#050309",
  mem: "#FFD56F",
  hot: "#B47AFF",
  cool: "#6FE5FF",
  pink: "#FF8FB1",
  text: "#F4EEFF",
  textMuted: "#9B91B5",
  card: "rgba(180, 122, 255, 0.10)",
  border: "rgba(180, 122, 255, 0.25)",
};

// MemCharacter pulls in expo-svg paths we don't need for these
// assertions; stubbing it keeps the test focused on the composer +
// aboveInput plumbing.
jest.mock("@/components/MemCharacter", () => ({
  MemCharacter: () => null,
}));

// FrostBackground pulls in expo-blur which is heavy and irrelevant
// to what we're asserting. Stub to a no-op view.
jest.mock("@/components/alive/FrostBackground", () => ({
  FrostBackground: () => null,
}));

describe("FreeTextInput — Task #284 messenger composer reveal", () => {
  test("the circular send button is hidden (pointerEvents=none, opacity 0) until text is entered", () => {
    const view = render(
      <FreeTextInput
        skippable={false}
        onSubmit={jest.fn()}
        palette={PALETTE}
      />,
    );

    const sendBtn = view.getByLabelText("Send your answer");
    // The Pressable itself sits inside the Animated.View wrapper.
    // The wrapper's `pointerEvents="none"` is what guarantees the
    // button can't be tapped before the user types — pin that
    // explicitly via the Pressable's `accessibilityState`.
    expect(sendBtn.props.accessibilityState?.disabled).toBe(true);
  });

  test("typing into the field flips the send button's disabled state and pressing it fires onSubmit with the trimmed value", () => {
    const onSubmit = jest.fn();
    const view = render(
      <FreeTextInput
        skippable={false}
        onSubmit={onSubmit}
        palette={PALETTE}
      />,
    );

    fireEvent.changeText(
      view.getByLabelText("Your answer to Mem"),
      "  hello mem  ",
    );

    const sendBtn = view.getByLabelText("Send your answer");
    expect(sendBtn.props.accessibilityState?.disabled).toBe(false);

    fireEvent.press(sendBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("hello mem");
  });

  test("send button reports busy + stays inert when the parent flips disabled=true mid-send", () => {
    const onSubmit = jest.fn();
    const view = render(
      <FreeTextInput
        skippable={false}
        onSubmit={onSubmit}
        palette={PALETTE}
      />,
    );

    // Type first — must happen while the field is still editable, so
    // the value lands in state. Then the parent flips `disabled=true`
    // (its in-flight send guard) via rerender.
    fireEvent.changeText(
      view.getByLabelText("Your answer to Mem"),
      "in flight",
    );
    view.rerender(
      <FreeTextInput
        skippable={false}
        disabled
        onSubmit={onSubmit}
        palette={PALETTE}
      />,
    );

    const sendBtn = view.getByLabelText("Send your answer");
    // While the parent's send is in flight the button reports
    // busy=true and stays accessibility-disabled so a double-tap
    // can't queue a duplicate send.
    expect(sendBtn.props.accessibilityState?.busy).toBe(true);
    expect(sendBtn.props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(sendBtn);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("ChatThread — keyboard-lift surface animation (Task #284 polish)", () => {
  // The keyboard-controller jest mock returns the *same* shared-value
  // object each call (see node_modules/react-native-keyboard-controller/
  // jest/index.js). Mutating `.value` and re-rendering re-invokes the
  // `useAnimatedStyle` worklet under the reanimated mock
  // (`IMMEDIATE_CALLBACK_INVOCATION`), so the resulting style on the
  // composer surface picks up the new progress.
  const kbProgress = useReanimatedKeyboardAnimation().progress;

  beforeEach(() => {
    kbProgress.value = 0;
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockReturnValue({ remove: jest.fn() } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("composer surface translates up and ramps shadow as the keyboard progress advances", async () => {
    const view = render(
      <ChatThread
        messages={[{ id: "m1", role: "mem", text: "Hi" }]}
        showTyping={false}
        input={
          <FreeTextInput
            skippable={false}
            onSubmit={jest.fn()}
            palette={PALETTE}
          />
        }
        palette={PALETTE}
      />,
    );

    // Flush the async `isReduceMotionEnabled().then(setReduce)` so we
    // know we're measuring the *animated* path, not the RM fallback.
    await act(async () => {});

    const surface = view.getByTestId("chat-composer-surface");
    const restingStyle = StyleSheet.flatten(surface.props.style);
    expect(restingStyle.transform).toEqual([{ translateY: -0 }]);
    expect(restingStyle.shadowOpacity).toBeCloseTo(0.04, 5);

    // Simulate the keyboard fully open. Re-render so the worklet
    // re-evaluates against the new progress value.
    kbProgress.value = 1;
    view.rerender(
      <ChatThread
        messages={[{ id: "m1", role: "mem", text: "Hi" }]}
        showTyping={false}
        input={
          <FreeTextInput
            skippable={false}
            onSubmit={jest.fn()}
            palette={PALETTE}
          />
        }
        palette={PALETTE}
      />,
    );

    const liftedStyle = StyleSheet.flatten(
      view.getByTestId("chat-composer-surface").props.style,
    );
    // Magnitudes are intentionally tiny per ChatThread.tsx — pin them
    // here so a future tweak to the lift formula has to update this
    // test consciously rather than silently regress the polish.
    expect(liftedStyle.transform).toEqual([{ translateY: -4 }]);
    expect(liftedStyle.shadowOpacity).toBeCloseTo(0.18, 5);
  });

  test("keyboard-lift is suppressed entirely when Reduce Motion is on", async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(
      true,
    );

    const tree = (
      <ChatThread
        messages={[{ id: "m1", role: "mem", text: "Hi" }]}
        showTyping={false}
        input={
          <FreeTextInput
            skippable={false}
            onSubmit={jest.fn()}
            palette={PALETTE}
          />
        }
        palette={PALETTE}
      />
    );

    const view = render(tree);

    // Flush the RM-enabled state into the surface's worklet.
    await act(async () => {});

    const restingStyle = StyleSheet.flatten(
      view.getByTestId("chat-composer-surface").props.style,
    );

    // Drive the keyboard fully open. Under the RM branch the worklet
    // returns `{}`, so the surface style must be unchanged from rest.
    kbProgress.value = 1;
    await act(async () => {
      view.rerender(tree);
    });

    const liftedStyle = StyleSheet.flatten(
      view.getByTestId("chat-composer-surface").props.style,
    );
    expect(liftedStyle.transform).toBeUndefined();
    // Whatever base shadowOpacity the surface sheet sets must not
    // change as the keyboard opens — the RM branch produces no ramp.
    expect(liftedStyle.shadowOpacity).toBe(restingStyle.shadowOpacity);
  });
});

describe("ChatThread — Reduce Motion fallbacks skip springs (Task #284)", () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockReturnValue({ remove: jest.fn() } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a freshly mounted bubble skips the spring transform when Reduce Motion is on", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true);
    const withSpringSpy = jest.spyOn(Reanimated, "withSpring");

    const view = render(
      <ChatThread
        messages={[{ id: "m1", role: "mem", text: "Hi" }]}
        showTyping={false}
        palette={PALETTE}
      />,
    );

    // Flush isReduceMotionEnabled → true. Bubble's first effect ran
    // with reduceMotion=false (initial state); when RM flips, deps
    // change and the effect re-runs through the early-return branch.
    await act(async () => {});

    // Clear so the only calls we measure are from the *new* bubble
    // mounting under reduceMotion=true.
    withSpringSpy.mockClear();

    view.rerender(
      <ChatThread
        messages={[
          { id: "m1", role: "mem", text: "Hi" },
          { id: "m2", role: "user", text: "Hello" },
        ]}
        showTyping={false}
        palette={PALETTE}
      />,
    );

    // Only the fade `withTiming` should fire on the new bubble — no
    // spring on translateX/translateY/scale under Reduce Motion.
    expect(withSpringSpy).not.toHaveBeenCalled();
  });

  test("control: with Reduce Motion off, a freshly mounted bubble does run the spring transforms", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false);
    const withSpringSpy = jest.spyOn(Reanimated, "withSpring");

    const view = render(
      <ChatThread
        messages={[{ id: "m1", role: "mem", text: "Hi" }]}
        showTyping={false}
        palette={PALETTE}
      />,
    );

    await act(async () => {});
    withSpringSpy.mockClear();

    view.rerender(
      <ChatThread
        messages={[
          { id: "m1", role: "mem", text: "Hi" },
          { id: "m2", role: "user", text: "Hello" },
        ]}
        showTyping={false}
        palette={PALETTE}
      />,
    );

    // ty, tx, scale all spring in (count may be doubled by React's
    // dev-mode effect double-invoke; we only care that the spring
    // path *did* fire, in contrast to the RM branch above where it
    // didn't fire at all).
    expect(withSpringSpy).toHaveBeenCalled();
  });

  test("the circular send button skips its scale spring when Reduce Motion is on", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true);
    const withSpringSpy = jest.spyOn(Reanimated, "withSpring");

    const view = render(
      <FreeTextInput
        skippable={false}
        onSubmit={jest.fn()}
        palette={PALETTE}
      />,
    );

    // Flush RM→true so the next visibility flip runs through the
    // CircularSendButton's early-return branch.
    await act(async () => {});
    withSpringSpy.mockClear();

    fireEvent.changeText(
      view.getByLabelText("Your answer to Mem"),
      "hi",
    );

    // Visibility just flipped false→true. The non-RM branch would
    // call `withSpring` to scale the button in; the RM branch
    // assigns scale.value = 1 directly.
    expect(withSpringSpy).not.toHaveBeenCalled();
  });
});

describe("ChatThread — aboveInput slot only renders when provided", () => {
  const messages: ChatMessage[] = [
    { id: "m1", role: "mem", text: "Hi" },
  ];

  test("renders the aboveInput node when the parent passes one", () => {
    const view = render(
      <ChatThread
        messages={messages}
        showTyping={false}
        input={
          <FreeTextInput
            skippable={false}
            onSubmit={jest.fn()}
            palette={PALETTE}
          />
        }
        aboveInput={<Text>Skip — Mem will learn as we go</Text>}
        palette={PALETTE}
      />,
    );

    expect(view.queryByText("Skip — Mem will learn as we go")).not.toBeNull();
  });

  test("omits the aboveInput slot when the parent leaves it unset (AI chat path)", () => {
    const view = render(
      <ChatThread
        messages={messages}
        showTyping={false}
        input={
          <FreeTextInput
            skippable={false}
            onSubmit={jest.fn()}
            palette={PALETTE}
          />
        }
        palette={PALETTE}
      />,
    );

    expect(view.queryByText("Skip — Mem will learn as we go")).toBeNull();
  });
});
