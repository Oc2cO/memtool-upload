// Verifies that `playPattern` prefers the native Core Haptics
// engine when it's available on iOS, and transparently falls back
// to the JS approximation in every other case (module not linked,
// engine refused to start, native promise rejected). The existing
// `ahapPlayer.test.ts` suite already covers the JS path on its own.

import * as Haptics from "expo-haptics";

import {
  __resetNativeModuleForTests,
  __setNativeModuleForTests,
  type CoreHapticsNative,
} from "../../modules/expo-core-haptics";
import { playPattern } from "./ahapPlayer";
import { HAPTIC_PATTERNS } from "./patterns";

// Flush queued microtasks (Promise continuations). We can't use
// `setImmediate` because that may be faked when fake timers are on,
// but unawaited promise chains always settle by yielding to the
// microtask queue a few times.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  (Haptics.impactAsync as jest.Mock).mockClear();
  (Haptics.selectionAsync as jest.Mock).mockClear();
});

afterEach(() => {
  __resetNativeModuleForTests();
});

describe("playPattern with Core Haptics native module", () => {
  it("forwards the parsed AHAP dictionary to the native engine and skips JS scheduling", async () => {
    const play = jest.fn().mockResolvedValue({ status: "ok", handle: 7 });
    const stop = jest.fn();
    const native: CoreHapticsNative = {
      getAvailability: () => ({ available: true, reason: null }),
      play,
      stop,
    };
    __setNativeModuleForTests(native);

    playPattern(HAPTIC_PATTERNS.capture);

    expect(play).toHaveBeenCalledTimes(1);
    // The dictionary handed to native must be the exact AHAP shape
    // — Apple's CHHapticPattern(dictionary:) parses these keys
    // verbatim, so any drift would silently break native playback.
    expect(play.mock.calls[0][0]).toEqual(HAPTIC_PATTERNS.capture);

    await flushMicrotasks();

    // No JS-side approximation should have fired — native took
    // ownership of this play.
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it("cancel() stops the native player using the handle it received", async () => {
    const stop = jest.fn();
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      play: jest.fn().mockResolvedValue({ status: "ok", handle: 42 }),
      stop,
    });

    const handle = playPattern(HAPTIC_PATTERNS["day-recap-ready"]);
    // Let the native promise resolve so the handle is recorded.
    await flushMicrotasks();

    handle.cancel();
    expect(stop).toHaveBeenCalledWith(42);
  });

  it("cancel() before native resolves still stops the player when it later starts", async () => {
    const stop = jest.fn();
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      play: jest.fn().mockResolvedValue({ status: "ok", handle: 99 }),
      stop,
    });

    const handle = playPattern(HAPTIC_PATTERNS.undo);
    handle.cancel(); // cancelled before the play() promise settles
    await flushMicrotasks();

    // The native side still kicked off (we already called start),
    // so on resolution we must cancel the handle it returned.
    expect(stop).toHaveBeenCalledWith(99);
  });

  it("falls back to the JS approximation when native reports unavailable mid-play", async () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      play: jest.fn().mockResolvedValue({
        status: "unavailable",
        reason: "engine_start_failed",
      }),
      stop: jest.fn(),
    });

    jest.useFakeTimers();
    try {
      playPattern(HAPTIC_PATTERNS.capture);
      await flushMicrotasks();

      // The JS scheduler should have been kicked in; fire its
      // timers and confirm at least one impact landed.
      jest.runAllTimers();
      expect(Haptics.impactAsync).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("falls back to the JS approximation when the native promise rejects", async () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      play: jest.fn().mockRejectedValue(new Error("engine boom")),
      stop: jest.fn(),
    });

    jest.useFakeTimers();
    try {
      playPattern(HAPTIC_PATTERNS.error);
      await flushMicrotasks();

      jest.runAllTimers();
      // 'error' is two transient impacts in the JS approximation.
      expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("uses the JS scheduler directly when native availability is false (no native call)", () => {
    const play = jest.fn();
    __setNativeModuleForTests({
      getAvailability: () => ({
        available: false,
        reason: "hardware_not_supported",
      }),
      play,
      stop: jest.fn(),
    });

    jest.useFakeTimers();
    try {
      playPattern(HAPTIC_PATTERNS.capture);
      expect(play).not.toHaveBeenCalled();

      jest.runAllTimers();
      // JS scheduler ran instead.
      expect(Haptics.impactAsync).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("uses the JS scheduler and never calls native when forceFallback is true (bench A/B toggle)", () => {
    const play = jest.fn();
    __setNativeModuleForTests({
      // Native is fully available — forceFallback should still
      // short-circuit it. This is the bench's A/B toggle path: a
      // tester wants to feel the JS approximation on a Core Haptics
      // device without reinstalling Expo Go.
      getAvailability: () => ({ available: true, reason: null }),
      play,
      stop: jest.fn(),
    });

    jest.useFakeTimers();
    try {
      const handle = playPattern(HAPTIC_PATTERNS.capture, {
        forceFallback: true,
      });
      expect(play).not.toHaveBeenCalled();
      expect(handle.path).toBe("js");

      jest.runAllTimers();
      // The JS scheduler ran — we should see at least one impact
      // from the `capture` pattern's two transients.
      expect(Haptics.impactAsync).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("reports path='core' when routing to the native engine and path='js' when falling through to the JS scheduler", () => {
    // Native available → core.
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      play: jest.fn().mockResolvedValue({ status: "ok", handle: 1 }),
      stop: jest.fn(),
    });
    expect(playPattern(HAPTIC_PATTERNS.capture).path).toBe("core");

    // Native unavailable → js, without forceFallback.
    __setNativeModuleForTests({
      getAvailability: () => ({
        available: false,
        reason: "module_not_linked",
      }),
      play: jest.fn(),
      stop: jest.fn(),
    });
    jest.useFakeTimers();
    try {
      expect(playPattern(HAPTIC_PATTERNS.capture).path).toBe("js");
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not throw when stop() throws (already-finished player)", async () => {
    const stop = jest.fn(() => {
      throw new Error("already stopped");
    });
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      play: jest.fn().mockResolvedValue({ status: "ok", handle: 1 }),
      stop,
    });

    const handle = playPattern(HAPTIC_PATTERNS.capture);
    await flushMicrotasks();
    expect(() => handle.cancel()).not.toThrow();
  });
});
