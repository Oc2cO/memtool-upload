/**
 * Coverage for `deleteIllustration` in MemoriesContext (Task #210).
 *
 * The lightbox's "Remove" action lives on top of this method; without
 * coverage a refactor that forgot to clear the local fields, or that
 * dropped the "no illustration → short-circuit" guard, would silently
 * regress in two ways the user would only notice at runtime:
 *
 *   1. Success path: the row keeps showing the (now-stale) polaroid
 *      until the next bulk pull because we forgot to strip
 *      illustrationUrl / illustratedAt from the in-memory list.
 *   2. Server error path: the row optimistically clears its polaroid
 *      even though the server still has the record, so the next
 *      bulk pull re-attaches it (visible flicker).
 *   3. No-op path: a memory that has no illustration burns a network
 *      round trip on every Remove tap because the short-circuit was
 *      removed.
 *
 * The provider is heavy (auth, subscription, sync outbox, AI engine,
 * facets backfill, …) so this suite mocks every imported module to a
 * minimal stub. We only assert on the deleteIllustration contract;
 * the rest of the provider's behavior is covered elsewhere.
 */

import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";

const mockApiDeleteIllustration = jest.fn();
const mockApiFetchIllustrations = jest.fn();
const mockApiIllustrateMemory = jest.fn();
const mockApiListMemoriesWithTimeout = jest.fn();
const mockApiFetchAnnotations = jest.fn();

// IMPORTANT: every value the mocked hooks return must be reference-
// stable across renders. `user` is an indirect dependency of
// MemoriesContext's `loadMemories` useCallback; `subscriptionStatus`
// is read inside it. A fresh object literal here would re-create
// `loadMemories` on every render, re-fire its `useEffect`, and
// deadlock the provider in a setIsLoading → re-render loop.
jest.mock("@/context/AuthContext", () => {
  const stableUser = { email: "tester@example.com", id: "user-1" };
  const stableAuth = { user: stableUser, isLoading: false };
  return { useAuth: () => stableAuth };
});

jest.mock("@/context/SubscriptionContext", () => {
  const stableStatus = { is_pro: false };
  const stableSub = { status: stableStatus, freeDailyCaptureLimit: 10 };
  return { useSubscription: () => stableSub };
});

// Memory list helpers — only the bits MemoriesContext actually calls
// inside loadMemories / deleteIllustration. Everything else returns
// neutral values (no outbox writes, no extra fetches) so the test
// body can focus on the delete branch.
jest.mock("@/lib/memories", () => ({
  apiCreateMemory: jest.fn(),
  apiDeleteMemory: jest.fn(),
  apiUpdateMemory: jest.fn(),
  apiListMemoriesWithTimeout: (...args: unknown[]) =>
    mockApiListMemoriesWithTimeout(...args),
  apiSearchMemoriesWithTimeout: jest.fn().mockResolvedValue([]),
  extractAnnotation: () => null,
  // Pass-through merge: the test seeds memories that already carry
  // illustrationUrl, so an annotation merge is a no-op for our
  // assertions but the provider still calls it during loadMemories.
  mergeAnnotations: <T,>(memories: T[]) => memories,
  newClientId: () => "client-id",
}));

jest.mock("@/lib/annotations", () => ({
  apiDeleteAnnotation: jest.fn(),
  apiFetchAnnotations: (...args: unknown[]) =>
    mockApiFetchAnnotations(...args),
  apiPutAnnotation: jest.fn(),
}));

jest.mock("@/lib/illustrations", () => ({
  // The system under test.
  apiDeleteIllustration: (...args: unknown[]) =>
    mockApiDeleteIllustration(...args),
  apiFetchIllustrations: (...args: unknown[]) =>
    mockApiFetchIllustrations(...args),
  apiIllustrateMemory: (...args: unknown[]) =>
    mockApiIllustrateMemory(...args),
  // Real-shape merge so the provider's loadMemories actually attaches
  // illustrationUrl / illustratedAt to the seeded memories — testing
  // the merge here would duplicate `illustrations.test.ts`, but
  // running the real one keeps the test honest about what the
  // provider hands deleteIllustration.
  mergeIllustrations: <
    M extends {
      id: string;
      illustrationUrl?: string;
      illustratedAt?: string;
    },
  >(
    memories: M[],
    map: Record<string, { url: string; generatedAt?: string }>,
  ): M[] =>
    memories.map((m) => {
      const entry = map[m.id];
      if (!entry) return m;
      return {
        ...m,
        illustrationUrl: entry.url,
        illustratedAt: entry.generatedAt ?? m.illustratedAt,
      };
    }),
}));

jest.mock("@/lib/aiEngine", () => ({
  configureEngineMutator: jest.fn(),
  enqueueMemoriesForEmbedding: jest.fn(),
  refreshPatternsIfDue: jest.fn().mockResolvedValue(undefined),
  runDailyReaper: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/backfillFacets", () => ({
  backfillMissingFacets: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/modules/foundation-models", () => ({
  extractFacets: jest.fn(),
  getAvailability: () => ({ available: false, reason: "device" }),
}));

jest.mock("@/lib/captureLimits", () => ({
  getCaptureLimitState: () => ({
    atLimit: false,
    used: 0,
    limit: 10,
  }),
  getLibraryWindowState: () => ({ inWindow: true, daysFromNow: 0 }),
  isTimestampToday: () => false,
}));

jest.mock("@/lib/syncOutbox", () => ({
  ANNOTATE_ID_PREFIX: "ann:",
  annotateOutboxId: (id: string) => `ann:${id}`,
  summarizeMemoryDrainOutcomes: () => ({ synced: 0, failed: 0 }),
}));

// useSyncOutbox is its own module; the provider unwraps drainNow,
// outbox, etc. Keep it inert so no background heartbeat fires.
//
// IMPORTANT: every value the hook returns must be reference-stable
// across renders. `outbox` is a dependency of MemoriesContext's
// `loadMemories` useCallback, so a fresh `[]` literal returned on
// every render would re-create `loadMemories`, which would re-fire
// the `useEffect(loadMemories, [loadMemories])` and dispatch
// `setIllustrationsUsedToday` in an infinite loop until React
// trips the maximum-update-depth guard.
//
// We build the stable result inside the factory because babel-jest
// hoists `jest.mock(...)` above any local `const` declarations and
// only tolerates references to variables prefixed with `mock`.
jest.mock("@/lib/useSyncOutbox", () => {
  const stable = {
    outbox: [] as never[],
    enqueue: jest.fn().mockResolvedValue(undefined),
    drainNow: jest.fn().mockResolvedValue([]),
    stuckCount: 0,
  };
  return { useSyncOutbox: () => stable };
});

// Subscription error classes are referenced in addMemory; we don't
// hit that path but the provider imports them at module load.
jest.mock("@/lib/subscription", () => ({
  CaptureBlockedError: class {},
  CaptureLimitReachedError: class {},
  LibraryWindowLockedError: class {},
}));

import { MemoriesProvider, useMemories } from "./MemoriesContext";

interface TestSeedMemory {
  id: string;
  content: string;
  timestamp: string;
  kind: "memory" | "call";
  illustrationUrl?: string;
  illustratedAt?: string;
}

// Capture the live context value from inside a child consumer so the
// test body can call deleteIllustration directly. We can't use
// renderHook here because MemoriesProvider's loadMemories effect runs
// asynchronously and we need to await `memories` populating before
// firing the delete.
function makeHarness() {
  const ref: { current: ReturnType<typeof useMemories> | null } = {
    current: null,
  };
  const Consumer: React.FC = () => {
    ref.current = useMemories();
    return null;
  };
  const tree = (
    <MemoriesProvider>
      <Consumer />
    </MemoriesProvider>
  );
  return { ref, tree };
}

async function setupWithMemory(seed: TestSeedMemory) {
  // The provider's loadMemories merges illustrations onto whatever
  // apiListMemoriesWithTimeout returns. We simulate the bulk pull
  // returning a "raw" memory and the illustrations endpoint
  // returning a matching map, so after the effect settles the
  // in-memory list carries illustrationUrl exactly the way the real
  // pipeline would.
  mockApiListMemoriesWithTimeout.mockResolvedValue([
    {
      id: seed.id,
      content: seed.content,
      timestamp: seed.timestamp,
      kind: seed.kind,
    },
  ]);
  mockApiFetchAnnotations.mockResolvedValue({});
  if (seed.illustrationUrl) {
    mockApiFetchIllustrations.mockResolvedValue({
      items: {
        [seed.id]: {
          url: seed.illustrationUrl,
          generatedAt: seed.illustratedAt ?? "2026-05-01T00:00:00.000Z",
        },
      },
      usedToday: 1,
      limit: 1,
    });
  } else {
    mockApiFetchIllustrations.mockResolvedValue({
      items: {},
      usedToday: 0,
      limit: 1,
    });
  }

  const { ref, tree } = makeHarness();
  render(tree);

  await waitFor(() => {
    expect(ref.current).not.toBeNull();
    expect(ref.current!.memories).toHaveLength(1);
    if (seed.illustrationUrl) {
      expect(ref.current!.memories[0]!.illustrationUrl).toBe(
        seed.illustrationUrl,
      );
    }
  });

  return ref;
}

describe("MemoriesContext.deleteIllustration (Task #210)", () => {
  beforeEach(() => {
    mockApiDeleteIllustration.mockReset();
    mockApiFetchIllustrations.mockReset();
    mockApiIllustrateMemory.mockReset();
    mockApiListMemoriesWithTimeout.mockReset();
    mockApiFetchAnnotations.mockReset();
  });

  test("on `ok` it strips illustrationUrl/illustratedAt from the in-memory row", async () => {
    mockApiDeleteIllustration.mockResolvedValueOnce({
      kind: "ok",
      removed: true,
    });

    const ref = await setupWithMemory({
      id: "mem-1",
      content: "evening tea",
      timestamp: "2026-05-01T18:00:00.000Z",
      kind: "memory",
      illustrationUrl: "https://example.com/illos/mem-1.png",
      illustratedAt: "2026-05-01T19:00:00.000Z",
    });

    let result;
    await act(async () => {
      result = await ref.current!.deleteIllustration("mem-1");
    });

    expect(result).toEqual({ kind: "ok", removed: true });
    // Only one network call — the server is the single source of
    // truth for the actual delete; the local clear is the optimistic
    // mirror.
    expect(mockApiDeleteIllustration).toHaveBeenCalledTimes(1);
    expect(mockApiDeleteIllustration).toHaveBeenCalledWith("mem-1");

    const row = ref.current!.memories.find((m) => m.id === "mem-1")!;
    expect(row.illustrationUrl).toBeUndefined();
    expect(row.illustratedAt).toBeUndefined();
  });

  test("on `server_error` it leaves illustrationUrl/illustratedAt in place (no optimistic clear)", async () => {
    mockApiDeleteIllustration.mockResolvedValueOnce({
      kind: "server_error",
      message: "boom",
    });

    const ref = await setupWithMemory({
      id: "mem-2",
      content: "morning coffee",
      timestamp: "2026-05-01T08:00:00.000Z",
      kind: "memory",
      illustrationUrl: "https://example.com/illos/mem-2.png",
      illustratedAt: "2026-05-01T09:00:00.000Z",
    });

    let result;
    await act(async () => {
      result = await ref.current!.deleteIllustration("mem-2");
    });

    expect(result).toEqual({ kind: "server_error", message: "boom" });
    expect(mockApiDeleteIllustration).toHaveBeenCalledTimes(1);

    // Critical regression guard: a server failure must NOT clear the
    // polaroid locally — otherwise the next bulk pull would
    // re-attach it and the user would see a flicker.
    const row = ref.current!.memories.find((m) => m.id === "mem-2")!;
    expect(row.illustrationUrl).toBe("https://example.com/illos/mem-2.png");
    expect(row.illustratedAt).toBe("2026-05-01T09:00:00.000Z");
  });

  test("short-circuits without a network call when the row already has no illustration", async () => {
    const ref = await setupWithMemory({
      id: "mem-3",
      content: "a memory with no painting",
      timestamp: "2026-05-01T12:00:00.000Z",
      kind: "memory",
      // no illustrationUrl
    });

    let result;
    await act(async () => {
      result = await ref.current!.deleteIllustration("mem-3");
    });

    // The contract: removed:false because there was nothing to
    // remove, and crucially zero round trips — a stale double-tap
    // from the lightbox after a successful first delete would
    // otherwise pile DELETEs onto the api-server for no reason.
    expect(result).toEqual({ kind: "ok", removed: false });
    expect(mockApiDeleteIllustration).not.toHaveBeenCalled();
  });
});
