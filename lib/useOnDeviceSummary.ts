// React hook around the local `foundation-models` Expo module's
// summarize entry point.
//
// All state transitions go through local state so screens never have
// to remember to check `Platform.OS`, the iOS version, or whether the
// module is linked into the running binary. When the on-device LLM
// isn't available the hook still returns a usable shape with a
// machine-readable `reason` so the UI can render an explanation
// instead of a spinner.
//
// Task #196 — streaming upgrade:
//   `run()` drives `subscribeSummarizeStream` (event-based) instead
//   of the one-shot `summarize` Promise. The hook gains `partialSummary`
//   which updates token-by-token as `onSummarizeChunk` events arrive;
//   `summary` is still set on completion for compatibility.
//
// Lifecycle contract (important for correctness):
//   - Every terminal event path (`onDone`, `onError`) calls
//     `localSub.remove()` so listeners are cleaned up immediately —
//     not left dangling until the next `run()` or `reset()`.
//   - `reset()` resolves any pending `run()` Promise with `null` so
//     callers don't hang. It also calls `cancelActiveStream()` to stop
//     the underlying Swift Task.
//   - `resolveRunRef` holds the pending Promise's resolve function;
//     it is cleared on every terminal path to prevent double-resolve.

import { useCallback, useRef, useState } from "react";

import {
  getAvailability,
  subscribeSummarizeStream,
  type FMAvailability,
  type FMStreamSubscription,
  type FMUnavailableReason,
} from "../modules/foundation-models";

export type OnDeviceSummaryStatus =
  | "idle"
  | "running"
  | "done"
  | "unavailable"
  | "error";

/**
 * Successful payload from {@link OnDeviceSummary.run}. Mirrors the
 * `ok` branch of the native `FMSummarizeResult` minus the discriminator
 * — `run` returns `null` for the unavailable / error branches, so the
 * status field is redundant once you have a non-null payload.
 */
export interface OnDeviceSummaryRun {
  summary: string;
  latencyMs: number;
  approxTokens: number;
}

export type OnDeviceSummary = {
  status: OnDeviceSummaryStatus;
  /**
   * Partial accumulated text while `status === "running"`. Updated
   * token-by-token as the Swift stream emits chunks. Cleared on
   * `reset()` or when a new `run()` starts.
   */
  partialSummary: string | null;
  /** Final summary text; set on completion (`status === "done"`). */
  summary: string | null;
  latencyMs: number | null;
  approxTokens: number | null;
  reason: FMUnavailableReason | null;
  error: string | null;
  availability: FMAvailability;
  /**
   * Kick off a streaming summarization. Resolves with the
   * `OnDeviceSummaryRun` payload (summary text + latency + approx
   * tokens) on success, or `null` for the unavailable / error /
   * cancelled paths. Callers that only care about the UI state can
   * ignore the return value and read from `summary` / `latencyMs` /
   * `approxTokens`. Callers that want per-run telemetry inline —
   * e.g. the spike screen's runs log appending one row per call —
   * use the return value directly.
   */
  run: (text: string) => Promise<OnDeviceSummaryRun | null>;
  /**
   * Reset to idle. If a stream is in-flight, cancels it immediately
   * so the underlying Swift Task stops consuming resources, and
   * resolves the pending `run()` Promise with `null`.
   */
  reset: () => void;
};

export function describeUnavailableReason(
  reason: FMUnavailableReason | null,
): string {
  switch (reason) {
    case "non_ios_platform":
      return "On-device summaries are an iOS-only feature.";
    case "ios_below_26":
      return "Requires iOS 26 or later (Apple Intelligence shipped Sept 2025).";
    case "device_not_eligible":
      return "This device isn't Apple Intelligence eligible (needs iPhone 15 Pro or newer / M-series iPad).";
    case "apple_intelligence_not_enabled":
      return "Turn on Apple Intelligence in Settings to use on-device summaries.";
    case "model_not_ready":
      return "The on-device model is still downloading. Try again in a few minutes.";
    case "framework_not_present":
      return "FoundationModels framework isn't present in this build.";
    case "module_not_linked":
      return "Run an EAS dev build — this feature isn't available in Expo Go.";
    case "empty_input":
      return "Add some text to summarize first.";
    case "unknown":
    case null:
    default:
      return "On-device summaries aren't available right now.";
  }
}

export function useOnDeviceSummary(): OnDeviceSummary {
  // Snapshot availability once on mount. Only changes if the user
  // visits Settings while the app is backgrounded, in which case a
  // screen remount picks up the new value.
  const [availability] = useState<FMAvailability>(() => getAvailability());

  const [status, setStatus] = useState<OnDeviceSummaryStatus>(
    availability.available ? "idle" : "unavailable",
  );
  const [partialSummary, setPartialSummary] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [approxTokens, setApproxTokens] = useState<number | null>(null);
  const [reason, setReason] = useState<FMUnavailableReason | null>(
    availability.reason,
  );
  const [error, setError] = useState<string | null>(null);

  // Active subscription — used by reset() to cancel the in-flight stream.
  const subscriptionRef = useRef<FMStreamSubscription | null>(null);

  // Holds the resolve function for the currently awaited run() Promise.
  // Cleared on every terminal path (done, error, cancel) to prevent
  // double-resolve. reset() calls this to unblock any awaiting caller.
  const resolveRunRef = useRef<((v: OnDeviceSummaryRun | null) => void) | null>(null);

  // Mirror of `partialSummary` that we can read synchronously from inside
  // `onDone`. The previous implementation read the latest partial text
  // by calling `setPartialSummary((prev) => …)` and resolving the run
  // Promise from that updater. Under `await act(async () => { fireDone();
  // await runPromise; })`, React may not flush the functional updater
  // before the awaited Promise resolves, which deadlocks the test (the
  // updater is what calls `resolveRun`). Tracking the text in a ref
  // lets us resolve synchronously in `onDone` and keeps the test
  // renderer from sitting forever on a Promise that nothing will ever
  // settle.
  const partialSummaryRef = useRef<string | null>(null);

  const cancelActiveStream = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    // Resolve the pending Promise so callers don't hang on await run().
    const resolve = resolveRunRef.current;
    resolveRunRef.current = null;
    resolve?.(null);
  }, []);

  const reset = useCallback(() => {
    cancelActiveStream();
    partialSummaryRef.current = null;
    setPartialSummary(null);
    setSummary(null);
    setLatencyMs(null);
    setApproxTokens(null);
    setError(null);
    setStatus(availability.available ? "idle" : "unavailable");
    setReason(availability.reason);
  }, [availability, cancelActiveStream]);

  const run = useCallback(
    (text: string): Promise<OnDeviceSummaryRun | null> => {
      if (!availability.available) {
        setStatus("unavailable");
        setReason(availability.reason);
        return Promise.resolve(null);
      }

      // Cancel any previous stream before starting a new one.
      // This resolves the old Promise with null (via cancelActiveStream).
      cancelActiveStream();

      setStatus("running");
      setError(null);
      setSummary(null);
      partialSummaryRef.current = null;
      setPartialSummary(null);
      setLatencyMs(null);
      setApproxTokens(null);
      setReason(null);

      return new Promise<OnDeviceSummaryRun | null>((resolve) => {
        resolveRunRef.current = resolve;

        // `localSub` captures the subscription handle for cleanup inside
        // the terminal callbacks. It is set synchronously after
        // `subscribeSummarizeStream` returns; events fire asynchronously
        // (from native callbacks), so `localSub` is always populated by
        // the time they arrive.
        let localSub: FMStreamSubscription | null = null;

        const sub = subscribeSummarizeStream(text, {
          onChunk: (chunk) => {
            partialSummaryRef.current = chunk;
            setPartialSummary(chunk);
          },
          onDone: (payload) => {
            // Unsubscribe immediately — do not wait for reset() or next run().
            localSub?.remove();
            subscriptionRef.current = null;
            const resolveRun = resolveRunRef.current;
            resolveRunRef.current = null;

            // Read the final accumulated text from the ref so we can
            // resolve the run() Promise *synchronously* in this event
            // handler. Reading via a `setPartialSummary` functional
            // updater would defer resolution to the next React render,
            // which deadlocks `await act(async () => { fireDone();
            // await runPromise; })` — the updater never flushes
            // because act is parked on the awaited Promise.
            //
            // Edge case — done without any prior chunk event: the ref
            // is still null, so `finalText` becomes "". This can happen
            // if the model responds with empty output or the Swift
            // stream yields zero elements before completing. We surface
            // "" as the final summary (the result card will render
            // nothing visible) rather than hiding the done event.
            const finalText = partialSummaryRef.current ?? "";
            setSummary(finalText);
            setLatencyMs(payload.latencyMs);
            setApproxTokens(payload.approxTokens);
            setStatus("done");
            resolveRun?.({
              summary: finalText,
              latencyMs: payload.latencyMs,
              approxTokens: payload.approxTokens,
            });
          },
          onError: (errorReason) => {
            // Unsubscribe immediately on error too.
            localSub?.remove();
            subscriptionRef.current = null;
            const resolveRun = resolveRunRef.current;
            resolveRunRef.current = null;

            setReason(errorReason);
            setStatus("unavailable");
            setPartialSummary(null);
            resolveRun?.(null);
          },
        });

        localSub = sub;
        subscriptionRef.current = sub;
      });
    },
    [availability, cancelActiveStream],
  );

  return {
    status,
    partialSummary,
    summary,
    latencyMs,
    approxTokens,
    reason,
    error,
    availability,
    run,
    reset,
  };
}
