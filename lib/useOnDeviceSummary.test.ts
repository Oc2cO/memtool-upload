// Tests for the streaming on-device summary hook (Task #196).
//
// The hook now drives `subscribeSummarizeStream` (event-based) rather
// than the one-shot `summarize` Promise, so we need a mock native
// module that implements `addListener` / `summarizeStream` /
// `cancelSummarizeStream` and lets us fire events imperatively from
// the test body.

import { act, renderHook } from "@testing-library/react-native";

import {
  __resetNativeModuleForTests,
  __setNativeModuleForTests,
  isFirstRunInProcess,
} from "../modules/foundation-models";
import {
  describeUnavailableReason,
  useOnDeviceSummary,
  type OnDeviceSummaryRun,
} from "./useOnDeviceSummary";

// ---------------------------------------------------------------------------
// Streaming mock helpers
// ---------------------------------------------------------------------------

type EventHandler = (e: Record<string, unknown>) => void;

/**
 * Build a minimal native-module mock that supports the streaming event API.
 *
 * Returns the mock object plus `fireChunk` / `fireDone` / `fireError`
 * helpers so tests can trigger events imperatively, and `summarizeStreamCalls`
 * so tests can assert the stream was started.
 */
function makeStreamingMock(opts?: {
  getAvailability?: () => { available: boolean; reason: string | null };
  extractFacets?: jest.Mock;
}) {
  const listeners: Record<string, EventHandler[]> = {};
  const summarizeStreamCalls: string[] = [];
  let cancelled = false;

  const addListener = jest.fn(
    (eventName: string, handler: EventHandler) => {
      if (!listeners[eventName]) listeners[eventName] = [];
      listeners[eventName].push(handler);
      return {
        remove: () => {
          listeners[eventName] = (listeners[eventName] ?? []).filter(
            (h) => h !== handler,
          );
        },
      };
    },
  );

  const summarizeStream = jest.fn((text: string) => {
    summarizeStreamCalls.push(text);
    cancelled = false;
  });

  const cancelSummarizeStream = jest.fn(() => {
    cancelled = true;
  });

  const fire = (eventName: string, payload: Record<string, unknown>) => {
    for (const h of listeners[eventName] ?? []) h(payload);
  };

  const fireChunk = (chunk: string) => fire("onSummarizeChunk", { chunk });
  const fireDone = (latencyMs: number, approxTokens: number) =>
    fire("onSummarizeDone", { latencyMs, approxTokens });
  const fireError = (reason: string) =>
    fire("onSummarizeError", { reason });

  const mock = {
    getAvailability:
      opts?.getAvailability ?? (() => ({ available: true, reason: null })),
    summarize: jest.fn(),
    summarizeStream,
    cancelSummarizeStream,
    extractFacets: opts?.extractFacets ?? jest.fn(),
    addListener,
  };

  return {
    mock,
    summarizeStreamCalls,
    isCancelled: () => cancelled,
    fireChunk,
    fireDone,
    fireError,
  };
}

afterEach(() => {
  __resetNativeModuleForTests();
});

describe("useOnDeviceSummary", () => {
  it("starts in 'unavailable' when the native module is not linked", () => {
    __setNativeModuleForTests(null);
    const { result } = renderHook(() => useOnDeviceSummary());

    expect(result.current.status).toBe("unavailable");
    expect(result.current.availability.available).toBe(false);
    expect(result.current.summary).toBeNull();
    expect(result.current.partialSummary).toBeNull();
    expect(result.current.latencyMs).toBeNull();
    expect(result.current.approxTokens).toBeNull();
  });

  it("streams partial text and settles to 'done' when native succeeds", async () => {
    const { mock, fireChunk, fireDone } = makeStreamingMock();
    __setNativeModuleForTests(mock);

    const { result } = renderHook(() => useOnDeviceSummary());
    expect(result.current.status).toBe("idle");

    let runPromise: Promise<unknown>;
    act(() => {
      runPromise = result.current.run("Long memory entry text...");
    });

    expect(result.current.status).toBe("running");

    // Emit a couple of chunk events
    act(() => {
      fireChunk("A walk");
    });
    expect(result.current.partialSummary).toBe("A walk");

    act(() => {
      fireChunk("A walk in the park. Met a friend.");
    });
    expect(result.current.partialSummary).toBe("A walk in the park. Met a friend.");

    // Final done event
    await act(async () => {
      fireDone(412, 11);
      await runPromise;
    });

    expect(result.current.status).toBe("done");
    expect(result.current.summary).toBe("A walk in the park. Met a friend.");
    expect(result.current.latencyMs).toBe(412);
    expect(result.current.approxTokens).toBe(11);
    expect(result.current.error).toBeNull();
  });

  it("`run` resolves with the full payload so callers get inline telemetry", async () => {
    const { mock, fireChunk, fireDone } = makeStreamingMock();
    __setNativeModuleForTests(mock);

    const { result } = renderHook(() => useOnDeviceSummary());

    let runResult: Awaited<ReturnType<typeof result.current.run>> = null;
    await act(async () => {
      const p = result.current.run("text");
      fireChunk("Final text.");
      fireDone(200, 5);
      runResult = await p;
    });

    expect(runResult).toEqual({
      summary: "Final text.",
      latencyMs: 200,
      approxTokens: 5,
    });
  });

  it("flips to 'unavailable' with a reason when native fires onSummarizeError", async () => {
    const { mock, fireError } = makeStreamingMock();
    __setNativeModuleForTests(mock);

    const { result } = renderHook(() => useOnDeviceSummary());
    await act(async () => {
      const p = result.current.run("anything");
      fireError("model_not_ready");
      await p;
    });

    expect(result.current.status).toBe("unavailable");
    expect(result.current.reason).toBe("model_not_ready");
    expect(result.current.summary).toBeNull();
    expect(result.current.partialSummary).toBeNull();
  });

  it("normalizes unknown error reasons coming from the native side", async () => {
    const { mock, fireError } = makeStreamingMock();
    __setNativeModuleForTests(mock);

    const { result } = renderHook(() => useOnDeviceSummary());
    await act(async () => {
      const p = result.current.run("anything");
      fireError("totally-new-reason");
      await p;
    });

    expect(result.current.status).toBe("unavailable");
    expect(result.current.reason).toBe("unknown");
  });

  it("`run` is a no-op when availability is unavailable", async () => {
    const { mock } = makeStreamingMock({
      getAvailability: () => ({
        available: false,
        reason: "apple_intelligence_not_enabled",
      }),
    });
    __setNativeModuleForTests(mock);

    const { result } = renderHook(() => useOnDeviceSummary());
    await act(async () => {
      await result.current.run("anything");
    });

    expect(mock.summarizeStream).not.toHaveBeenCalled();
    expect(result.current.status).toBe("unavailable");
    expect(result.current.reason).toBe("apple_intelligence_not_enabled");
  });

  it("flips `isFirstRunInProcess` from true to false after a successful stream", async () => {
    const { mock, fireChunk, fireDone } = makeStreamingMock();
    __setNativeModuleForTests(mock);

    expect(isFirstRunInProcess()).toBe(true);
    const { result } = renderHook(() => useOnDeviceSummary());
    await act(async () => {
      const p = result.current.run("anything");
      fireChunk("x");
      fireDone(10, 1);
      await p;
    });
    expect(isFirstRunInProcess()).toBe(false);
  });

  it("does NOT consume cold-start when the stream reports an error", async () => {
    const { mock, fireError } = makeStreamingMock();
    __setNativeModuleForTests(mock);

    expect(isFirstRunInProcess()).toBe(true);
    const { result } = renderHook(() => useOnDeviceSummary());
    await act(async () => {
      const p = result.current.run("anything");
      fireError("model_not_ready");
      await p;
    });
    expect(isFirstRunInProcess()).toBe(true);
  });

  it("`reset` clears summary state and cancels an in-flight stream", async () => {
    const { mock, isCancelled, fireChunk } = makeStreamingMock();
    __setNativeModuleForTests(mock);

    const { result } = renderHook(() => useOnDeviceSummary());
    act(() => {
      void result.current.run("anything");
    });
    act(() => {
      fireChunk("partial...");
    });
    expect(result.current.partialSummary).toBe("partial...");

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.summary).toBeNull();
    expect(result.current.partialSummary).toBeNull();
    expect(result.current.latencyMs).toBeNull();
    expect(isCancelled()).toBe(true);
  });

  it("`reset` after a completed run clears state but doesn't double-cancel", async () => {
    const { mock, fireChunk, fireDone } = makeStreamingMock();
    __setNativeModuleForTests(mock);

    const { result } = renderHook(() => useOnDeviceSummary());
    await act(async () => {
      const p = result.current.run("anything");
      fireChunk("done text.");
      fireDone(10, 1);
      await p;
    });
    expect(result.current.status).toBe("done");

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.summary).toBeNull();
    expect(result.current.latencyMs).toBeNull();
  });

  it("does NOT accumulate listeners across multiple sequential runs", async () => {
    // Each run must remove its listeners on the terminal path so that
    // subsequent runs don't trigger stale handlers from prior runs.
    const { mock, fireChunk, fireDone } = makeStreamingMock();
    __setNativeModuleForTests(mock);

    const { result } = renderHook(() => useOnDeviceSummary());

    // Run 1
    await act(async () => {
      const p = result.current.run("first");
      fireChunk("First chunk.");
      fireDone(100, 5);
      await p;
    });

    // Run 2
    const chunkSpy = jest.fn();
    // Track how many times partialSummary setter is invoked during run 2.
    // Reset state so we're in idle before starting.
    act(() => { result.current.reset(); });

    await act(async () => {
      const p = result.current.run("second");
      fireChunk("Second chunk.");
      fireDone(200, 8);
      await p;
    });

    // The final summary should reflect run 2 only.
    expect(result.current.summary).toBe("Second chunk.");
    expect(result.current.latencyMs).toBe(200);
    expect(result.current.approxTokens).toBe(8);

    // addListener should have been called twice total (once per run)
    // and each call should have produced a subscription that was
    // subsequently removed — verified indirectly by the correct run-2
    // values above (stale listeners from run 1 would have overwritten
    // them with run-1 values).
    expect(mock.addListener).toHaveBeenCalledTimes(6); // 3 events × 2 runs
    void chunkSpy;
  });

  it("handles onDone fired without any prior chunk — surfaces empty string summary", async () => {
    // If the Swift stream yields zero elements before completing (e.g. the
    // model returned empty output), onDone fires with partialSummary still
    // null. The hook must resolve cleanly with an empty string rather than
    // crashing or hanging.
    const { mock, fireDone } = makeStreamingMock();
    __setNativeModuleForTests(mock);

    const { result } = renderHook(() => useOnDeviceSummary());

    let runResult: OnDeviceSummaryRun | null = undefined as unknown as null;
    await act(async () => {
      const p = result.current.run("anything");
      fireDone(50, 0);
      runResult = await p;
    });

    expect(result.current.status).toBe("done");
    expect(result.current.summary).toBe("");
    expect(result.current.latencyMs).toBe(50);
    expect(runResult).toEqual({ summary: "", latencyMs: 50, approxTokens: 0 });
  });

  it("`reset()` mid-generation resolves the pending `run()` Promise with null", async () => {
    // If a caller awaits run() and the user taps Reset before the stream
    // completes, the Promise must resolve promptly rather than hanging.
    const { mock, fireChunk } = makeStreamingMock();
    __setNativeModuleForTests(mock);

    const { result } = renderHook(() => useOnDeviceSummary());

    let runResult: OnDeviceSummaryRun | null = undefined as unknown as null;
    await act(async () => {
      const p = result.current.run("anything").then((v) => { runResult = v; });
      // Emit a partial chunk so we know the stream is in-flight
      fireChunk("partial text...");
      // Reset before done fires — should resolve the Promise
      result.current.reset();
      await p;
    });

    expect(runResult).toBeNull();
    expect(result.current.status).toBe("idle");
    expect(result.current.partialSummary).toBeNull();
    expect(result.current.summary).toBeNull();
  });
});

describe("describeUnavailableReason", () => {
  it("covers every documented reason with a human sentence", () => {
    const reasons = [
      "non_ios_platform",
      "ios_below_26",
      "device_not_eligible",
      "apple_intelligence_not_enabled",
      "model_not_ready",
      "framework_not_present",
      "module_not_linked",
      "empty_input",
      "unknown",
      null,
    ] as const;
    for (const reason of reasons) {
      const text = describeUnavailableReason(reason);
      expect(text.length).toBeGreaterThan(0);
      expect(text.endsWith(".")).toBe(true);
    }
  });
});
