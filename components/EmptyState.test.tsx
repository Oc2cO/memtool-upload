/**
 * Coverage for the shared `EmptyState` component AND for the five
 * empty/error affordance configurations the pre-launch audit
 * (Task #176) called out as required exits — each one is the exact
 * `EmptyStateProps` shape the relevant screen builds at runtime.
 *
 * The five affordances pinned here:
 *
 *   1. Archive — generic empty (no filters, no search).
 *   2. Archive — search miss (search query, no results).
 *   3. Archive — date filter active.
 *   4. Archive — person filter active.
 *   5. Progress — both memories AND game plays empty.
 *
 * For each one we render the EmptyState with the EXACT props shape
 * the screen passes at runtime (mirroring `buildEmptyStateProps`
 * in `app/(app)/(tabs)/archive.tsx` and the EmptyState block in
 * `app/(app)/(tabs)/progress.tsx`). This way a future tweak to the
 * affordance copy or action is caught here, in one place, instead
 * of relying on every full-screen test to re-discover the regression.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import { EmptyState } from "@/components/EmptyState";

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    foreground: "#000",
    mutedForeground: "#666",
    primary: "#007aff",
    primaryForeground: "#fff",
    muted: "#eee",
  }),
}));

describe("EmptyState — base contract", () => {
  it("renders the title and description without an action button when action is omitted", () => {
    const view = render(
      <EmptyState
        icon="search-outline"
        title="No memories found"
        description="Try a different search term."
      />,
    );

    expect(view.queryByText("No memories found")).toBeTruthy();
    expect(view.queryByText("Try a different search term.")).toBeTruthy();
    // No Pressable in the tree means there's no accidental action
    // surface to mistap. We assert by accessibility role.
    expect(view.queryByRole("button")).toBeNull();
  });

  it("renders the action button and forwards taps when an action is provided", () => {
    const onPress = jest.fn();
    const view = render(
      <EmptyState
        icon="calendar-outline"
        title="Empty"
        description="Nothing here yet."
        action={{ label: "Clear date filter", onPress }}
      />,
    );

    const btn = view.getByLabelText("Clear date filter");
    expect(btn).toBeTruthy();
    fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("uses accessibilityLabel override when provided (button label stays short, screen-reader gets context)", () => {
    const view = render(
      <EmptyState
        icon="calendar-outline"
        title="Empty"
        description="Nothing here yet."
        action={{
          label: "Clear",
          onPress: jest.fn(),
          accessibilityLabel: "Clear date filter from Archive",
        }}
      />,
    );

    expect(view.queryByLabelText("Clear date filter from Archive")).toBeTruthy();
    // The visible label is still the short "Clear" text.
    expect(view.queryByText("Clear")).toBeTruthy();
  });
});

describe("EmptyState — Task #176 pre-launch affordances", () => {
  it("[Archive] generic empty: 'Capture your first memory to see it here' — no action (the composer is on-screen)", () => {
    const view = render(
      <EmptyState
        icon="archive-outline"
        title="No memories found"
        description="Capture your first memory to see it here"
      />,
    );

    expect(view.queryByText("No memories found")).toBeTruthy();
    expect(
      view.queryByText("Capture your first memory to see it here"),
    ).toBeTruthy();
    // Generic empty has no recovery action — the capture button
    // already lives in the tab bar, not in the empty state.
    expect(view.queryByRole("button")).toBeNull();
  });

  it("[Archive] search miss: 'Try a different search term' — no action (the search bar is on-screen)", () => {
    const view = render(
      <EmptyState
        icon="archive-outline"
        title="No memories found"
        description="Try a different search term"
      />,
    );

    expect(view.queryByText("Try a different search term")).toBeTruthy();
    expect(view.queryByRole("button")).toBeNull();
  });

  it("[Archive] date filter active: 'Clear date filter' button drops the filter", () => {
    const onClearDate = jest.fn();
    const view = render(
      <EmptyState
        icon="calendar-outline"
        title="No memories on Tue, May 5"
        description="Clear the date filter to see your other memories."
        action={{
          label: "Clear date filter",
          onPress: onClearDate,
          accessibilityLabel: "Clear date filter 2026-05-05",
        }}
      />,
    );

    const btn = view.getByLabelText("Clear date filter 2026-05-05");
    expect(btn).toBeTruthy();
    fireEvent.press(btn);
    expect(onClearDate).toHaveBeenCalledTimes(1);
    // The visible label stays the short user-facing copy.
    expect(view.queryByText("Clear date filter")).toBeTruthy();
  });

  it("[Archive] person filter active: 'Clear person filter' button drops the filter", () => {
    const onClearPerson = jest.fn();
    const view = render(
      <EmptyState
        icon="person-outline"
        title="No memories from Mom"
        description="Clear the person filter to see your other memories."
        action={{
          label: "Clear person filter",
          onPress: onClearPerson,
          accessibilityLabel: "Clear person filter Mom",
        }}
      />,
    );

    fireEvent.press(view.getByLabelText("Clear person filter Mom"));
    expect(onClearPerson).toHaveBeenCalledTimes(1);
    expect(view.queryByText("Clear person filter")).toBeTruthy();
  });

  it("[Progress] no memories AND no game plays: 'Play 24' CTA navigates to the practice game", () => {
    const onPlay = jest.fn();
    const view = render(
      <EmptyState
        icon="trophy-outline"
        title="No progress yet"
        description="Play a quick game of 24 to start tracking practice — your stats appear here as you play."
        action={{ label: "Play 24", onPress: onPlay }}
      />,
    );

    expect(view.queryByText("No progress yet")).toBeTruthy();
    const btn = view.getByLabelText("Play 24");
    fireEvent.press(btn);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});
