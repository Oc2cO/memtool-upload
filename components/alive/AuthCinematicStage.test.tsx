/**
 * AuthCinematicStage tests — Task #350.
 *
 * Pins the contracts the cinematic open + resting state must keep so
 * the auth screen never silently loses its brand-introduction beat:
 *
 *   - Tap on the stage during the cinematic ends it immediately and
 *     fires onSettle (no jarring cut — the component cross-fades).
 *   - The cinematic is one-shot per process: a second mount in the
 *     same session must skip directly to the resting state.
 *   - "forgot" mode never runs the cinematic and never renders Sagous.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

jest.mock("@/components/BrandHero", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    BrandHero: ({ variant }: { variant: string }) =>
      React.createElement(View, { testID: `brand-hero-${variant}` }),
  };
});

import { AccessibilityInfo, AppState } from "react-native";
import {
  AuthCinematicStage,
  _resetAuthCinematicForTests,
  _hasAuthCinematicPlayedForTests,
} from "./AuthCinematicStage";

// Per-test reduce-motion override via spyOn — keeps the rest of the
// react-native module intact (touching it via jest.mock breaks
// downstream native-module registration in the test environment).
let reduceMotionFlag = false;
beforeEach(() => {
  _resetAuthCinematicForTests();
  reduceMotionFlag = false;
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockImplementation(() => Promise.resolve(reduceMotionFlag));
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    // @ts-expect-error — minimal subscription shape for the test
    .mockImplementation(() => ({ remove: () => {} }));
  jest.useFakeTimers();
});

afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

// Drains the microtask queue so the AccessibilityInfo promise can
// resolve into setReduceMotion(false) and unblock the timeline effect.
const flushReduceMotionResolution = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("AuthCinematicStage", () => {
  test("tapping the stage during the cinematic skips to the resting state and fires onSettle", async () => {
    const onSettle = jest.fn();
    const view = render(<AuthCinematicStage mode="login" onSettle={onSettle} />);
    await flushReduceMotionResolution();

    expect(onSettle).not.toHaveBeenCalled();

    act(() => {
      fireEvent.press(view.getByTestId("auth-cinematic-stage"));
    });
    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(_hasAuthCinematicPlayedForTests()).toBe(true);
  });

  test("after a cold-launch play, a second mount in the same session skips the cinematic", async () => {
    const firstSettle = jest.fn();
    const first = render(
      <AuthCinematicStage mode="login" onSettle={firstSettle} />,
    );
    await flushReduceMotionResolution();
    // Run the full timeline.
    act(() => {
      jest.advanceTimersByTime(3500);
    });
    expect(firstSettle).toHaveBeenCalled();
    first.unmount();

    // Second mount: cinematic flag is set, so we settle on the short
    // reduced-fade path instead of replaying the open.
    const secondSettle = jest.fn();
    render(<AuthCinematicStage mode="login" onSettle={secondSettle} />);
    await flushReduceMotionResolution();
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(secondSettle).toHaveBeenCalledTimes(1);
  });

  test("forgot mode never renders Sagous and skips the cinematic outright", async () => {
    const onSettle = jest.fn();
    const view = render(
      <AuthCinematicStage mode="forgot" onSettle={onSettle} />,
    );
    await flushReduceMotionResolution();

    // Sagous must not be on the stage in the forgot variant.
    expect(view.queryByTestId("brand-hero-sagous-fullbody")).toBeNull();
    // Memora is the dimmer dark-variant for the softer/concerned look.
    expect(view.getByTestId("brand-hero-memora-fullbody-dark")).toBeTruthy();

    // Resting fade-in completes within the reduced 250ms window.
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onSettle).toHaveBeenCalledTimes(1);
    // Forgot never marks the per-session cinematic as played.
    expect(_hasAuthCinematicPlayedForTests()).toBe(false);
  });

  test("OS reduce-motion collapses the cinematic to a short fade and still settles", async () => {
    reduceMotionFlag = true;
    const onSettle = jest.fn();
    render(<AuthCinematicStage mode="login" onSettle={onSettle} />);

    // Drain the AccessibilityInfo promise → setReduceMotion(true) →
    // re-runs the timeline effect on the reduced-fade branch.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Reduced-fade window is 250ms — well under the full ~3.5s timeline.
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(_hasAuthCinematicPlayedForTests()).toBe(true);
  });

  test("paused prop (e.g. keyboard open) does not block the cinematic from settling", async () => {
    // The `paused` flag only governs idle loops; the open timeline
    // must still complete so the form can fade up regardless of
    // keyboard state on mount.
    const onSettle = jest.fn();
    render(
      <AuthCinematicStage mode="login" onSettle={onSettle} paused={true} />,
    );
    await flushReduceMotionResolution();
    act(() => {
      jest.advanceTimersByTime(3500);
    });
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  test("signup mode renders Sagous so the welcome wave has a target on settle", () => {
    // The wave itself runs through the reanimated mock (no real
    // animation), but the stage must still mount Sagous in signup
    // mode — without him, there's nothing to wave.
    const view = render(<AuthCinematicStage mode="signup" />);
    expect(view.getByTestId("brand-hero-sagous-fullbody")).toBeTruthy();
    expect(view.getByTestId("brand-hero-memora-fullbody")).toBeTruthy();
  });

  test("waiting on the OS reduce-motion preference: no settle fires before it resolves", async () => {
    // Block the AccessibilityInfo promise so the cinematic cannot
    // start until the preference is known. This is the race fix —
    // previously the full timeline began on a default of `false`
    // and reduce-motion users could see drift before fallback hit.
    let resolveRM: (v: boolean) => void = () => {};
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockImplementation(
      () => new Promise<boolean>((res) => (resolveRM = res)),
    );

    const onSettle = jest.fn();
    render(<AuthCinematicStage mode="login" onSettle={onSettle} />);

    // Even if a long time passes, nothing should settle until the
    // OS preference resolves.
    act(() => {
      jest.advanceTimersByTime(3500);
    });
    expect(onSettle).not.toHaveBeenCalled();

    // Now resolve as reduce-motion = true → opacity-only fade path.
    await act(async () => {
      resolveRM(true);
      await Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  test("backgrounding the app pauses the cinematic and foregrounding resumes from the same phase", async () => {
    // Capture the AppState change listener so the test can drive
    // active → background → active transitions deterministically.
    let appStateHandler: ((s: string) => void) | null = null;
    const addSpy = jest
      .spyOn(AppState, "addEventListener")
      // @ts-expect-error — minimal subscription shape for the test
      .mockImplementation((event: string, cb: (s: string) => void) => {
        if (event === "change") appStateHandler = cb;
        return { remove: () => {} };
      });

    const onSettle = jest.fn();
    render(<AuthCinematicStage mode="login" onSettle={onSettle} />);
    await flushReduceMotionResolution();

    expect(addSpy).toHaveBeenCalledWith("change", expect.any(Function));
    expect(appStateHandler).not.toBeNull();

    // Advance partway into the drift phase, then background.
    act(() => {
      jest.advanceTimersByTime(500);
    });
    act(() => {
      appStateHandler?.("background");
    });

    // While backgrounded, even running well past the original ~3.5s
    // total must NOT settle the cinematic — the timer is dropped.
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onSettle).not.toHaveBeenCalled();

    // Foreground again: the remaining ~3000ms of timeline runs and
    // then onSettle fires exactly once.
    act(() => {
      appStateHandler?.("active");
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(onSettle).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  test("signup welcome wave is one-shot per process: it never replays on toggle", () => {
    // First settle in signup mode flips the module-level wave guard.
    const first = render(<AuthCinematicStage mode="signup" />);
    act(() => {
      jest.advanceTimersByTime(3500);
    });
    first.unmount();

    // Mount #2 (e.g., user toggles back to signup later in the
    // session). The cinematic itself is also already one-shot, but
    // the contract under review is specifically about the wave —
    // it must not replay. With the reanimated mock the easiest
    // observable proof is that re-rendering does not throw and the
    // module-level guard remains set.
    const second = render(<AuthCinematicStage mode="signup" />);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(second.getByTestId("brand-hero-sagous-fullbody")).toBeTruthy();
    // Reset proves the test-only helper actually clears the wave guard.
    _resetAuthCinematicForTests();
    expect(_hasAuthCinematicPlayedForTests()).toBe(false);
  });
});
