import { useCallback } from "react";
import * as Haptics from "expo-haptics";

import { useHaptic } from "./haptics";
import {
  isRevenueCatConfigured,
  restoreApplePurchases,
} from "./revenuecat";
import { runRestoreFlow as defaultRunRestoreFlow } from "./restoreFlow";

export interface UseHandleRestoreOptions {
  paymentsConfigured: boolean | null;
  setPaymentsConfigured: (next: boolean) => void;
  refresh: () => Promise<void> | void;
  setActionError: (next: string | null) => void;
  setActionPending: (next: boolean) => void;
  setRestoreSuccess: (next: boolean) => void;
  actionPending: boolean;
  // Test-only override; production callers omit this.
  runFlow?: typeof defaultRunRestoreFlow;
}

export function useHandleRestore(
  opts: UseHandleRestoreOptions,
): () => Promise<void> {
  const {
    paymentsConfigured,
    setPaymentsConfigured,
    refresh,
    setActionError,
    setActionPending,
    setRestoreSuccess,
    actionPending,
    runFlow = defaultRunRestoreFlow,
  } = opts;

  const captureHaptic = useHaptic("capture");
  const errorHaptic = useHaptic("error");

  return useCallback(async () => {
    if (actionPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setActionPending(true);
    setActionError(null);
    setRestoreSuccess(false);
    try {
      const outcome = await runFlow({
        paymentsConfigured,
        isRevenueCatConfigured,
        restoreApplePurchases,
      });
      switch (outcome.kind) {
        case "success_pro": {
          setPaymentsConfigured(true);
          await refresh();
          captureHaptic.play();
          setRestoreSuccess(true);
          setTimeout(() => setRestoreSuccess(false), 3000);
          return;
        }
        case "success_no_entitlement": {
          setPaymentsConfigured(true);
          await refresh();
          setActionError(outcome.message);
          return;
        }
        case "not_configured": {
          setPaymentsConfigured(false);
          setActionError(outcome.message);
          // eslint-disable-next-line no-restricted-syntax
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); // haptics-escape-hatch — no AHAP verb for "warning" state; payments not configured is a soft degraded state, not an error
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
    paymentsConfigured,
    refresh,
    runFlow,
    setActionError,
    setActionPending,
    setPaymentsConfigured,
    setRestoreSuccess,
    captureHaptic,
    errorHaptic,
  ]);
}
