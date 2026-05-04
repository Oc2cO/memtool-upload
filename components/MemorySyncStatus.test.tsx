import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

// useColors reads the system color scheme via expo modules; stub it to
// a deterministic palette so we don't have to boot the appearance
// machinery for a label-only assertion.
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#000",
    mutedForeground: "#888",
  }),
}));

import { MemorySyncStatus } from "./MemorySyncStatus";

const RETRY_BADGE_LABEL = "Saved offline, tap to retry sync";
const RETRY_BADGE_HINT = "Retries syncing this memory";
const PENDING_LABEL = "Syncing now";

describe("MemorySyncStatus — pending state", () => {
  // The previous regression these tests guard: when an `onRetry` was
  // wired, the pending branch reused the failed branch's "Saved
  // offline, tap to retry sync" label AND wrapped the indicator in a
  // Pressable that fired a redundant retry. A mid-flight row is NOT
  // offline and the "retry" was a no-op (the outbox lock serializes
  // it behind the already-in-flight attempt). Both behaviors are now
  // locked down here.

  test("without onRetry: announces 'Syncing now' as a passive image", () => {
    const view = render(<MemorySyncStatus status="pending" />);

    const badge = view.getByLabelText(PENDING_LABEL);
    expect(badge.props.accessibilityRole).toBe("image");
    // No action exists, so no hint should be exposed.
    expect(badge.props.accessibilityHint).toBeUndefined();
    // The failed-state retry copy must not leak onto a pending row.
    expect(view.queryByLabelText(RETRY_BADGE_LABEL)).toBeNull();
    expect(view.queryByHintText(RETRY_BADGE_HINT)).toBeNull();
  });

  test("with onRetry: still passive, still 'Syncing now', NEVER 'Saved offline'", () => {
    const onRetry = jest.fn();
    const view = render(
      <MemorySyncStatus status="pending" onRetry={onRetry} />,
    );

    const badge = view.getByLabelText(PENDING_LABEL);

    // The whole point of this regression guard: even when an onRetry
    // handler is supplied, the pending state must not pretend the row
    // is offline and must not advertise a retry action.
    expect(badge.props.accessibilityRole).toBe("image");
    expect(badge.props.accessibilityRole).not.toBe("button");
    expect(badge.props.accessibilityHint).toBeUndefined();
    expect(view.queryByLabelText(RETRY_BADGE_LABEL)).toBeNull();
    expect(view.queryByHintText(RETRY_BADGE_HINT)).toBeNull();
  });

  test("with onRetry: pressing the badge does NOT fire the redundant retry", () => {
    const onRetry = jest.fn();
    const view = render(
      <MemorySyncStatus status="pending" onRetry={onRetry} />,
    );

    // Press the badge node directly. A passive View has no onPress so
    // fireEvent.press should be a no-op; this asserts that we did not
    // regress to a Pressable that would queue a duplicate sync attempt
    // behind the in-flight outbox drain.
    const badge = view.getByLabelText(PENDING_LABEL);
    fireEvent.press(badge);

    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe("MemorySyncStatus — failed state (unchanged)", () => {
  // Sanity: the failed branch is the one that legitimately announces
  // "Saved offline, tap to retry sync". Keeping a small assertion here
  // makes it obvious if a refactor accidentally moved the retry
  // affordance off of the failed state too.

  test("with onRetry: exposes the retry button label + hint and fires onRetry on press", () => {
    const onRetry = jest.fn();
    const view = render(
      <MemorySyncStatus status="failed" onRetry={onRetry} />,
    );

    const badge = view.getByLabelText(RETRY_BADGE_LABEL);
    expect(badge.props.accessibilityRole).toBe("button");
    expect(badge.props.accessibilityHint).toBe(RETRY_BADGE_HINT);

    fireEvent.press(badge);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
