/**
 * Hydration & null-safety contract for the live free-tier daily
 * capture cap (Task #144 follow-up). Two paths matter to the user:
 *
 *   1. Cold launch with a previously persisted cap → the provider
 *      MUST hydrate from AsyncStorage so the very first render of
 *      the home/capture surfaces shows the right "X of Y left",
 *      not a brief flash of the compiled-in 10.
 *
 *   2. A `/subscription/entitlement` response that lacks the
 *      `freeDailyCaptureLimit` field (older api-server build, or
 *      a transient regression) MUST NOT clobber the previously
 *      good cached cap with `null` / the bare default. A free
 *      user mid-promotion would otherwise see the upsell wall
 *      drop from "X of 20" back to "X of 10" between refreshes.
 *
 * The provider also exposes the cap to UI code via `useSubscription`,
 * so the assertions thread through a tiny consumer rather than
 * poking provider internals.
 */
import React from "react";
import { act, render } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  SubscriptionProvider,
  useSubscription,
} from "@/context/SubscriptionContext";
import type { SubscriptionStatus } from "@/lib/subscription";
import type { ServerEntitlement } from "@/lib/serverEntitlement";

const FREE_DAILY_CAPTURE_LIMIT_STORAGE_KEY = "mt_free_daily_capture_limit_v1";

// Mutable mock-state holders. Wrapped in `mock`-prefixed objects so
// jest's hoisting allows the factory to reference them. Mirrors the
// pattern in app/(app)/(tabs)/settings.haptics.test.tsx.
const mockAuthState: {
  current: { user: { email: string; id: string; displayName: string } | null };
} = {
  current: { user: null },
};

const mockApiGetSubscriptionStatus = jest.fn<
  Promise<SubscriptionStatus>,
  []
>();
const mockFetchServerEntitlement = jest.fn<
  Promise<ServerEntitlement | null>,
  [string]
>();
const mockGetCurrentEntitlementIsPro = jest.fn<
  Promise<boolean | null>,
  []
>();
const mockSetSyncProActive = jest.fn();

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mockAuthState.current.user,
    isLoading: false,
  }),
}));

jest.mock("@/lib/subscription", () => {
  const actual = jest.requireActual("@/lib/subscription");
  return {
    ...actual,
    apiGetSubscriptionStatus: () => mockApiGetSubscriptionStatus(),
  };
});

jest.mock("@/lib/serverEntitlement", () => ({
  fetchServerEntitlement: (appUserId: string) =>
    mockFetchServerEntitlement(appUserId),
}));

jest.mock("@/lib/revenuecat", () => ({
  getCurrentEntitlementIsPro: () => mockGetCurrentEntitlementIsPro(),
}));

jest.mock("@/lib/api", () => ({
  setSyncProActive: (...args: unknown[]) => mockSetSyncProActive(...args),
}));

interface CapturedHandle {
  current: ReturnType<typeof useSubscription> | null;
}

function Consumer({ handle }: { handle: CapturedHandle }) {
  handle.current = useSubscription();
  return null;
}

async function flushAll() {
  // SubscriptionProvider kicks off two parallel async paths:
  // - the AsyncStorage hydrate effect (one microtask)
  // - the `refresh()` effect (Promise.all of three mocks)
  // Two flushes guarantee both settle before assertions.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function defaultStatus(overrides: Partial<SubscriptionStatus> = {}): SubscriptionStatus {
  return {
    is_pro: false,
    plan: "free",
    pro_since: null,
    pro_expires: null,
    payment_platform: "stripe",
    manage_url: null,
    ...overrides,
  } as SubscriptionStatus;
}

describe("SubscriptionContext.freeDailyCaptureLimit (Task #144)", () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.setItem as jest.Mock).mockReset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    mockApiGetSubscriptionStatus.mockReset();
    mockFetchServerEntitlement.mockReset();
    mockGetCurrentEntitlementIsPro.mockReset();
    mockSetSyncProActive.mockReset();
    mockAuthState.current = { user: null };
  });

  test("hydrates the persisted cap from AsyncStorage on cold start", async () => {
    // Persisted from a previous mid-promo session: cap = 20. The
    // provider's initial state defaults to the compiled-in 10; the
    // hydrate effect must lift it to 20 without waiting for the
    // network. We deliberately keep `user` null so the entitlement
    // refresh short-circuits and can't accidentally provide the
    // right answer via a different code path — this isolates the
    // AsyncStorage-only branch.
    (AsyncStorage.getItem as jest.Mock).mockImplementation(
      (key: string): Promise<string | null> => {
        if (key === FREE_DAILY_CAPTURE_LIMIT_STORAGE_KEY) {
          return Promise.resolve("20");
        }
        return Promise.resolve(null);
      },
    );

    const handle: CapturedHandle = { current: null };
    render(
      <SubscriptionProvider>
        <Consumer handle={handle} />
      </SubscriptionProvider>,
    );
    await flushAll();

    expect(handle.current).not.toBeNull();
    expect(handle.current!.freeDailyCaptureLimit).toBe(20);
    // Logged-out → no entitlement fetch, no Polsia status fetch.
    expect(mockFetchServerEntitlement).not.toHaveBeenCalled();
  });

  test("falls back to the compiled-in default when AsyncStorage is empty", async () => {
    // Nothing persisted, no user → cap stays at the constant.
    // Pinning this so a future hydrate refactor that accidentally
    // collapsed `null` to `0` (or threw on a missing key) gets
    // caught here before it strands free users on "X of 0 left".
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const handle: CapturedHandle = { current: null };
    render(
      <SubscriptionProvider>
        <Consumer handle={handle} />
      </SubscriptionProvider>,
    );
    await flushAll();

    expect(handle.current!.freeDailyCaptureLimit).toBe(10);
  });

  test("ignores a malformed persisted cap and keeps the compiled-in default", async () => {
    // Corrupted/legacy value (non-integer string). Must NOT render
    // "X of NaN left" — the hydrate effect rejects anything that
    // isn't a positive integer and leaves the default in place.
    (AsyncStorage.getItem as jest.Mock).mockImplementation(
      (key: string): Promise<string | null> => {
        if (key === FREE_DAILY_CAPTURE_LIMIT_STORAGE_KEY) {
          return Promise.resolve("not-a-number");
        }
        return Promise.resolve(null);
      },
    );

    const handle: CapturedHandle = { current: null };
    render(
      <SubscriptionProvider>
        <Consumer handle={handle} />
      </SubscriptionProvider>,
    );
    await flushAll();

    expect(handle.current!.freeDailyCaptureLimit).toBe(10);
  });

  test("never overwrites a positive cached cap with null on a stale-server refresh", async () => {
    // Persisted live cap from an earlier session is 20. A fresh
    // refresh against an api-server build that doesn't include
    // `freeDailyCaptureLimit` (or that returned `null` because of
    // a transient parser regression) must NOT clobber the cached
    // value back down to the compiled-in 10. Otherwise a free user
    // mid-promo would see the upsell wall yo-yo between
    // refreshes — exactly the regression the implementation guards
    // against in `SubscriptionContext.refresh`.
    (AsyncStorage.getItem as jest.Mock).mockImplementation(
      (key: string): Promise<string | null> => {
        if (key === FREE_DAILY_CAPTURE_LIMIT_STORAGE_KEY) {
          return Promise.resolve("20");
        }
        return Promise.resolve(null);
      },
    );
    mockAuthState.current = {
      user: { email: "alice@example.com", id: "u-1", displayName: "Alice" },
    };
    mockApiGetSubscriptionStatus.mockResolvedValue(defaultStatus());
    mockGetCurrentEntitlementIsPro.mockResolvedValue(false);
    mockFetchServerEntitlement.mockResolvedValue({
      isPro: false,
      expiresAt: null,
      productId: null,
      source: "revenuecat",
      // Older api-server build: field present but null. The
      // provider's `typeof === "number"` guard is the line that
      // protects the cached value here.
      freeDailyCaptureLimit: null,
    });

    const handle: CapturedHandle = { current: null };
    render(
      <SubscriptionProvider>
        <Consumer handle={handle} />
      </SubscriptionProvider>,
    );
    await flushAll();

    expect(mockFetchServerEntitlement).toHaveBeenCalledWith(
      "alice@example.com",
    );
    // Cap remains the persisted positive value, not the bare default.
    expect(handle.current!.freeDailyCaptureLimit).toBe(20);
  });

  test("adopts a positive cap returned by the server and persists it", async () => {
    // The other half of the contract: when the server DOES return
    // a usable number, the provider must adopt it AND write it
    // through to AsyncStorage so the next cold launch hydrates the
    // fresh value. Pins the persistence path so a future refactor
    // that skipped the AsyncStorage.setItem call would surface here
    // before it broke offline launches.
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    mockAuthState.current = {
      user: { email: "alice@example.com", id: "u-1", displayName: "Alice" },
    };
    mockApiGetSubscriptionStatus.mockResolvedValue(defaultStatus());
    mockGetCurrentEntitlementIsPro.mockResolvedValue(false);
    mockFetchServerEntitlement.mockResolvedValue({
      isPro: false,
      expiresAt: null,
      productId: null,
      source: "revenuecat",
      freeDailyCaptureLimit: 25,
    });

    const handle: CapturedHandle = { current: null };
    render(
      <SubscriptionProvider>
        <Consumer handle={handle} />
      </SubscriptionProvider>,
    );
    await flushAll();

    expect(handle.current!.freeDailyCaptureLimit).toBe(25);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      FREE_DAILY_CAPTURE_LIMIT_STORAGE_KEY,
      "25",
    );
  });
});
