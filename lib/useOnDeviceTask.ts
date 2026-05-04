// Shared status-machine helper for React hooks that wrap an
// on-device FoundationModels native call. Extracted from the
// original `useOnDeviceSummary` so a second hook (memory facet
// extraction — see `useMemoryFacets`) can share the same idle /
// running / done / unavailable / error transitions and the same
// availability snapshot without duplicating the bookkeeping.
//
// Status machine (identical to the original summary hook):
//   unavailable → (terminal until availability changes; `run` is a no-op)
//   idle → running → done | error → idle (via `reset`)
//
// The native function `call` MUST resolve to either:
//   - `{ status: "ok",          data: T }`
//   - `{ status: "unavailable", reason: FMUnavailableReason }`
// and is allowed to throw — throws become `status: "error"` with a
// stringified message. `availability` is snapshotted once on mount;
// the underlying native call is synchronous and only changes after
// the user visits Settings, at which point a screen remount picks
// up the new value.

import { useCallback, useState } from "react";

import {
  getAvailability,
  type FMAvailability,
  type FMUnavailableReason,
} from "../modules/foundation-models";

export type OnDeviceTaskStatus =
  | "idle"
  | "running"
  | "done"
  | "unavailable"
  | "error";

export type NativeAiTaskResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable"; reason: FMUnavailableReason };

export interface OnDeviceTaskState<T> {
  status: OnDeviceTaskStatus;
  data: T | null;
  reason: FMUnavailableReason | null;
  error: string | null;
  availability: FMAvailability;
  /** Runs the wrapped native call. Resolves with the produced
   *  payload on success, or `null` for the unavailable / error
   *  paths. Callers that only care about the UI state can ignore
   *  the return value; callers that need the data inline (e.g. the
   *  capture flow needs facets to persist on the new memory in the
   *  same tick) read it from the resolved value rather than racing
   *  against React's async state update. */
  run: (text: string) => Promise<T | null>;
  reset: () => void;
}

export function useOnDeviceTask<T>(
  call: (text: string) => Promise<NativeAiTaskResult<T>>,
): OnDeviceTaskState<T> {
  // Snapshot availability once on mount. The underlying native call
  // is synchronous and the result only changes after the user visits
  // Settings — at which point a screen remount is fine.
  const [availability] = useState<FMAvailability>(() => getAvailability());

  const [status, setStatus] = useState<OnDeviceTaskStatus>(
    availability.available ? "idle" : "unavailable",
  );
  const [data, setData] = useState<T | null>(null);
  const [reason, setReason] = useState<FMUnavailableReason | null>(
    availability.reason,
  );
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setStatus(availability.available ? "idle" : "unavailable");
    setReason(availability.reason);
  }, [availability]);

  const run = useCallback(
    async (text: string): Promise<T | null> => {
      if (!availability.available) {
        setStatus("unavailable");
        setReason(availability.reason);
        return null;
      }

      setStatus("running");
      setError(null);
      setData(null);

      try {
        const result = await call(text);
        if (result.status === "ok") {
          setData(result.data);
          setReason(null);
          setStatus("done");
          return result.data;
        }
        setReason(result.reason);
        setStatus("unavailable");
        return null;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
        return null;
      }
    },
    [availability, call],
  );

  return { status, data, reason, error, availability, run, reset };
}
