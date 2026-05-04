/**
 * Coverage for the Archive sync-failure affordance (Task #176 /
 * Task #189). The banner is the user's only signal that one or
 * more captures have been failing to sync for ≥24h, and the
 * Retry / Dismiss buttons are how they recover.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import { SyncWarningBanner } from "@/components/SyncWarningBanner";

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    foreground: "#000",
    mutedForeground: "#666",
    card: "#fff",
    border: "#ccc",
    primary: "#007aff",
    primaryForeground: "#fff",
    destructive: "#f00",
  }),
}));

describe("SyncWarningBanner", () => {
  it("renders nothing when count is 0", () => {
    const view = render(
      <SyncWarningBanner count={0} onRetry={jest.fn()} onDismiss={jest.fn()} />,
    );
    expect(view.queryByLabelText("Retry sync")).toBeNull();
    expect(view.queryByLabelText("Dismiss sync warning")).toBeNull();
  });

  it("singular copy when exactly one memory is stuck", () => {
    const view = render(
      <SyncWarningBanner count={1} onRetry={jest.fn()} onDismiss={jest.fn()} />,
    );
    expect(view.queryByText("1 memory couldn't sync")).toBeTruthy();
  });

  it("plural copy when multiple memories are stuck", () => {
    const view = render(
      <SyncWarningBanner count={3} onRetry={jest.fn()} onDismiss={jest.fn()} />,
    );
    expect(view.queryByText("3 memories couldn't sync")).toBeTruthy();
  });

  it("Retry button forwards to the onRetry handler", () => {
    const onRetry = jest.fn();
    const view = render(
      <SyncWarningBanner count={2} onRetry={onRetry} onDismiss={jest.fn()} />,
    );
    fireEvent.press(view.getByLabelText("Retry sync"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("Dismiss button forwards to the onDismiss handler", () => {
    const onDismiss = jest.fn();
    const view = render(
      <SyncWarningBanner count={2} onRetry={jest.fn()} onDismiss={onDismiss} />,
    );
    fireEvent.press(view.getByLabelText("Dismiss sync warning"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
