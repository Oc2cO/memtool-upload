/**
 * Tests for `useMemSpeech` (Task #283 step 8).
 *
 * Coverage:
 *   - mute path: skips expo-speech.speak, still emits word counts
 *     via the fallback estimator at the faster fixed wps rate.
 *   - reduce-motion path: still calls expo-speech.speak so audio +
 *     transcript continue, but mouthOpen stays at 0 (no jaw).
 *   - fallback word-timing: when expo-speech doesn't fire any
 *     `onBoundary` event, the visible word cursor still advances
 *     to the full word count.
 *   - interrupt: stop() snaps the cursor to the full word count
 *     and fires onDone exactly once.
 *
 * The hook owns a Reanimated SharedValue, so the tests render it
 * through a tiny harness component using @testing-library/react-native.
 */
import React from "react";
import { AccessibilityInfo, AppState, type AppStateStatus } from "react-native";
import { act, render } from "@testing-library/react-native";

import { useMemSpeech } from "./useMemSpeech";

const mockSpeak = jest.fn();
const mockStop = jest.fn(() => Promise.resolve());

jest.mock("expo-speech", () => ({
  __esModule: true,
  speak: (...args: unknown[]) => mockSpeak(...args),
  stop: () => mockStop(),
}));

interface HarnessProps {
  muted: boolean;
  onReady: (controller: ReturnType<typeof useMemSpeech>) => void;
}
function Harness({ muted, onReady }: HarnessProps) {
  // Pin BOTH rates to 100 wps so muted/spoken paths in the harness
  // tests stream at the same fast pace and assertions on word
  // counts after a fixed elapsed time stay deterministic. The
  // muted-vs-spoken pacing comparison test below uses its own
  // harness with distinct rates instead.
  const ctrl = useMemSpeech({
    muted,
    fallbackWordsPerSecond: 100,
    mutedWordsPerSecond: 100,
  });
  React.useEffect(() => {
    onReady(ctrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

beforeEach(() => {
  mockSpeak.mockReset();
  mockStop.mockReset();
  mockStop.mockImplementation(() => Promise.resolve());
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false);
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockReturnValue({ remove: () => {} } as never);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useMemSpeech", () => {
  test("muted path skips expo-speech.speak but still streams words via the fallback estimator", async () => {
    let ctrl: ReturnType<typeof useMemSpeech> | null = null;
    render(
      <Harness
        muted
        onReady={(c) => {
          ctrl = c;
        }}
      />,
    );
    await flushAsync();
    expect(ctrl).not.toBeNull();

    const seen: number[] = [];
    let doneCount = 0;
    act(() => {
      ctrl!.speak("one two three four", {
        onWordIndex: (n) => seen.push(n),
        onDone: () => {
          doneCount += 1;
        },
      });
    });

    // The harness pins fallbackWordsPerSecond=100 (50ms tick →
    // 5 words/tick). After ~250ms the estimator has overshot the
    // four-word reply and self-terminates.
    await act(async () => {
      jest.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(mockSpeak).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toBe(4);
    expect(doneCount).toBe(1);
    // Mouth never opens in muted mode.
    expect(ctrl!.mouthOpen.value).toBe(0);
  });

  test("muted reveal is visibly faster than the spoken fallback (mutedWordsPerSecond > fallbackWordsPerSecond)", async () => {
    // Two harnesses with the same total elapsed time — the muted
    // one should have streamed strictly more words than the spoken-
    // fallback one. We pin distinct, low rates for each so the
    // comparison is deterministic and decoupled from the file
    // defaults (3.2 vs 6.5 wps).
    let muted: ReturnType<typeof useMemSpeech> | null = null;
    let spoken: ReturnType<typeof useMemSpeech> | null = null;

    function MutedHarness() {
      muted = useMemSpeech({
        muted: true,
        fallbackWordsPerSecond: 4,
        mutedWordsPerSecond: 20,
      });
      return null;
    }
    function SpokenHarness() {
      spoken = useMemSpeech({
        muted: false,
        fallbackWordsPerSecond: 4,
        mutedWordsPerSecond: 20,
      });
      return null;
    }
    render(<MutedHarness />);
    render(<SpokenHarness />);
    await flushAsync();

    const mutedSeen: number[] = [];
    const spokenSeen: number[] = [];
    act(() => {
      muted!.speak(
        "alpha beta gamma delta epsilon zeta eta theta iota kappa",
        { onWordIndex: (n) => mutedSeen.push(n) },
      );
      spoken!.speak(
        "alpha beta gamma delta epsilon zeta eta theta iota kappa",
        { onWordIndex: (n) => spokenSeen.push(n) },
      );
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });

    const mutedLast = mutedSeen[mutedSeen.length - 1] ?? 0;
    const spokenLast = spokenSeen[spokenSeen.length - 1] ?? 0;
    // Muted must be visibly ahead — pin a clear margin so a future
    // tweak that accidentally drops mutedWordsPerSecond to <= the
    // spoken rate breaks this test loudly.
    expect(mutedLast).toBeGreaterThan(spokenLast);
    expect(mutedLast - spokenLast).toBeGreaterThanOrEqual(2);
  });

  test("Reduce Motion keeps audio + reveal but suppresses jaw movement", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true);

    let ctrl: ReturnType<typeof useMemSpeech> | null = null;
    render(
      <Harness
        muted={false}
        onReady={(c) => {
          ctrl = c;
        }}
      />,
    );
    // Let the AccessibilityInfo promise resolve before calling speak.
    await flushAsync();
    await flushAsync();

    act(() => {
      ctrl!.speak("hi there", {});
    });
    await act(async () => {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    });

    // expo-speech is still invoked (Reduce Motion only suppresses
    // the lip-sync, not the audio).
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    // Mouth stays closed.
    expect(ctrl!.mouthOpen.value).toBe(0);
  });

  test("fallback word-timing advances the cursor when no boundary event fires", async () => {
    let ctrl: ReturnType<typeof useMemSpeech> | null = null;
    render(
      <Harness
        muted={false}
        onReady={(c) => {
          ctrl = c;
        }}
      />,
    );
    await flushAsync();

    const seen: number[] = [];
    act(() => {
      ctrl!.speak("alpha beta gamma delta", {
        onWordIndex: (n) => seen.push(n),
      });
    });

    // expo-speech.speak is mocked → it never fires onBoundary or
    // onDone. The fallback estimator (100 wps @ 50ms tick = 5
    // words/tick) should still walk the cursor to the full count.
    await act(async () => {
      jest.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(4);
  });

  test("spoken path auto-tears down after the grace window when expo-speech onDone never fires", async () => {
    // Some Android builds drop `onDone`; some devices throw the
    // `Speech.speak` call synchronously and never invoke any
    // callback. Either way, once the fallback estimator has
    // revealed the full text we must NOT leave timers + the
    // mouth animation running. The hook waits one grace window
    // (1500ms) past the end of the reveal, then auto-teardowns
    // and fires `onDone` exactly once.
    let ctrl: ReturnType<typeof useMemSpeech> | null = null;
    render(
      <Harness
        muted={false}
        onReady={(c) => {
          ctrl = c;
        }}
      />,
    );
    await flushAsync();

    let doneCount = 0;
    act(() => {
      ctrl!.speak("alpha beta gamma", {
        onDone: () => {
          doneCount += 1;
        },
      });
    });

    // Advance to just past the natural end of the 3-word reveal
    // (100 wps → ~30ms) but well short of the grace window.
    await act(async () => {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(ctrl!.isSpeaking()).toBe(true);
    expect(doneCount).toBe(0);
    expect(mockStop).not.toHaveBeenCalled();

    // Now cross the grace window. Auto-teardown should fire
    // `onDone` exactly once and best-effort cancel native audio.
    await act(async () => {
      jest.advanceTimersByTime(1600);
      await Promise.resolve();
    });
    expect(doneCount).toBe(1);
    expect(ctrl!.isSpeaking()).toBe(false);
    expect(mockStop).toHaveBeenCalled();

    // No further teardown / onDone fires after the run is over.
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(doneCount).toBe(1);
  });

  test("stop() snaps the cursor to the full word count and fires onDone exactly once", async () => {
    let ctrl: ReturnType<typeof useMemSpeech> | null = null;
    render(
      <Harness
        muted={false}
        onReady={(c) => {
          ctrl = c;
        }}
      />,
    );
    await flushAsync();

    const seen: number[] = [];
    let doneCount = 0;
    act(() => {
      ctrl!.speak("one two three four five", {
        onWordIndex: (n) => seen.push(n),
        onDone: () => {
          doneCount += 1;
        },
      });
    });

    // Interrupt before the estimator naturally finishes.
    act(() => {
      ctrl!.stop();
    });

    expect(seen[seen.length - 1]).toBe(5);
    expect(doneCount).toBe(1);
    expect(mockStop).toHaveBeenCalled();
  });

  test("AppState background transition stops in-flight speech and does not auto-restart on foreground", async () => {
    // Capture the AppState listener so the test can drive
    // background/active transitions deterministically. expo-speech
    // would otherwise keep talking when the app backgrounds on iOS
    // (Task #294) — the hook must call stop() the moment we leave
    // the active state, and resume on foreground must NOT restart
    // anything (the user has moved on).
    let appStateListener: ((s: AppStateStatus) => void) | null = null;
    const removeMock = jest.fn();
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((event: string, cb: (s: AppStateStatus) => void) => {
        if (event === "change") {
          appStateListener = cb;
        }
        return { remove: removeMock } as never;
      });

    let ctrl: ReturnType<typeof useMemSpeech> | null = null;
    const { unmount } = render(
      <Harness
        muted={false}
        onReady={(c) => {
          ctrl = c;
        }}
      />,
    );
    await flushAsync();
    expect(appStateListener).not.toBeNull();

    const seen: number[] = [];
    let doneCount = 0;
    act(() => {
      ctrl!.speak("one two three four five six", {
        onWordIndex: (n) => seen.push(n),
        onDone: () => {
          doneCount += 1;
        },
      });
    });

    // expo-speech.speak was called (we're in the spoken path).
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    // Some progress, but we deliberately background well before the
    // estimator finishes the 6-word reply.
    await act(async () => {
      jest.advanceTimersByTime(20);
      await Promise.resolve();
    });
    expect(ctrl!.isSpeaking()).toBe(true);

    // Background transition → stop() must fire: native cancel,
    // bubble snaps to full word count, onDone fires exactly once.
    act(() => {
      appStateListener!("background");
    });
    expect(mockStop).toHaveBeenCalled();
    expect(seen[seen.length - 1]).toBe(6);
    expect(doneCount).toBe(1);
    expect(ctrl!.isSpeaking()).toBe(false);

    // Returning to foreground must NOT auto-restart speech.
    const speakCallsBefore = mockSpeak.mock.calls.length;
    act(() => {
      appStateListener!("active");
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(mockSpeak.mock.calls.length).toBe(speakCallsBefore);
    expect(doneCount).toBe(1);

    // 'inactive' (e.g. iOS control center pull-down) is also treated
    // as "user has left" — start a fresh run, then drive an inactive
    // transition and confirm it stops just like background does.
    mockStop.mockClear();
    act(() => {
      ctrl!.speak("alpha beta gamma", {});
    });
    await act(async () => {
      jest.advanceTimersByTime(10);
      await Promise.resolve();
    });
    expect(ctrl!.isSpeaking()).toBe(true);
    act(() => {
      appStateListener!("inactive");
    });
    expect(mockStop).toHaveBeenCalled();
    expect(ctrl!.isSpeaking()).toBe(false);

    // Subscription is torn down on unmount.
    unmount();
    expect(removeMock).toHaveBeenCalled();
  });

  test("calling speak again interrupts the previous run", async () => {
    let ctrl: ReturnType<typeof useMemSpeech> | null = null;
    render(
      <Harness
        muted={false}
        onReady={(c) => {
          ctrl = c;
        }}
      />,
    );
    await flushAsync();

    const firstWordIndices: number[] = [];
    let firstDone = 0;
    act(() => {
      ctrl!.speak("alpha beta gamma", {
        onWordIndex: (n) => firstWordIndices.push(n),
        onDone: () => {
          firstDone += 1;
        },
      });
    });

    // Immediately speak something else.
    act(() => {
      ctrl!.speak("delta epsilon", {});
    });

    expect(mockSpeak).toHaveBeenCalledTimes(2);
    // Previous run's onDone is NOT called when superseded — only
    // an explicit stop() snaps the bubble.
    expect(firstDone).toBe(0);
  });
});
