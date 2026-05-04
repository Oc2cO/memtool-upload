// Tests for the on-device facet extractor hook (Task #195).
//
// Mirrors the structure of `useOnDeviceSummary.test.ts` because both
// hooks ride on the same `useOnDeviceTask` status machine. We
// duplicate the cases (rather than parameterize) so a future
// extension of either hook (e.g. summary gaining a non-shared
// field, facets adding a confidence score) doesn't have to thread
// through a single combined harness.
//
// Task #196: mock objects now include stubs for the streaming fields
// (`summarizeStream`, `cancelSummarizeStream`, `addListener`) that
// `NativeShape` requires, even though `useMemoryFacets` itself never
// calls them (it uses the one-shot `extractFacets` promise path).

import { act, renderHook } from "@testing-library/react-native";

import {
  __resetNativeModuleForTests,
  __setNativeModuleForTests,
} from "../modules/foundation-models";
import { useMemoryFacets } from "./useMemoryFacets";

/** Minimal stub for the new streaming fields on NativeShape. */
function streamingStubs() {
  return {
    summarizeStream: jest.fn(),
    cancelSummarizeStream: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  };
}

afterEach(() => {
  __resetNativeModuleForTests();
});

describe("useMemoryFacets", () => {
  it("starts in 'unavailable' when the native module is not linked", () => {
    __setNativeModuleForTests(null);
    const { result } = renderHook(() => useMemoryFacets());

    expect(result.current.status).toBe("unavailable");
    expect(result.current.availability.available).toBe(false);
    expect(result.current.facets).toBeNull();
    expect(result.current.latencyMs).toBeNull();
    expect(result.current.approxTokens).toBeNull();
  });

  it("returns the on-device facets when native succeeds", async () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      summarize: jest.fn(),
      extractFacets: jest.fn().mockResolvedValue({
        status: "ok",
        facets: {
          tags: ["walk", "river"],
          theme: "evening walks with mira",
          mood: "calm",
        },
        latencyMs: 318,
        approxTokens: 9,
      }),
      ...streamingStubs(),
    });

    const { result } = renderHook(() => useMemoryFacets());
    expect(result.current.status).toBe("idle");

    let returned: Awaited<ReturnType<typeof result.current.run>> = null;
    await act(async () => {
      returned = await result.current.run("Walked along the river with Mira.");
    });

    expect(result.current.status).toBe("done");
    expect(result.current.facets).toEqual({
      tags: ["walk", "river"],
      theme: "evening walks with mira",
      mood: "calm",
    });
    expect(result.current.latencyMs).toBe(318);
    expect(result.current.approxTokens).toBe(9);
    expect(result.current.error).toBeNull();
    // `run` resolves with the facets payload directly so the
    // capture flow can attach them to the new memory in the same
    // tick — no waiting on React's async state flush.
    expect(returned).toEqual({
      tags: ["walk", "river"],
      theme: "evening walks with mira",
      mood: "calm",
    });
  });

  it("normalizes a malformed facets shape on the JS side", async () => {
    // The JS surface defensively coerces missing/garbage fields so
    // a buggy native build can't crash a downstream `MemoriesContext`
    // that JSON-stringifies the row to AsyncStorage.
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      summarize: jest.fn(),
      extractFacets: jest.fn().mockResolvedValue({
        status: "ok",
        facets: {
          tags: ["valid", 42, null, "also-valid"],
          theme: undefined,
          mood: 7,
        },
        latencyMs: 100,
        approxTokens: 2,
      }),
      ...streamingStubs(),
    });

    const { result } = renderHook(() => useMemoryFacets());
    await act(async () => {
      await result.current.run("anything");
    });

    expect(result.current.facets).toEqual({
      tags: ["valid", "also-valid"],
      theme: "",
      mood: "",
    });
  });

  it("flips to 'unavailable' with a reason when native reports unavailable mid-run", async () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      summarize: jest.fn(),
      extractFacets: jest
        .fn()
        .mockResolvedValue({ status: "unavailable", reason: "model_not_ready" }),
      ...streamingStubs(),
    });

    const { result } = renderHook(() => useMemoryFacets());
    let returned: Awaited<ReturnType<typeof result.current.run>> = null;
    await act(async () => {
      returned = await result.current.run("anything");
    });

    expect(result.current.status).toBe("unavailable");
    expect(result.current.reason).toBe("model_not_ready");
    expect(result.current.facets).toBeNull();
    expect(returned).toBeNull();
  });

  it("normalizes unknown reasons coming from the native side", async () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      summarize: jest.fn(),
      extractFacets: jest
        .fn()
        .mockResolvedValue({ status: "unavailable", reason: "totally-new-reason" }),
      ...streamingStubs(),
    });

    const { result } = renderHook(() => useMemoryFacets());
    await act(async () => {
      await result.current.run("anything");
    });

    expect(result.current.status).toBe("unavailable");
    expect(result.current.reason).toBe("unknown");
  });

  it("captures error messages when the native promise rejects", async () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      summarize: jest.fn(),
      extractFacets: jest.fn().mockRejectedValue(new Error("boom")),
      ...streamingStubs(),
    });

    const { result } = renderHook(() => useMemoryFacets());
    let returned: Awaited<ReturnType<typeof result.current.run>> = null;
    await act(async () => {
      returned = await result.current.run("anything");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("boom");
    expect(returned).toBeNull();
  });

  it("`run` is a no-op when availability is unavailable", async () => {
    const extractFacetsMock = jest.fn();
    __setNativeModuleForTests({
      getAvailability: () => ({
        available: false,
        reason: "apple_intelligence_not_enabled",
      }),
      summarize: jest.fn(),
      extractFacets: extractFacetsMock,
      ...streamingStubs(),
    });

    const { result } = renderHook(() => useMemoryFacets());
    let returned: Awaited<ReturnType<typeof result.current.run>> = null;
    await act(async () => {
      returned = await result.current.run("anything");
    });

    expect(extractFacetsMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("unavailable");
    expect(result.current.reason).toBe("apple_intelligence_not_enabled");
    expect(returned).toBeNull();
  });

  it("treats a missing `extractFacets` method as module_not_linked", async () => {
    // Older dev clients built before this method shipped would
    // satisfy `requireNativeModule` but not have the method itself.
    // The JS surface MUST surface that as the same machine-readable
    // reason as a missing binary so the UI's existing fallback copy
    // applies.
    const native = {
      getAvailability: () => ({ available: true, reason: null }),
      summarize: jest.fn(),
      ...streamingStubs(),
    };
    // Cast through unknown — the test deliberately reaches a state
    // the typed shape disallows.
    __setNativeModuleForTests(native as unknown as Parameters<typeof __setNativeModuleForTests>[0]);

    const { result } = renderHook(() => useMemoryFacets());
    await act(async () => {
      await result.current.run("anything");
    });

    expect(result.current.status).toBe("unavailable");
    expect(result.current.reason).toBe("module_not_linked");
  });

  it("`reset` clears facets state but preserves availability", async () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      summarize: jest.fn(),
      extractFacets: jest.fn().mockResolvedValue({
        status: "ok",
        facets: { tags: ["x"], theme: "y", mood: "z" },
        latencyMs: 10,
        approxTokens: 1,
      }),
      ...streamingStubs(),
    });

    const { result } = renderHook(() => useMemoryFacets());
    await act(async () => {
      await result.current.run("anything");
    });
    expect(result.current.status).toBe("done");

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.facets).toBeNull();
    expect(result.current.latencyMs).toBeNull();
  });
});
