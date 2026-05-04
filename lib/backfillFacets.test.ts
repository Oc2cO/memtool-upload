// Tests for the on-device facets backfill helper (Task #277).
//
// The helper is pure (no React, no AsyncStorage) so the tests can
// drive it with plain fakes — the extractor is a function ref the
// caller supplies and `onResult` is the persistence hook. We never
// touch `requireNativeModule` here because the helper itself never
// reaches into the Foundation Models module.

import {
  backfillMissingFacets,
  BACKFILL_PAUSE_MS,
} from "./backfillFacets";
import type { Memory, MemoryFacets } from "./memories";
import type { FMExtractFacetsResult } from "../modules/foundation-models";

function row(
  id: string,
  overrides: Partial<Memory> = {},
): Memory {
  return {
    id,
    userId: "u@example.com",
    content: `body of ${id}`,
    timestamp: "2026-04-01T00:00:00Z",
    kind: "memory",
    ...overrides,
  };
}

function okResult(
  facets: Partial<MemoryFacets> = {},
): FMExtractFacetsResult {
  return {
    status: "ok",
    facets: {
      tags: facets.tags ?? ["a"],
      theme: facets.theme ?? "t",
      mood: facets.mood ?? "calm",
    },
    latencyMs: 100,
    approxTokens: 5,
  };
}

describe("backfillMissingFacets", () => {
  it("skips entirely when the on-device model is not available", async () => {
    const extract = jest.fn();
    const onResult = jest.fn();
    const summary = await backfillMissingFacets(
      [row("a"), row("b")],
      { available: false, extract, onResult },
    );

    expect(extract).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    expect(summary).toEqual({
      candidates: 0,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: true,
      aborted: false,
    });
  });

  it("only processes rows missing the `facets` field", async () => {
    const memories: Memory[] = [
      row("a"),
      row("b", {
        facets: { tags: ["already"], theme: "set", mood: "calm" },
      }),
      row("c"),
    ];
    const extract = jest
      .fn<Promise<FMExtractFacetsResult>, [string]>()
      .mockResolvedValue(okResult());
    const onResult = jest.fn();

    const summary = await backfillMissingFacets(memories, {
      available: true,
      extract,
      onResult,
      pauseMs: 0,
    });

    expect(extract).toHaveBeenCalledTimes(2);
    expect(extract).toHaveBeenNthCalledWith(1, "body of a");
    expect(extract).toHaveBeenNthCalledWith(2, "body of c");
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenNthCalledWith(1, "a", {
      tags: ["a"],
      theme: "t",
      mood: "calm",
    });
    expect(onResult).toHaveBeenNthCalledWith(2, "c", {
      tags: ["a"],
      theme: "t",
      mood: "calm",
    });
    expect(summary).toEqual({
      candidates: 2,
      attempted: 2,
      succeeded: 2,
      failed: 0,
      skipped: false,
      aborted: false,
    });
  });

  it("treats an extractor throw as a soft failure and keeps walking", async () => {
    const extract = jest
      .fn<Promise<FMExtractFacetsResult>, [string]>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(okResult({ tags: ["second"] }));
    const onResult = jest.fn();

    const summary = await backfillMissingFacets(
      [row("a"), row("b")],
      { available: true, extract, onResult, pauseMs: 0 },
    );

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith("b", {
      tags: ["second"],
      theme: "t",
      mood: "calm",
    });
    expect(summary).toEqual({
      candidates: 2,
      attempted: 2,
      succeeded: 1,
      failed: 1,
      skipped: false,
      aborted: false,
    });
  });

  it("counts an `onResult` rejection as a soft failure", async () => {
    const extract = jest
      .fn<Promise<FMExtractFacetsResult>, [string]>()
      .mockResolvedValue(okResult());
    const onResult = jest
      .fn()
      .mockRejectedValueOnce(new Error("storage full"))
      .mockResolvedValueOnce(undefined);

    const summary = await backfillMissingFacets(
      [row("a"), row("b")],
      { available: true, extract, onResult, pauseMs: 0 },
    );

    expect(extract).toHaveBeenCalledTimes(2);
    expect(summary.attempted).toBe(2);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it("bails out early when the model flips to `unavailable` mid-loop", async () => {
    // Simulates the user toggling Apple Intelligence off in
    // Settings while the backfill is mid-walk. No point burning
    // battery iterating the rest of the archive when every call
    // would hit the same path.
    const extract = jest
      .fn<Promise<FMExtractFacetsResult>, [string]>()
      .mockResolvedValueOnce(okResult())
      .mockResolvedValueOnce({
        status: "unavailable",
        reason: "apple_intelligence_not_enabled",
      });
    const onResult = jest.fn();

    const summary = await backfillMissingFacets(
      [row("a"), row("b"), row("c")],
      { available: true, extract, onResult, pauseMs: 0 },
    );

    expect(extract).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({
      candidates: 3,
      attempted: 2,
      succeeded: 1,
      failed: 1,
      skipped: false,
      aborted: true,
    });
  });

  it("respects an AbortSignal that fires before iteration starts", async () => {
    const extract = jest.fn();
    const onResult = jest.fn();
    const controller = new AbortController();
    controller.abort();

    const summary = await backfillMissingFacets(
      [row("a"), row("b")],
      {
        available: true,
        extract,
        onResult,
        pauseMs: 0,
        signal: controller.signal,
      },
    );

    expect(extract).not.toHaveBeenCalled();
    expect(summary.aborted).toBe(true);
    expect(summary.attempted).toBe(0);
  });

  it("respects an AbortSignal that fires mid-loop", async () => {
    const controller = new AbortController();
    const extract = jest
      .fn<Promise<FMExtractFacetsResult>, [string]>()
      .mockImplementation(async (text) => {
        if (text === "body of b") {
          // Abort just before the next iteration starts.
          controller.abort();
        }
        return okResult();
      });
    const onResult = jest.fn();

    const summary = await backfillMissingFacets(
      [row("a"), row("b"), row("c"), row("d")],
      {
        available: true,
        extract,
        onResult,
        pauseMs: 0,
        signal: controller.signal,
      },
    );

    // Two rows ran (a, b); the abort fires inside b's extractor,
    // so the post-iteration check stops the loop before c.
    expect(extract).toHaveBeenCalledTimes(2);
    expect(summary.attempted).toBe(2);
    expect(summary.aborted).toBe(true);
  });

  it("caps the candidate list at `maxPerSession`", async () => {
    const memories: Memory[] = Array.from({ length: 10 }, (_, i) =>
      row(`m${i}`),
    );
    const extract = jest
      .fn<Promise<FMExtractFacetsResult>, [string]>()
      .mockResolvedValue(okResult());
    const onResult = jest.fn();

    const summary = await backfillMissingFacets(memories, {
      available: true,
      extract,
      onResult,
      pauseMs: 0,
      maxPerSession: 3,
    });

    expect(extract).toHaveBeenCalledTimes(3);
    expect(summary.candidates).toBe(3);
    expect(summary.attempted).toBe(3);
    expect(summary.succeeded).toBe(3);
  });

  it("skips rows with empty content (extractor would short-circuit anyway)", async () => {
    const extract = jest
      .fn<Promise<FMExtractFacetsResult>, [string]>()
      .mockResolvedValue(okResult());
    const onResult = jest.fn();

    const summary = await backfillMissingFacets(
      [row("a", { content: "" }), row("b")],
      { available: true, extract, onResult, pauseMs: 0 },
    );

    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith("body of b");
    expect(summary.candidates).toBe(1);
  });

  it("exposes a sensible default pause constant", () => {
    // Sanity: the constant is a positive integer (units: ms).
    // Guard against an accidental zeroing-out that would let the
    // backfill saturate the Neural Engine.
    expect(BACKFILL_PAUSE_MS).toBeGreaterThan(0);
    expect(Number.isInteger(BACKFILL_PAUSE_MS)).toBe(true);
  });
});
