import * as Haptics from "expo-haptics";

import {
  buildSchedule,
  pickImpactStyle,
  playPattern,
} from "./ahapPlayer";
import { HAPTIC_PATTERNS } from "./patterns";

describe("pickImpactStyle", () => {
  it("returns Rigid for a sharp, intense transient", () => {
    expect(pickImpactStyle(0.95, 0.8)).toBe(Haptics.ImpactFeedbackStyle.Rigid);
  });

  it("returns Heavy for an intense but blunt transient", () => {
    expect(pickImpactStyle(0.85, 0.2)).toBe(Haptics.ImpactFeedbackStyle.Heavy);
  });

  it("returns Medium for a mid-range transient", () => {
    expect(pickImpactStyle(0.6, 0.5)).toBe(Haptics.ImpactFeedbackStyle.Medium);
  });

  it("returns Soft for a low-intensity, blunt transient", () => {
    expect(pickImpactStyle(0.35, 0.2)).toBe(Haptics.ImpactFeedbackStyle.Soft);
  });

  it("returns Light for a low-intensity, sharp transient", () => {
    expect(pickImpactStyle(0.4, 0.6)).toBe(Haptics.ImpactFeedbackStyle.Light);
  });

  it("clamps gracefully when callers pass out-of-range numbers", () => {
    // pickImpactStyle does not clamp — readParam does — but the bucket
    // math should still pick something sensible at the extremes.
    expect(pickImpactStyle(0, 0)).toBe(Haptics.ImpactFeedbackStyle.Light);
    expect(pickImpactStyle(1, 1)).toBe(Haptics.ImpactFeedbackStyle.Rigid);
  });
});

describe("buildSchedule", () => {
  it("converts AHAP Time (seconds) to schedule offset (ms)", () => {
    const schedule = buildSchedule(HAPTIC_PATTERNS.capture);
    expect(schedule).toHaveLength(2);
    expect(schedule[0].atMs).toBe(0);
    expect(schedule[1].atMs).toBe(85);
  });

  it("sorts events by time even when authored out of order", () => {
    const schedule = buildSchedule({
      Version: 1.0,
      Pattern: [
        {
          Event: {
            Time: 0.2,
            EventType: "HapticTransient",
            EventParameters: [
              { ParameterID: "HapticIntensity", ParameterValue: 0.5 },
              { ParameterID: "HapticSharpness", ParameterValue: 0.5 },
            ],
          },
        },
        {
          Event: {
            Time: 0.1,
            EventType: "HapticTransient",
            EventParameters: [
              { ParameterID: "HapticIntensity", ParameterValue: 0.5 },
              { ParameterID: "HapticSharpness", ParameterValue: 0.5 },
            ],
          },
        },
      ],
    });
    expect(schedule.map((s) => s.atMs)).toEqual([100, 200]);
  });
});

describe("playPattern", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (Haptics.impactAsync as jest.Mock).mockClear();
    (Haptics.selectionAsync as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("fires each transient at its scheduled time using the right style", () => {
    playPattern(HAPTIC_PATTERNS.capture);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();

    jest.advanceTimersByTime(0);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    // First event: intensity 0.45, sharpness 0.30 → Soft (low intensity, blunt)
    expect(Haptics.impactAsync).toHaveBeenLastCalledWith("soft");

    jest.advanceTimersByTime(85);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
    // Second event: intensity 0.85, sharpness 0.55 → Heavy
    expect(Haptics.impactAsync).toHaveBeenLastCalledWith("heavy");
  });

  it("fires the 'error' signature as two firm impacts spaced ~140ms apart", () => {
    playPattern(HAPTIC_PATTERNS.error);
    jest.advanceTimersByTime(0);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(140);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
  });

  it("fires the streak crescendo as three rising impacts", () => {
    playPattern(HAPTIC_PATTERNS["streak-extended"]);
    jest.advanceTimersByTime(200);
    const calls = (Haptics.impactAsync as jest.Mock).mock.calls.map(
      (c) => c[0],
    );
    expect(calls).toEqual(["light", "medium", "rigid"]);
  });

  it("expands a HapticContinuous into a sequence of selection ticks", () => {
    playPattern(HAPTIC_PATTERNS.undo);
    // Drain all timers (transient + every continuous tick)
    jest.runAllTimers();
    // 1 transient + several selection ticks for the 0.16s tail
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.selectionAsync).toHaveBeenCalled();
  });

  it("cancels pending events when the handle is cancelled", () => {
    const handle = playPattern(HAPTIC_PATTERNS.capture);
    handle.cancel();
    jest.advanceTimersByTime(500);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });
});
