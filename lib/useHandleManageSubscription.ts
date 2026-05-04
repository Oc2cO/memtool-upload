import { useCallback } from "react";
import * as Haptics from "expo-haptics";

import { useHaptic } from "./haptics";
import {
  openAppleManageSubscriptions as defaultOpenAppleManageSubscriptions,
  openExternalUrl as defaultOpenExternalUrl,
} from "./paymentLinks";
import { runManageFlow as defaultRunManageFlow } from "./manageSubscriptionFlow";
import { apiCreatePortalSession as defaultApiCreatePortalSession } from "./subscription";

export interface UseHandleManageSubscriptionOptions {
  rail: "apple" | "stripe";
  setActionError: (next: string | null) => void;
  setActionPending: (next: boolean) => void;
  setPaymentsConfigured: (next: boolean) => void;
  actionPending: boolean;
  // Test-only overrides; production callers omit these.
  runFlow?: typeof defaultRunManageFlow;
  openAppleManageSubscriptions?: typeof defaultOpenAppleManageSubscriptions;
  apiCreatePortalSession?: typeof defaultApiCreatePortalSession;
  openExternalUrl?: typeof defaultOpenExternalUrl;
}

export function useHandleManageSubscription(
  opts: UseHandleManageSubscriptionOptions,
): () => Promise<void> {
  const {
    rail,
    setActionError,
    setActionPending,
    setPaymentsConfigured,
    actionPending,
    runFlow = defaultRunManageFlow,
    openAppleManageSubscriptions = defaultOpenAppleManageSubscriptions,
    apiCreatePortalSession = defaultApiCreatePortalSession,
    openExternalUrl = defaultOpenExternalUrl,
  } = opts;

  const errorHaptic = useHaptic("error");

  return useCallback(async () => {
    if (actionPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setActionPending(true);
    setActionError(null);
    try {
      // Rail-specific decision logic (Apple deep link vs Stripe
      // portal, including the "couldn't open the App Store" /
      // "couldn't open Stripe" copy on failure) lives in
      // `runManageFlow` (lib/manageSubscriptionFlow.ts) so all four
      // branches stay covered by the unit tests.
      const outcome = await runFlow({
        rail,
        openAppleManageSubscriptions,
        apiCreatePortalSession,
        openExternalUrl,
      });
      switch (outcome.kind) {
        case "opened_apple":
        case "opened_stripe": {
          setPaymentsConfigured(true);
          return;
        }
        case "not_configured": {
          setPaymentsConfigured(false);
          return;
        }
        case "error": {
          setActionError(outcome.message);
          errorHaptic.play();
          return;
        }
      }
    } finally {
      setActionPending(false);
    }
  }, [
    actionPending,
    rail,
    setActionError,
    setActionPending,
    setPaymentsConfigured,
    runFlow,
    openAppleManageSubscriptions,
    apiCreatePortalSession,
    openExternalUrl,
    errorHaptic,
  ]);
}
