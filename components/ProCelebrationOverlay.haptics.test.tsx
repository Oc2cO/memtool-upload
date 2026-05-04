/**
 * Component-level coverage for the haptic verb the Pro celebration
 * overlay (`components/ProCelebrationOverlay.tsx`) fires after the
 * Task #203 verb refactor:
 *
 *   - mounting `visible={true}` → `useHaptics().play("streak-extended")`
 *
 * The Pro upgrade is a milestone moment, so it deliberately reuses
 * the rising three-tap "streak-extended" crescendo instead of the
 * generic system success buzz. Pinning the verb here means a future
 * refactor of the entrance effect can't silently drop it back to
 * "capture" (which is the everyday save verb) or to no haptic at all.
 *
 * Also pins the negative case: rendering with `visible={false}` must
 * not pre-fire the celebration haptic — the overlay is mounted but
 * hidden in some parent flows, and a phantom buzz before the user
 * sees the card would feel like a bug.
 */
import React from "react";
import { render } from "@testing-library/react-native";

const mockPlay = jest.fn();

jest.mock("@/lib/haptics", () => {
  const actual = jest.requireActual("@/lib/haptics");
  return {
    ...actual,
    useHaptics: () => ({ play: mockPlay }),
  };
});

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#000",
    foreground: "#fff",
    card: "#111",
    border: "#222",
    primary: "#a78bfa",
    secondary: "#5eead4",
    mutedForeground: "#999",
  }),
}));

// The overlay layers a gradient + ambient blobs + rotating brand mark
// behind the celebration card. None of those touch the haptic call
// site we're pinning, so flatten them to keep the render tree light.
jest.mock("@/components/alive/GradientBackground", () => ({
  GradientBackground: () => null,
}));
jest.mock("@/components/alive/AmbientBlobs", () => ({
  AmbientBlobs: () => null,
}));
jest.mock("@/components/alive/RotatingBrandMark", () => ({
  RotatingBrandMark: () => null,
}));

import { ProCelebrationOverlay } from "./ProCelebrationOverlay";

beforeEach(() => {
  mockPlay.mockReset();
});

describe("ProCelebrationOverlay — haptic verb after the Task #203 verb refactor", () => {
  test("mounting visible=true fires play('streak-extended') — the milestone crescendo, not the everyday save buzz", () => {
    render(
      <ProCelebrationOverlay
        visible={true}
        onDismiss={jest.fn()}
        unlocks={["Unlimited captures", "Cross-device sync"]}
      />,
    );

    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("streak-extended");
  });

  test("mounting visible=false does NOT pre-fire the celebration haptic", () => {
    // Some parents mount the overlay hidden and flip `visible` later.
    // A phantom buzz before the user actually sees the card would
    // feel like a bug — the entrance verb must wait for visibility.
    render(
      <ProCelebrationOverlay
        visible={false}
        onDismiss={jest.fn()}
        unlocks={["Unlimited captures"]}
      />,
    );

    expect(mockPlay).not.toHaveBeenCalled();
  });

  test("flipping hidden → visible fires play('streak-extended') exactly once", () => {
    // Pin the contract for the lazy-mount pattern: the haptic must
    // fire on the visibility transition, not on every prop change
    // afterwards.
    const view = render(
      <ProCelebrationOverlay
        visible={false}
        onDismiss={jest.fn()}
        unlocks={["Unlimited captures"]}
      />,
    );
    expect(mockPlay).not.toHaveBeenCalled();

    view.rerender(
      <ProCelebrationOverlay
        visible={true}
        onDismiss={jest.fn()}
        unlocks={["Unlimited captures"]}
      />,
    );

    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("streak-extended");
  });
});
