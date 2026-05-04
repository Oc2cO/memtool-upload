import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAuth } from "./AuthContext";
import {
  apiGetSubscriptionStatus,
  FREE_DAILY_CAPTURE_LIMIT,
  type SubscriptionStatus,
} from "@/lib/subscription";
import { setSyncProActive } from "@/lib/api";
import { fetchServerEntitlement } from "@/lib/serverEntitlement";
import { getCurrentEntitlementIsPro } from "@/lib/revenuecat";

/**
 * AsyncStorage key for the last-known server free-tier daily capture
 * cap (Task #144). Persisted so a free user who launched yesterday
 * during a "cap = 20 today" promo still sees "X of 20 left" on a
 * cold launch with no network — instead of briefly flashing
 * "X of 10 left" until the entitlement fetch resolves.
 *
 * Single key (not user-scoped) because the cap is a global config;
 * every user on the same build sees the same value, so there's no
 * cross-account leakage to worry about.
 */
const FREE_DAILY_CAPTURE_LIMIT_STORAGE_KEY = "mt_free_daily_capture_limit_v1";

interface SubscriptionContextType {
  status: SubscriptionStatus | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /**
   * Immediately patch the cached status with a known `is_pro` value
   * without triggering a network refresh. Used by the cold-launch
   * entitlement bridge in `_layout.tsx` to apply a RevenueCat SDK
   * result before routed content renders, so returning Pro subscribers
   * are recognized instantly on cold launch without waiting for the
   * server round-trip.
   */
  patchProStatus: (isPro: boolean) => void;
  /**
   * Live free-tier daily capture cap as last reported by
   * `/subscription/entitlement` (Task #144). Falls back to the
   * compiled-in `FREE_DAILY_CAPTURE_LIMIT` when the server hasn't
   * been reached yet AND no value has ever been persisted on this
   * device. Pass to `getCaptureLimitState(..., liveLimit)` in any
   * surface that displays "X of Y left" or gates on the cap so the
   * UX stays in sync with on-call's runtime override during a
   * promotion. Always a positive integer.
   */
  freeDailyCaptureLimit: number;
}

const SubscriptionContext = createContext<SubscriptionContextType | null>(null);

/**
 * One source of truth for the user's subscription tier. Loaded on auth
 * and exposed via `useSubscription` so the Settings entry-row and the
 * dedicated subscription screen stay in sync without duplicate
 * fetches. Cleared on logout so the next user doesn't see stale state.
 *
 * The screen is responsible for re-calling `refresh()` when it regains
 * focus (e.g. after the user comes back from the Stripe checkout flow)
 * — see `useFocusEffect` on app/(app)/subscription.tsx.
 */
export function SubscriptionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live free-tier cap (Task #144). Initialized from the compiled-in
  // constant so the very first render before AsyncStorage loads has a
  // sensible value; the persisted value (if any) overrides it from
  // the hydration effect below, and the entitlement fetch overrides
  // both when it lands. The setter is wrapped so we only update state
  // on actual changes — avoids a wasted re-render on every refresh
  // when the server keeps returning the same number.
  const [freeDailyCaptureLimit, setFreeDailyCaptureLimit] = useState<number>(
    FREE_DAILY_CAPTURE_LIMIT,
  );

  /**
   * Immediately mark the current status as Pro (or not Pro) without a
   * network call. If there is no cached status yet this is a no-op —
   * the first `refresh()` will load the correct value from the server.
   * The api.js sync gate is updated in lockstep.
   */
  const patchProStatus = useCallback((isPro: boolean) => {
    setStatus((prev) => {
      if (!prev) return prev;
      const patched = { ...prev, is_pro: isPro };
      setSyncProActive(isPro);
      return patched;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!user) {
      setStatus(null);
      setError(null);
      setIsLoading(false);
      // Reset the api.js sync gate so a logged-out / next user can
      // never inherit the previous user's Pro flag (defense-in-depth
      // for syncToCloud, which is otherwise UI-gated in settings.tsx).
      setSyncProActive(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      // Run all three checks in parallel: Polsia status, server-side
      // RevenueCat REST proxy, and local SDK CustomerInfo. The SDK call
      // may return a cached result immediately (no network hop).
      const [next, entitlement, sdkIsPro] = await Promise.all([
        apiGetSubscriptionStatus(),
        user?.email ? fetchServerEntitlement(user.email) : Promise.resolve(null),
        getCurrentEntitlementIsPro(),
      ]);
      // OR merge: any source confirming Pro is sufficient. We never
      // downgrade a user based on a single failing source — in
      // particular a briefly stale server result immediately after a
      // purchase (the webhook may not have fired yet) must not override
      // a just-confirmed SDK CustomerInfo `true`.
      const resolvedIsPro =
        (entitlement !== null && entitlement.isPro) ||
        sdkIsPro === true ||
        next.is_pro === true;
      const merged: SubscriptionStatus = { ...next, is_pro: resolvedIsPro };
      setStatus(merged);
      // Push the Pro flag into the api.js module so syncToCloud can
      // refuse for non-Pro callers without depending on React.
      setSyncProActive(merged.is_pro);
      // Pick up the live free-tier cap from the entitlement payload
      // (Task #144). Only update when the server actually returned
      // one — older api-server builds omit the field, in which case
      // we keep whatever value we already had (persisted from a
      // previous successful fetch, or the compiled-in constant). We
      // intentionally never write `null` over a previously good
      // value, so a temporary upstream regression can't strand
      // users on the bare default.
      if (
        entitlement !== null &&
        typeof entitlement.freeDailyCaptureLimit === "number"
      ) {
        const nextCap = entitlement.freeDailyCaptureLimit;
        setFreeDailyCaptureLimit((prev) => (prev === nextCap ? prev : nextCap));
        // Persist for offline cold-launches. Best-effort: a write
        // failure is invisible to the user (the in-memory value
        // still reflects the latest fetch) so we just log in dev.
        AsyncStorage.setItem(
          FREE_DAILY_CAPTURE_LIMIT_STORAGE_KEY,
          String(nextCap),
        ).catch((err) => {
          if (__DEV__) console.log("[subscription] cap persist failed", err);
        });
      }
      if (__DEV__) {
        const sources: string[] = [];
        if (entitlement?.isPro) sources.push("server_entitlement");
        if (sdkIsPro === true) sources.push("revenuecat_sdk");
        if (next.is_pro) sources.push("polsia");
        console.log("[subscription] loaded", {
          is_pro: merged.is_pro,
          plan: merged.plan,
          payment_platform: merged.payment_platform,
          pro_sources: sources.length ? sources : ["none"],
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't load subscription";
      setError(message);
      console.warn("[subscription] load failed", err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Hydrate the persisted live cap (Task #144) once on mount so a
  // cold launch with no network still shows the last known value
  // (e.g. "X of 20 left" mid-promotion) instead of flashing the
  // compiled-in 10. Runs in parallel with the entitlement fetch
  // below; whichever lands first wins, and the network value will
  // overwrite the persisted one shortly after if both succeed.
  // Errors and malformed values fall back silently to the in-state
  // default — a corrupt storage entry must not block the app.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(FREE_DAILY_CAPTURE_LIMIT_STORAGE_KEY)
      .then((raw) => {
        if (cancelled || raw === null) return;
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 1) return;
        setFreeDailyCaptureLimit((prev) => (prev === parsed ? prev : parsed));
      })
      .catch((err) => {
        if (__DEV__) console.log("[subscription] cap hydrate failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load on mount / auth change. Clearing happens inside refresh when
  // user is null so we don't keep a Pro badge after logout.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Apple compliance: re-check entitlement on every transition from
  // background → foreground, not just on cold start. Without this a
  // user who upgraded on another device, was refunded, or whose
  // subscription expired while the app was backgrounded would see
  // stale Pro/Free state until they triggered an auth change or
  // pulled to refresh on the subscription screen. Mirror of the
  // pattern already used by ReviewPromptBridge in app/_layout.tsx
  // so the AppState wiring stays consistent across the app.
  const previousAppStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = previousAppStateRef.current;
      previousAppStateRef.current = next;
      if (prev !== "active" && next === "active") {
        refresh().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [refresh]);

  return (
    <SubscriptionContext.Provider
      value={{
        status,
        isLoading,
        error,
        refresh,
        patchProStatus,
        freeDailyCaptureLimit,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export const useSubscription = () => {
  const ctx = useContext(SubscriptionContext);
  if (!ctx)
    throw new Error("useSubscription must be used within SubscriptionProvider");
  return ctx;
};
