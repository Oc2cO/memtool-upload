import type { RestoreResult } from "./revenuecat";

export const RESTORE_NOT_CONFIGURED_MESSAGE =
  "Purchases can't be restored right now — try again in a moment.";
export const RESTORE_NO_ENTITLEMENT_MESSAGE =
  "No active subscription found to restore";
export const RESTORE_GENERIC_ERROR_MESSAGE =
  "Couldn't restore purchases — try again";

export type RestoreOutcome =
  | { kind: "success_pro" }
  | { kind: "success_no_entitlement"; message: string }
  | { kind: "not_configured"; message: string }
  | { kind: "error"; message: string };

export interface RunRestoreFlowDeps {
  paymentsConfigured: boolean | null;
  isRevenueCatConfigured: () => boolean;
  restoreApplePurchases: () => Promise<RestoreResult>;
}

export async function runRestoreFlow(
  deps: RunRestoreFlowDeps,
): Promise<RestoreOutcome> {
  if (deps.paymentsConfigured === false || !deps.isRevenueCatConfigured()) {
    return {
      kind: "not_configured",
      message: RESTORE_NOT_CONFIGURED_MESSAGE,
    };
  }

  const result = await deps.restoreApplePurchases();

  if (result.ok) {
    if (result.isPro) {
      return { kind: "success_pro" };
    }
    return {
      kind: "success_no_entitlement",
      message: RESTORE_NO_ENTITLEMENT_MESSAGE,
    };
  }

  if (result.reason === "not_configured") {
    return {
      kind: "not_configured",
      message: RESTORE_NOT_CONFIGURED_MESSAGE,
    };
  }

  return { kind: "error", message: RESTORE_GENERIC_ERROR_MESSAGE };
}

// Apple App Review (3.1.1): the Restore button must show on every IAP
// screen for non-Pro Apple users, regardless of SDK init or error state.
export function shouldShowRestoreButton(
  isApple: boolean,
  isPro: boolean,
): boolean {
  return isApple && !isPro;
}
