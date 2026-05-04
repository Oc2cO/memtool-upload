import {
  RESTORE_GENERIC_ERROR_MESSAGE,
  RESTORE_NO_ENTITLEMENT_MESSAGE,
  RESTORE_NOT_CONFIGURED_MESSAGE,
  runRestoreFlow,
  shouldShowRestoreButton,
} from "./restoreFlow";
import type { RestoreResult } from "./revenuecat";

describe("runRestoreFlow — four App Review branches", () => {
  test("configured + entitlement found → success_pro", async () => {
    let restoreCalled = false;
    const outcome = await runRestoreFlow({
      paymentsConfigured: true,
      isRevenueCatConfigured: () => true,
      restoreApplePurchases: async (): Promise<RestoreResult> => {
        restoreCalled = true;
        return { ok: true, isPro: true };
      },
    });
    expect(restoreCalled).toBe(true);
    expect(outcome).toEqual({ kind: "success_pro" });
  });

  test("configured + nothing to restore → success_no_entitlement", async () => {
    const outcome = await runRestoreFlow({
      paymentsConfigured: true,
      isRevenueCatConfigured: () => true,
      restoreApplePurchases: async (): Promise<RestoreResult> => ({
        ok: true,
        isPro: false,
      }),
    });
    expect(outcome).toEqual({
      kind: "success_no_entitlement",
      message: RESTORE_NO_ENTITLEMENT_MESSAGE,
    });
    expect(RESTORE_NO_ENTITLEMENT_MESSAGE).toBe(
      "No active subscription found to restore",
    );
  });

  test("paymentsConfigured === false short-circuits before SDK call", async () => {
    let restoreCalled = false;
    const outcome = await runRestoreFlow({
      paymentsConfigured: false,
      isRevenueCatConfigured: () => true,
      restoreApplePurchases: async (): Promise<RestoreResult> => {
        restoreCalled = true;
        return { ok: true, isPro: true };
      },
    });
    expect(restoreCalled).toBe(false);
    expect(outcome).toEqual({
      kind: "not_configured",
      message: RESTORE_NOT_CONFIGURED_MESSAGE,
    });
  });

  test("isRevenueCatConfigured() === false short-circuits before SDK call", async () => {
    let restoreCalled = false;
    const outcome = await runRestoreFlow({
      paymentsConfigured: null,
      isRevenueCatConfigured: () => false,
      restoreApplePurchases: async (): Promise<RestoreResult> => {
        restoreCalled = true;
        return { ok: true, isPro: true };
      },
    });
    expect(restoreCalled).toBe(false);
    expect(outcome.kind).toBe("not_configured");
    expect(RESTORE_NOT_CONFIGURED_MESSAGE).toBe(
      "Purchases can't be restored right now — try again in a moment.",
    );
  });

  test("SDK returns not_configured mid-call → calm copy", async () => {
    const outcome = await runRestoreFlow({
      paymentsConfigured: true,
      isRevenueCatConfigured: () => true,
      restoreApplePurchases: async (): Promise<RestoreResult> => ({
        ok: false,
        reason: "not_configured",
      }),
    });
    expect(outcome).toEqual({
      kind: "not_configured",
      message: RESTORE_NOT_CONFIGURED_MESSAGE,
    });
  });

  test("SDK error → generic 'try again' copy", async () => {
    const outcome = await runRestoreFlow({
      paymentsConfigured: true,
      isRevenueCatConfigured: () => true,
      restoreApplePurchases: async (): Promise<RestoreResult> => ({
        ok: false,
        reason: "error",
        message: "network timeout",
      }),
    });
    expect(outcome).toEqual({
      kind: "error",
      message: RESTORE_GENERIC_ERROR_MESSAGE,
    });
    expect(RESTORE_GENERIC_ERROR_MESSAGE).toBe(
      "Couldn't restore purchases — try again",
    );
  });
});

describe("shouldShowRestoreButton — visibility contract", () => {
  test("true on Apple rail when not Pro", () => {
    expect(shouldShowRestoreButton(true, false)).toBe(true);
  });

  test("false on Stripe rail", () => {
    expect(shouldShowRestoreButton(false, false)).toBe(false);
  });

  test("false when already Pro", () => {
    expect(shouldShowRestoreButton(true, true)).toBe(false);
  });
});
