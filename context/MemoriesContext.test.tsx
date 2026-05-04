/**
 * Layer 3 free-tier defense pin (Task #144 follow-up).
 *
 * `MemoriesContext.addMemory` is the last-mile guard against a stale
 * UI / multi-tab caller sneaking past the daily capture cap. The
 * Task #144 contract is that the throw uses the LIVE
 * `useSubscription().freeDailyCaptureLimit` value (which itself
 * mirrors the server's `/subscription/entitlement.freeDailyCaptureLimit`),
 * not the compiled-in `FREE_DAILY_CAPTURE_LIMIT` constant of 10.
 *
 * If a future refactor reverted to the constant, a free user mid-
 * promotion (server cap = 3 here) could capture all 10 hard-coded
 * slots before tripping the wall — silently breaking on-call's
 * runtime tightening of the cap. This test sets the live cap to 3
 * and asserts:
 *
 *   - the first 3 captures succeed,
 *   - the 4th throws `CaptureLimitReachedError`, AND
 *   - the thrown `limit` field equals the live cap (3), not 10.
 *
 * Heavy import surface (memories api, illustrations api,
 * annotations api, sync outbox apis, ai engine, foundation models)
 * is mocked at the module boundary so the provider can mount
 * without spinning up a real backend.
 */
import React from "react";
import { act, render } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  MemoriesProvider,
  useMemories,
} from "@/context/MemoriesContext";
import {
  CaptureLimitReachedError,
  FREE_DAILY_CAPTURE_LIMIT,
} from "@/lib/subscription";

// Mutable mock state. Wrapped so the jest.mock factory can read the
// current value through a stable reference (the factory is hoisted
// above these declarations).
const mockSubscriptionState: {
  current: {
    status: { is_pro: boolean } | null;
    freeDailyCaptureLimit: number;
  };
} = {
  current: { status: { is_pro: false }, freeDailyCaptureLimit: 3 },
};

const mockAuthUser = {
  email: "alice@example.com",
  id: "u-1",
  displayName: "Alice",
};

// In-memory AsyncStorage. The default jest.setup.js stub returns
// null for everything which would mean a successful drain immediately
// "loses" the optimistic row on the next loadMemories cycle (cache
// returns empty, server stub returns empty, outbox is empty after
// success → merge yields []). A real backing store models the live
// cache + outbox behaviour the cap check is supposed to gate on.
const mockStore = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) =>
      Promise.resolve(mockStore.has(key) ? mockStore.get(key)! : null),
    ),
    setItem: jest.fn((key: string, value: string) => {
      mockStore.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      mockStore.delete(key);
      return Promise.resolve();
    }),
    multiGet: jest.fn(() => Promise.resolve([])),
    multiSet: jest.fn(() => Promise.resolve()),
    multiRemove: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => {
      mockStore.clear();
      return Promise.resolve();
    }),
  },
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockAuthUser, isLoading: false }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => mockSubscriptionState.current,
}));

// `lib/memories` exports both the api functions (which we stub) and
// pure helpers like `newClientId` / `mergeAnnotations` that
// MemoriesContext relies on. Spread the actual module so the helpers
// keep working, then stub the network surface.
jest.mock("@/lib/memories", () => {
  const actual = jest.requireActual("@/lib/memories");
  return {
    ...actual,
    apiCreateMemory: jest.fn(() =>
      Promise.resolve({ ok: true, server_id: "srv-1" }),
    ),
    apiUpdateMemory: jest.fn(() => Promise.resolve({ ok: true })),
    apiDeleteMemory: jest.fn(() => Promise.resolve({ ok: true })),
    // Simulate "offline" so `loadMemories` falls back to the local
    // AsyncStorage cache rather than overwriting it with an empty
    // server snapshot. Without this fallback path, the optimistic
    // row written by `addMemory` would be dropped on the very next
    // outbox-driven `loadMemories` cycle (server returns [], outbox
    // is already empty after a successful drain → merge yields []),
    // making "today's count" forever stuck at 0 and silently hiding
    // any cap-throwing regression.
    apiListMemoriesWithTimeout: jest.fn(() =>
      Promise.reject(new Error("offline (test)")),
    ),
    apiSearchMemoriesWithTimeout: jest.fn(() => Promise.resolve([])),
  };
});

jest.mock("@/lib/annotations", () => ({
  apiFetchAnnotations: jest.fn(() => Promise.resolve({})),
  apiPutAnnotation: jest.fn(() => Promise.resolve({ ok: true })),
  apiDeleteAnnotation: jest.fn(() => Promise.resolve({ ok: true })),
}));

jest.mock("@/lib/illustrations", () => {
  const actual = jest.requireActual("@/lib/illustrations");
  return {
    ...actual,
    apiFetchIllustrations: jest.fn(() =>
      Promise.resolve({ items: {}, usedToday: 0, limit: 1 }),
    ),
    apiIllustrateMemory: jest.fn(),
    apiDeleteIllustration: jest.fn(),
  };
});

jest.mock("@/lib/api", () => ({
  setSyncProActive: jest.fn(),
}));

jest.mock("@/lib/aiEngine", () => ({
  enqueueMemoriesForEmbedding: jest.fn(),
  refreshPatternsIfDue: jest.fn(() => Promise.resolve()),
  runDailyReaper: jest.fn(() => Promise.resolve()),
  configureEngineMutator: jest.fn(),
}));

jest.mock("@/lib/backfillFacets", () => ({
  backfillMissingFacets: jest.fn(() => Promise.resolve()),
}));

jest.mock("@/modules/foundation-models", () => ({
  extractFacets: jest.fn(() => Promise.resolve(null)),
  getAvailability: jest.fn(() =>
    Promise.resolve({ available: false, reason: "non_ios_platform" }),
  ),
}));

interface CapturedHandle {
  current: ReturnType<typeof useMemories> | null;
}

function Consumer({ handle }: { handle: CapturedHandle }) {
  handle.current = useMemories();
  return null;
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("MemoriesContext.addMemory — live capture limit (Task #144)", () => {
  beforeEach(() => {
    mockStore.clear();
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    (AsyncStorage.removeItem as jest.Mock).mockClear();
    mockSubscriptionState.current = {
      status: { is_pro: false },
      freeDailyCaptureLimit: 3,
    };
  });

  test("throws CaptureLimitReachedError at the LIVE cap, not the compiled-in default", async () => {
    // Sanity: this test only proves what it claims when the live
    // cap is strictly less than the compiled-in default. A future
    // raise of the constant must fail loudly here so we update
    // both numbers in lockstep.
    expect(mockSubscriptionState.current.freeDailyCaptureLimit).toBeLessThan(
      FREE_DAILY_CAPTURE_LIMIT,
    );

    const handle: CapturedHandle = { current: null };
    render(
      <MemoriesProvider>
        <Consumer handle={handle} />
      </MemoriesProvider>,
    );
    // Let the initial loadMemories promise + facet backfill tick.
    await flushAsync();
    await flushAsync();

    expect(handle.current).not.toBeNull();
    expect(handle.current!.memories).toEqual([]);

    // Burn through the live cap (3 captures). Each succeeds because
    // we're under the cap and the outbox `apiCreateMemory` mock
    // resolves cleanly.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await handle.current!.addMemory(`live-cap memory ${i}`);
      });
      await flushAsync();
    }

    expect(handle.current!.memories.length).toBe(3);

    // 4th capture must trip Layer 3. If a future refactor reverts
    // to the hard-coded `FREE_DAILY_CAPTURE_LIMIT` (10), this call
    // would happily succeed and only fail at capture #11 — silently
    // ignoring on-call's runtime tightening.
    let thrown: unknown = null;
    await act(async () => {
      try {
        await handle.current!.addMemory("overflow");
      } catch (err) {
        thrown = err;
      }
    });

    expect(thrown).toBeInstanceOf(CaptureLimitReachedError);
    expect((thrown as CaptureLimitReachedError).limit).toBe(3);
    expect((thrown as CaptureLimitReachedError).limit).not.toBe(
      FREE_DAILY_CAPTURE_LIMIT,
    );
    // Failed call must not have appended an optimistic row.
    expect(handle.current!.memories.length).toBe(3);
  });

  test("Pro users are not subject to the live cap (defense-in-depth)", async () => {
    // Pro flag flips the limit check off entirely. We seed the
    // same low live cap (3) but mark the user Pro and verify the
    // 4th call goes through. Without this the test above would
    // pass even if the wrong branch (e.g. ignoring `is_pro`) was
    // doing the gating.
    mockSubscriptionState.current = {
      status: { is_pro: true },
      freeDailyCaptureLimit: 3,
    };

    const handle: CapturedHandle = { current: null };
    render(
      <MemoriesProvider>
        <Consumer handle={handle} />
      </MemoriesProvider>,
    );
    await flushAsync();
    await flushAsync();

    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await handle.current!.addMemory(`pro memory ${i}`);
      });
      await flushAsync();
    }

    expect(handle.current!.memories.length).toBe(4);
  });
});
