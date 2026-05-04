import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { useAuth } from "./AuthContext";
import {
  fetchSkillsEntitlements,
  type SkillsEntitlements,
} from "@/lib/skillsEntitlement";

interface SkillsContextValue {
  /** Set of owned entitlement keys (bundle + per-skill). */
  owned: ReadonlySet<string>;
  isLoading: boolean;
  refresh: () => Promise<void>;
  /**
   * Test/post-purchase hook: optimistically add an entitlement so the
   * UI unlocks immediately after a successful StoreKit sheet, before
   * the server-trust refresh round-trip completes. The next refresh
   * either confirms the optimistic state (no-op) or, if RevenueCat
   * never propagated the receipt, drops the user back to locked.
   */
  optimisticallyAdd: (entitlementKey: string) => void;
}

const SkillsContext = createContext<SkillsContextValue | null>(null);

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Skills entitlement provider (Task #337).
 *
 * Single source of truth for which Companion Skills the signed-in
 * user has unlocked. Server-trust gating: the on-device RevenueCat
 * SDK is never consulted directly here — the source of truth is the
 * `/subscription/skills-entitlements` server endpoint, which proxies
 * the RevenueCat REST API behind the server's secret key.
 */
export function SkillsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [owned, setOwned] = useState<ReadonlySet<string>>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user?.email) {
      setOwned(EMPTY);
      return;
    }
    setIsLoading(true);
    try {
      const result = await fetchSkillsEntitlements(user.email);
      if (result) setOwned(result.owned);
      // On null (network error, server 503, etc.) keep the previous
      // value rather than blanking the cache — a brief blip shouldn't
      // re-show the paywall to a paid user.
    } finally {
      setIsLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    if (user?.email) {
      void refresh();
    } else {
      setOwned(EMPTY);
    }
  }, [user?.email, refresh]);

  const optimisticallyAdd = useCallback((entitlementKey: string) => {
    setOwned((prev) => {
      if (prev.has(entitlementKey)) return prev;
      const next = new Set(prev);
      next.add(entitlementKey);
      return next;
    });
  }, []);

  return (
    <SkillsContext.Provider
      value={{ owned, isLoading, refresh, optimisticallyAdd }}
    >
      {children}
    </SkillsContext.Provider>
  );
}

export function useSkills(): SkillsContextValue {
  const ctx = useContext(SkillsContext);
  if (!ctx) throw new Error("useSkills must be used inside <SkillsProvider>");
  return ctx;
}
