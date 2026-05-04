/**
 * Selection-rule coverage for `DateRangePickerModal` (Task #189).
 *
 * The picker is the only entry point for the Recap "Custom" tab,
 * and the contract below is what the recap aggregator silently
 * depends on:
 *
 *   1. Fresh tap = start, second tap = end.
 *   2. A second tap BEFORE the start swaps so the user always ends
 *      up with a valid `start ≤ end` pair (auto-swap).
 *   3. A third tap restarts the selection at the new date.
 *   4. End is clamped to today: future cells are disabled and the
 *      "Next month" chevron is disabled when viewing the current
 *      month.
 *   5. Reopening with `initialRange` reseeds the picker (re-edit).
 *   6. A range longer than MAX_RANGE_DAYS surfaces the
 *      "Range capped at 365 days." warning.
 *
 * Without this file a future refactor of `handleTapDay` could
 * silently break the swap or the restart and ship undetected
 * (the recap aggregator would just produce empty windows).
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import {
  DateRangePickerModal,
  MAX_RANGE_DAYS,
} from "@/components/DateRangePickerModal";

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#fff",
    border: "#ccc",
    primary: "#007aff",
    primaryForeground: "#fff",
    mutedForeground: "#666",
    muted: "#eee",
    destructive: "#f00",
  }),
}));

const mockCaptureHapticPlay = jest.fn();
jest.mock("@/lib/haptics", () => ({
  useHaptic: () => ({ play: mockCaptureHapticPlay }),
}));

// `formatDate` is presentation-only — replace with the raw ISO so
// the tests can pin specific date strings without TZ surprises.
jest.mock("@/lib/dates", () => ({
  formatDate: (s: string) => s,
}));

// Pin "today" to the middle of a month so we have plenty of
// enabled day cells (anything ≤ today) to tap on the current
// month without needing to navigate.
const FIXED_NOW = new Date(2026, 4, 15, 12, 0, 0); // 2026-05-15

describe("DateRangePickerModal — selection rules (Task #189)", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
    mockCaptureHapticPlay.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("MAX_RANGE_DAYS is exported as 365 (used by recap.tsx for the Custom tab cap)", () => {
    expect(MAX_RANGE_DAYS).toBe(365);
  });

  it("first day-tap sets start (Apply disabled), second tap sets end (Apply enabled)", () => {
    const view = render(
      <DateRangePickerModal
        visible
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        initialRange={null}
      />,
    );

    // Initially nothing selected → Apply must be disabled.
    let apply = view.getByLabelText("Apply date range");
    expect(apply.props.accessibilityState?.disabled).toBe(true);

    // Tap a start day in the current visible month.
    fireEvent.press(view.getByLabelText("2026-05-05"));
    apply = view.getByLabelText("Apply date range");
    // One tap → start only → Apply still disabled.
    expect(apply.props.accessibilityState?.disabled).toBe(true);

    // Tap a later end day → range complete → Apply enabled.
    fireEvent.press(view.getByLabelText("2026-05-10"));
    apply = view.getByLabelText("Apply date range");
    expect(apply.props.accessibilityState?.disabled).toBe(false);
  });

  it("auto-swaps when the second tap is BEFORE the first tap (start ≤ end invariant)", () => {
    const onConfirm = jest.fn();
    const view = render(
      <DateRangePickerModal
        visible
        onClose={jest.fn()}
        onConfirm={onConfirm}
        initialRange={null}
      />,
    );

    // Tap the LATER day first as start.
    fireEvent.press(view.getByLabelText("2026-05-10"));
    // Then tap an EARLIER day — handleTapDay must swap so the
    // earlier day becomes start and the prior start becomes end.
    fireEvent.press(view.getByLabelText("2026-05-05"));

    fireEvent.press(view.getByLabelText("Apply date range"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toEqual({
      startDate: "2026-05-05",
      endDate: "2026-05-10",
    });
  });

  it("third tap after a complete range restarts the selection from that day", () => {
    const onConfirm = jest.fn();
    const view = render(
      <DateRangePickerModal
        visible
        onClose={jest.fn()}
        onConfirm={onConfirm}
        initialRange={null}
      />,
    );

    // Build a complete range first.
    fireEvent.press(view.getByLabelText("2026-05-01"));
    fireEvent.press(view.getByLabelText("2026-05-07"));

    // Apply enabled — proves the range is complete.
    expect(
      view.getByLabelText("Apply date range").props.accessibilityState
        ?.disabled,
    ).toBe(false);

    // Third tap — must restart at the new day with no end.
    fireEvent.press(view.getByLabelText("2026-05-12"));

    // Apply must drop back to disabled (only start, no end).
    expect(
      view.getByLabelText("Apply date range").props.accessibilityState
        ?.disabled,
    ).toBe(true);

    // Tapping a later day completes the new range starting at 05-12.
    fireEvent.press(view.getByLabelText("2026-05-14"));
    fireEvent.press(view.getByLabelText("Apply date range"));
    expect(onConfirm).toHaveBeenCalledWith({
      startDate: "2026-05-12",
      endDate: "2026-05-14",
    });
  });

  it("surfaces the 'Range capped at 365 days.' warning when the day-tap range exceeds MAX_RANGE_DAYS", () => {
    const view = render(
      <DateRangePickerModal
        visible
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        initialRange={null}
      />,
    );

    // No warning at rest — nothing selected yet.
    expect(view.queryByText(/Range capped at 365 days/i)).toBeNull();

    // Navigate back 13 months so we can tap a day in April 2025.
    // 2026-05 → 2025-04 = 13 months back.
    const prev = view.getByLabelText("Previous month");
    for (let i = 0; i < 13; i++) {
      fireEvent.press(prev);
    }
    fireEvent.press(view.getByLabelText("2025-04-01"));

    // Navigate forward 13 months back to May 2026.
    const next = view.getByLabelText("Next month");
    for (let i = 0; i < 13; i++) {
      fireEvent.press(next);
    }
    fireEvent.press(view.getByLabelText("2026-05-15"));

    // 2025-04-01 → 2026-05-15 is well over 365 days inclusive →
    // tooLong → warning text rendered AND Apply forced disabled
    // (canConfirm = ... && !tooLong).
    expect(view.queryByText(/Range capped at 365 days/i)).toBeTruthy();
    expect(
      view.getByLabelText("Apply date range").props.accessibilityState
        ?.disabled,
    ).toBe(true);
  });

  it("Apply is disabled until both ends are picked", () => {
    const view = render(
      <DateRangePickerModal
        visible
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        initialRange={null}
      />,
    );

    const apply = view.getByLabelText("Apply date range");
    expect(apply.props.accessibilityState?.disabled).toBe(true);
  });

  it("clamps to today: the Next month chevron is disabled while viewing the current month", () => {
    const view = render(
      <DateRangePickerModal
        visible
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        initialRange={null}
      />,
    );

    const next = view.getByLabelText("Next month");
    expect(next.props.accessibilityState?.disabled).toBe(true);
  });

  it("future cells are disabled (cannot be tapped to extend past today)", () => {
    const view = render(
      <DateRangePickerModal
        visible
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        initialRange={null}
      />,
    );

    // Today is 2026-05-15 → 2026-05-20 is in the future and must
    // be marked disabled by accessibilityState.
    const future = view.getByLabelText("2026-05-20");
    expect(future.props.accessibilityState?.disabled).toBe(true);
  });

  it("reseeds from initialRange every time the modal becomes visible", () => {
    const initial = { startDate: "2026-05-01", endDate: "2026-05-07" };

    const view = render(
      <DateRangePickerModal
        visible={false}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        initialRange={initial}
      />,
    );

    view.rerender(
      <DateRangePickerModal
        visible
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        initialRange={initial}
      />,
    );

    // After reseeding, Apply must report enabled (canConfirm true)
    // since both ends came from initialRange.
    const apply = view.getByLabelText("Apply date range");
    expect(apply.props.accessibilityState?.disabled).toBe(false);
  });

  it("Cancel button calls onClose and does NOT call onConfirm", () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    const view = render(
      <DateRangePickerModal
        visible
        onClose={onClose}
        onConfirm={onConfirm}
        initialRange={null}
      />,
    );

    fireEvent.press(view.getByLabelText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("persistence: confirming a range hands the exact YYYY-MM-DD pair to onConfirm and fires the capture haptic", () => {
    const onConfirm = jest.fn();
    const view = render(
      <DateRangePickerModal
        visible
        onClose={jest.fn()}
        onConfirm={onConfirm}
        initialRange={null}
      />,
    );
    fireEvent.press(view.getByLabelText("2026-05-12"));
    fireEvent.press(view.getByLabelText("2026-05-14"));
    fireEvent.press(view.getByLabelText("Apply date range"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      startDate: "2026-05-12",
      endDate: "2026-05-14",
    });
    // Apply is a save-style confirmation, so the picker fires the
    // shared `capture` haptic. The recap screen relies on this for
    // the same haptic fingerprint as a memory save.
    expect(mockCaptureHapticPlay).toHaveBeenCalledTimes(1);
  });

  it("preset chip drops a clamped range straight into the draft (calendar jumps to that month)", () => {
    const onConfirm = jest.fn();
    const view = render(
      <DateRangePickerModal
        visible
        onClose={jest.fn()}
        onConfirm={onConfirm}
        initialRange={null}
      />,
    );

    // FIXED_NOW is 2026-05-15.
    // "Last 7 days" relative to 2026-05-15 is 2026-05-09 through 2026-05-15.
    fireEvent.press(view.getByLabelText("Last 7 days"));
    fireEvent.press(view.getByLabelText("Apply date range"));
    expect(onConfirm).toHaveBeenCalledWith({
      startDate: "2026-05-09",
      endDate: "2026-05-15",
    });
  });
});

