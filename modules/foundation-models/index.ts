// JS surface for the local `foundation-models` Expo module.
//
// The module is iOS 26+ only. On every other platform/version we
// short-circuit with a typed `unavailable` result so callers can
// render a meaningful fallback without crashing. The native side is
// gated by `#if canImport(FoundationModels)` and runtime
// `if #available(iOS 26.0, *)` — see `ios/FoundationModelsModule.swift`.

import { Platform } from "react-native";

export type FMUnavailableReason =
  | "ios_below_26"
  | "device_not_eligible"
  | "apple_intelligence_not_enabled"
  | "model_not_ready"
  | "framework_not_present"
  | "module_not_linked"
  | "non_ios_platform"
  | "empty_input"
  | "unknown";

export type FMAvailability = {
  available: boolean;
  reason: FMUnavailableReason | null;
};

export type FMSummarizeResult =
  | {
      status: "ok";
      summary: string;
      latencyMs: number;
      approxTokens: number;
    }
  | {
      status: "unavailable";
      reason: FMUnavailableReason;
    };

/**
 * Structured tag/theme/mood facets extracted from a memory's
 * content by Apple's on-device FoundationModels (iOS 26+) via the
 * `@Generable` macro on the native side. All three fields are
 * always present in the `ok` case — the Swift bridge fills in
 * empty strings / empty arrays rather than nulls so the JS layer
 * doesn't have to branch per-field.
 *
 * `tags`  : up to ~5 short, lowercase, single-word topical tags
 *           describing what the entry is about. Drives the existing
 *           patterns / themes surfaces in `lib/aiEngine.ts`.
 * `theme` : a short noun phrase ("morning runs", "dad calls") that
 *           captures the recurring pattern this memory belongs to.
 *           One sentence fragment, no trailing punctuation.
 * `mood`  : a single lowercase emotion word ("calm", "anxious",
 *           "grateful"). Empty string if the model can't infer one.
 *
 * `latencyMs` and `approxTokens` mirror the summary path so the
 * dev spike screen can graph either call's performance with the
 * same chart code.
 */
export type FMMemoryFacets = {
  tags: string[];
  theme: string;
  mood: string;
};

export type FMExtractFacetsResult =
  | {
      status: "ok";
      facets: FMMemoryFacets;
      latencyMs: number;
      approxTokens: number;
    }
  | {
      status: "unavailable";
      reason: FMUnavailableReason;
    };

// Payload shapes for the streaming summarize events emitted by Swift.
export type FMStreamChunkEvent = { chunk: string };
export type FMStreamDoneEvent = { latencyMs: number; approxTokens: number };
export type FMStreamErrorEvent = { reason: string };

// Subscription handle returned by native.addListener (Expo module Events API).
type NativeSubscription = { remove: () => void };

type NativeShape = {
  getAvailability: () => { available: boolean; reason: string | null };
  summarize: (
    text: string,
  ) => Promise<
    | { status: "ok"; summary: string; latencyMs: number; approxTokens: number }
    | { status: "unavailable"; reason: string }
  >;
  // Streaming summarize — starts the Swift Task. Progress arrives via events.
  summarizeStream: (text: string) => void;
  cancelSummarizeStream: () => void;
  extractFacets: (
    text: string,
  ) => Promise<
    | {
        status: "ok";
        facets: { tags: string[]; theme: string; mood: string };
        latencyMs: number;
        approxTokens: number;
      }
    | { status: "unavailable"; reason: string }
  >;
  // Expo modules auto-add addListener when Events() is declared in Swift.
  addListener: (
    eventName: string,
    listener: (event: Record<string, unknown>) => void,
  ) => NativeSubscription;
};

let cachedNative: NativeShape | null | undefined;

// True cold-start latency only happens on the very first
// `LanguageModelSession` call after the process launches: that's when
// the FoundationModels framework pages model weights into the Neural
// Engine's cache. Subsequent calls in the same process pay only the
// per-call session-construction cost ("warm"). We track this in JS so
// the dev spike screen can label runs accurately even after the user
// navigates away and comes back. Once flipped to true it stays true
// for the life of the process — there is no public API to evict the
// model and re-pay the cold cost without restarting the app.
let coldStartConsumed = false;

/** True if no `summarize` call has completed in this process yet. */
export function isFirstRunInProcess(): boolean {
  return !coldStartConsumed;
}

/** Mark the cold-start cost as paid. Called by `summarize` / stream `onDone`. */
export function markRunCompleted(): void {
  coldStartConsumed = true;
}

function getNativeModule(): NativeShape | null {
  if (cachedNative !== undefined) return cachedNative;
  if (Platform.OS !== "ios") {
    cachedNative = null;
    return cachedNative;
  }
  try {
    // `requireNativeModule` throws synchronously when the native
    // module is not linked into the running binary (Expo Go, web,
    // older dev clients built before this module was added). We
    // swallow the throw so callers always get a typed fallback.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require("expo-modules-core") as {
      requireNativeModule: (name: string) => NativeShape;
    };
    cachedNative = core.requireNativeModule("FoundationModels");
  } catch {
    cachedNative = null;
  }
  return cachedNative;
}

function normalizeReason(reason: string | null | undefined): FMUnavailableReason {
  switch (reason) {
    case "ios_below_26":
    case "device_not_eligible":
    case "apple_intelligence_not_enabled":
    case "model_not_ready":
    case "framework_not_present":
    case "module_not_linked":
    case "non_ios_platform":
    case "empty_input":
      return reason;
    default:
      return "unknown";
  }
}

export function getAvailability(): FMAvailability {
  if (Platform.OS !== "ios") {
    return { available: false, reason: "non_ios_platform" };
  }
  const native = getNativeModule();
  if (!native) {
    return { available: false, reason: "module_not_linked" };
  }
  try {
    const result = native.getAvailability();
    return {
      available: !!result.available,
      reason: result.available ? null : normalizeReason(result.reason),
    };
  } catch {
    return { available: false, reason: "unknown" };
  }
}

export async function summarize(text: string): Promise<FMSummarizeResult> {
  if (Platform.OS !== "ios") {
    return { status: "unavailable", reason: "non_ios_platform" };
  }
  const native = getNativeModule();
  if (!native) {
    return { status: "unavailable", reason: "module_not_linked" };
  }
  const result = await native.summarize(text);
  if (result.status === "ok") {
    markRunCompleted();
    return result;
  }
  return { status: "unavailable", reason: normalizeReason(result.reason) };
}

/**
 * Subscription handle returned by `subscribeSummarizeStream`.
 * Call `remove()` to unsubscribe all listeners and cancel the
 * in-flight stream Task on the native side.
 */
export type FMStreamSubscription = { remove: () => void };

/**
 * Start a streaming summarization and subscribe to its events.
 *
 * This is the streaming counterpart to `summarize`. Instead of
 * returning a Promise, it fires the three callbacks as the native
 * Task progresses:
 *
 *   `onChunk(text)`   — called for each partial accumulated result
 *                       emitted by `streamResponse`. The value is the
 *                       *full* text so far (not a delta), so callers
 *                       should set their state to `text` rather than
 *                       appending. Called zero or more times before
 *                       `onDone` or `onError`.
 *   `onDone(payload)` — called once when streaming completes; receives
 *                       wall-clock `latencyMs` and `approxTokens`.
 *                       `markRunCompleted()` is called automatically
 *                       so callers don't have to.
 *   `onError(reason)` — called if the stream fails or is cancelled.
 *
 * Returns a `{ remove }` handle. Call `remove()` to cancel the
 * in-flight Task and unsubscribe all listeners — this is the
 * mechanism behind the "Reset mid-generation" requirement.
 *
 * Falls back gracefully (calls `onError` immediately) on non-iOS
 * platforms or when the module is not linked.
 */
export function subscribeSummarizeStream(
  text: string,
  {
    onChunk,
    onDone,
    onError,
  }: {
    onChunk: (partialText: string) => void;
    onDone: (payload: FMStreamDoneEvent) => void;
    onError: (reason: FMUnavailableReason) => void;
  },
): FMStreamSubscription {
  if (Platform.OS !== "ios") {
    onError("non_ios_platform");
    return { remove: () => undefined };
  }
  const native = getNativeModule();
  if (!native) {
    onError("module_not_linked");
    return { remove: () => undefined };
  }
  if (
    typeof native.addListener !== "function" ||
    typeof native.summarizeStream !== "function" ||
    typeof native.cancelSummarizeStream !== "function"
  ) {
    // Older dev clients built before the streaming methods / Events()
    // were declared. Treat the same as a missing binary so the UI's
    // existing fallback copy applies without a hard throw.
    onError("module_not_linked");
    return { remove: () => undefined };
  }

  let removed = false;

  // Subscribe to the three event types. Expo module `addListener` returns a
  // subscription with a `remove()` method — no external EventEmitter wrapper
  // needed because `Events(...)` in the Swift bridge auto-registers the API.
  const chunkSub = native.addListener("onSummarizeChunk", (e) => {
    if (!removed) onChunk(e["chunk"] as string);
  });
  const doneSub = native.addListener("onSummarizeDone", (e) => {
    if (!removed) {
      markRunCompleted();
      onDone({
        latencyMs: e["latencyMs"] as number,
        approxTokens: e["approxTokens"] as number,
      });
    }
  });
  const errorSub = native.addListener("onSummarizeError", (e) => {
    if (!removed) {
      onError(normalizeReason(e["reason"] as string));
    }
  });

  // Kick off the native stream after subscribing so we don't miss
  // any early events (unlikely on the main thread but defensive).
  native.summarizeStream(text);

  const remove = () => {
    if (removed) return;
    removed = true;
    chunkSub.remove();
    doneSub.remove();
    errorSub.remove();
    // Cancel the in-flight Swift Task.
    try {
      native.cancelSummarizeStream();
    } catch {
      // Ignore — the Task may have already finished naturally.
    }
  };

  return { remove };
}

/**
 * Run the on-device facet extractor over a memory's text.
 *
 * Mirrors the shape of `summarize` so callers can use the same
 * `useOnDeviceTask` status-machine helper. When the device cannot
 * run the model (older iOS, ineligible hardware, Apple Intelligence
 * disabled, or even just "not iOS"), this resolves to a typed
 * `{ status: "unavailable", reason }` instead of throwing. The
 * native bridge defensively normalizes its returned reason strings
 * so an unrecognized value here becomes `"unknown"`.
 *
 * Defensive shape-guard: the native module is supposed to always
 * return a `facets` object with the three required fields, but if a
 * future Swift refactor (or a broken cached binary) forgets one,
 * the JS layer fills in safe empty values rather than handing the
 * caller `undefined`. Callers downstream persist these directly
 * onto a Memory and `undefined` would break JSON round-trips.
 */
export async function extractFacets(
  text: string,
): Promise<FMExtractFacetsResult> {
  if (Platform.OS !== "ios") {
    return { status: "unavailable", reason: "non_ios_platform" };
  }
  const native = getNativeModule();
  if (!native) {
    return { status: "unavailable", reason: "module_not_linked" };
  }
  if (typeof native.extractFacets !== "function") {
    // Older dev clients built before this method shipped. Surface
    // the same machine-readable reason as a missing binary so the
    // UI's existing fallback copy applies.
    return { status: "unavailable", reason: "module_not_linked" };
  }
  const result = await native.extractFacets(text);
  if (result.status === "ok") {
    const raw = result.facets ?? { tags: [], theme: "", mood: "" };
    return {
      status: "ok",
      facets: {
        tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string") : [],
        theme: typeof raw.theme === "string" ? raw.theme : "",
        mood: typeof raw.mood === "string" ? raw.mood : "",
      },
      latencyMs: result.latencyMs,
      approxTokens: result.approxTokens,
    };
  }
  return { status: "unavailable", reason: normalizeReason(result.reason) };
}

// Test-only escape hatch so jest can simulate the module being
// linked / unavailable without touching real native code.
export function __setNativeModuleForTests(module: NativeShape | null): void {
  cachedNative = module;
}

export function __resetNativeModuleForTests(): void {
  cachedNative = undefined;
  coldStartConsumed = false;
}
