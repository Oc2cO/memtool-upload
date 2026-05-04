// React hook around the local `foundation-models` Expo module's
// `extractFacets` entry point. Returns the structured
// `{ tags, theme, mood }` shape produced by Apple's `@Generable`
// macro on the Swift side.
//
// Mirrors `useOnDeviceSummary` so the capture screen and the dev
// spike can drive both calls with the same idle / running / done /
// unavailable / error vocabulary. The shared status machine lives
// in `useOnDeviceTask` — both hooks adapt their native call to its
// generic `{ status, data }` shape and re-project the data field
// back into named fields callers expect.
//
// As with `useOnDeviceSummary`, when the device cannot run the
// model (older iOS, ineligible hardware, Apple Intelligence off)
// the hook still returns a usable shape with a machine-readable
// `reason`. Capture flow is expected to swallow that case silently
// and persist the memory without facets.

import { useCallback } from "react";

import {
  extractFacets,
  type FMAvailability,
  type FMMemoryFacets,
  type FMUnavailableReason,
} from "../modules/foundation-models";
import {
  useOnDeviceTask,
  type NativeAiTaskResult,
  type OnDeviceTaskStatus,
} from "./useOnDeviceTask";

export type OnDeviceFacetsStatus = OnDeviceTaskStatus;

export type OnDeviceMemoryFacets = {
  status: OnDeviceFacetsStatus;
  facets: FMMemoryFacets | null;
  latencyMs: number | null;
  approxTokens: number | null;
  reason: FMUnavailableReason | null;
  error: string | null;
  availability: FMAvailability;
  /** Runs the on-device facet extractor. Resolves with the
   *  `MemoryFacets` payload on success or `null` for the
   *  unavailable / error paths. The capture flow awaits this
   *  return value so the new memory can be saved with facets
   *  attached in the same tick — there's no useEffect race
   *  against React's async state flush. */
  run: (text: string) => Promise<FMMemoryFacets | null>;
  reset: () => void;
};

interface FacetsPayload {
  facets: FMMemoryFacets;
  latencyMs: number;
  approxTokens: number;
}

// Module-level adapter so the function reference passed into
// `useOnDeviceTask` is stable across renders.
async function extractFacetsForTask(
  text: string,
): Promise<NativeAiTaskResult<FacetsPayload>> {
  const result = await extractFacets(text);
  if (result.status === "ok") {
    return {
      status: "ok",
      data: {
        facets: result.facets,
        latencyMs: result.latencyMs,
        approxTokens: result.approxTokens,
      },
    };
  }
  return { status: "unavailable", reason: result.reason };
}

export function useMemoryFacets(): OnDeviceMemoryFacets {
  const task = useOnDeviceTask<FacetsPayload>(extractFacetsForTask);

  const run = useCallback(
    async (text: string): Promise<FMMemoryFacets | null> => {
      const payload = await task.run(text);
      return payload?.facets ?? null;
    },
    [task],
  );

  return {
    status: task.status,
    facets: task.data?.facets ?? null,
    latencyMs: task.data?.latencyMs ?? null,
    approxTokens: task.data?.approxTokens ?? null,
    reason: task.reason,
    error: task.error,
    availability: task.availability,
    run,
    reset: task.reset,
  };
}
