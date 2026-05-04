import type { PurchasesPackage } from "react-native-purchases";

import { AuthError } from "./auth";
import type { ApplePurchaseResult } from "./revenuecat";
import type { CheckoutResult } from "./subscription";
import {
  pickUpgradePackage,
  runUpgradeFlow,
  UPGRADE_APPLE_FAILED_MESSAGE,
  UPGRADE_STRIPE_FAILED_MESSAGE,
  UPGRADE_STRIPE_UNAVAILABLE_MESSAGE,
} from "./upgradeFlow";

// Real PurchasesPackage shape is heavy; the flow only forwards the
// reference to the SDK, so a tagged stub is enough to assert which
// cadence was selected.
const monthlyPkg = { __id: "monthly" } as unknown as PurchasesPackage;
const annualPkg = { __id: "annual" } as unknown as PurchasesPackage;

interface BuildDepsOverrides {
  rail?: "apple" | "stripe";
  selectedPlan?: "monthly" | "annual";
  proPackages?: {
    monthly: PurchasesPackage | null;
    annual: PurchasesPackage | null;
  };
  purchaseProSubscription?: (
    pkg: PurchasesPackage,
  ) => Promise<ApplePurchaseResult>;
  apiCreateCheckoutSession?: () => Promise<CheckoutResult>;
  openExternalUrl?: (url: string) => Promise<void>;
}

function buildDeps(overrides: BuildDepsOverrides = {}) {
  return {
    rail: overrides.rail ?? "apple",
    selectedPlan: overrides.selectedPlan ?? "annual",
    proPackages: overrides.proPackages ?? {
      monthly: monthlyPkg,
      annual: annualPkg,
    },
    purchaseProSubscription:
      overrides.purchaseProSubscription ??
      (async (): Promise<ApplePurchaseResult> => ({
        ok: true,
        isPro: true,
      })),
    apiCreateCheckoutSession:
      overrides.apiCreateCheckoutSession ??
      (async (): Promise<CheckoutResult> => ({
        ok: true,
        url: "https://stripe.example/checkout",
      })),
    openExternalUrl:
      overrides.openExternalUrl ?? (async (_url: string) => undefined),
  };
}

describe("pickUpgradePackage — selection + fallback contract", () => {
  test("annual selection returns annual when present", () => {
    expect(
      pickUpgradePackage("annual", { monthly: monthlyPkg, annual: annualPkg }),
    ).toBe(annualPkg);
  });

  test("monthly selection returns monthly when present", () => {
    expect(
      pickUpgradePackage("monthly", { monthly: monthlyPkg, annual: annualPkg }),
    ).toBe(monthlyPkg);
  });

  test("annual selection falls back to monthly when annual missing", () => {
    expect(
      pickUpgradePackage("annual", { monthly: monthlyPkg, annual: null }),
    ).toBe(monthlyPkg);
  });

  test("monthly selection falls back to annual when monthly missing", () => {
    expect(
      pickUpgradePackage("monthly", { monthly: null, annual: annualPkg }),
    ).toBe(annualPkg);
  });

  test("returns null when both packages are missing", () => {
    expect(
      pickUpgradePackage("annual", { monthly: null, annual: null }),
    ).toBeNull();
  });
});

describe("runUpgradeFlow — Apple rail", () => {
  test("Apple checkout success → purchased_apple, calls SDK with selected package", async () => {
    let purchasedWith: PurchasesPackage | null = null;
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "apple",
        selectedPlan: "annual",
        purchaseProSubscription: async (pkg) => {
          purchasedWith = pkg;
          return { ok: true, isPro: true };
        },
      }),
    );
    expect(purchasedWith).toBe(annualPkg);
    expect(outcome).toEqual({ kind: "purchased_apple" });
  });

  test("Apple monthly selection routes the monthly package to the SDK", async () => {
    let purchasedWith: PurchasesPackage | null = null;
    await runUpgradeFlow(
      buildDeps({
        rail: "apple",
        selectedPlan: "monthly",
        purchaseProSubscription: async (pkg) => {
          purchasedWith = pkg;
          return { ok: true, isPro: true };
        },
      }),
    );
    expect(purchasedWith).toBe(monthlyPkg);
  });

  test("Apple cancel → quiet 'cancelled' outcome (no error banner copy)", async () => {
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "apple",
        purchaseProSubscription: async () => ({
          ok: false,
          reason: "cancelled",
        }),
      }),
    );
    expect(outcome).toEqual({ kind: "cancelled" });
  });

  test("Apple SDK 'not_configured' → not_configured (no error copy)", async () => {
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "apple",
        purchaseProSubscription: async () => ({
          ok: false,
          reason: "not_configured",
        }),
      }),
    );
    expect(outcome).toEqual({ kind: "not_configured" });
  });

  test("Apple SDK 'no_offering' → not_configured (no error copy)", async () => {
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "apple",
        purchaseProSubscription: async () => ({
          ok: false,
          reason: "no_offering",
        }),
      }),
    );
    expect(outcome).toEqual({ kind: "not_configured" });
  });

  test("missing package on both sides short-circuits before SDK call → not_configured", async () => {
    let sdkCalled = false;
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "apple",
        proPackages: { monthly: null, annual: null },
        purchaseProSubscription: async () => {
          sdkCalled = true;
          return { ok: true, isPro: true };
        },
      }),
    );
    expect(sdkCalled).toBe(false);
    expect(outcome).toEqual({ kind: "not_configured" });
  });

  test("Apple SDK 'error' → rail-specific 'couldn't complete purchase' copy", async () => {
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "apple",
        purchaseProSubscription: async () => ({
          ok: false,
          reason: "error",
          message: "raw sdk text — must NOT leak",
        }),
      }),
    );
    expect(outcome).toEqual({
      kind: "error",
      message: UPGRADE_APPLE_FAILED_MESSAGE,
    });
    expect(UPGRADE_APPLE_FAILED_MESSAGE).toBe(
      "Couldn't complete purchase — try again",
    );
  });

  test("Apple SDK throw → rail-specific 'couldn't complete purchase' copy (raw error not surfaced)", async () => {
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "apple",
        purchaseProSubscription: async () => {
          throw new Error("raw sdk crash — must NOT leak");
        },
      }),
    );
    expect(outcome).toEqual({
      kind: "error",
      message: UPGRADE_APPLE_FAILED_MESSAGE,
    });
  });
});

describe("runUpgradeFlow — Stripe rail", () => {
  test("Stripe checkout success → opened_stripe, opens the returned URL", async () => {
    let openedUrl: string | null = null;
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "stripe",
        apiCreateCheckoutSession: async () => ({
          ok: true,
          url: "https://stripe.example/c/abc123",
        }),
        openExternalUrl: async (url) => {
          openedUrl = url;
        },
      }),
    );
    expect(openedUrl).toBe("https://stripe.example/c/abc123");
    expect(outcome).toEqual({ kind: "opened_stripe" });
  });

  test("Stripe 'not_configured' → not_configured (no destructive error copy)", async () => {
    let opened = false;
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "stripe",
        apiCreateCheckoutSession: async () => ({
          ok: false,
          reason: "not_configured",
        }),
        openExternalUrl: async () => {
          opened = true;
        },
      }),
    );
    expect(opened).toBe(false);
    expect(outcome).toEqual({ kind: "not_configured" });
  });

  test("Stripe API throw → rail-specific 'couldn't open Stripe' copy", async () => {
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "stripe",
        apiCreateCheckoutSession: async () => {
          throw new Error("network down — must NOT leak");
        },
      }),
    );
    expect(outcome).toEqual({
      kind: "error",
      message: UPGRADE_STRIPE_FAILED_MESSAGE,
    });
    expect(UPGRADE_STRIPE_FAILED_MESSAGE).toBe(
      "Couldn't open Stripe — try again",
    );
  });

  test("Stripe 5xx (gateway outage) → 'Mem is temporarily unavailable' copy (Task #397)", async () => {
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "stripe",
        apiCreateCheckoutSession: async () => {
          throw new AuthError("Server error — please try again", 502);
        },
      }),
    );
    expect(outcome).toEqual({
      kind: "error",
      message: UPGRADE_STRIPE_UNAVAILABLE_MESSAGE,
    });
    expect(UPGRADE_STRIPE_UNAVAILABLE_MESSAGE).toBe(
      "Mem is temporarily unavailable — we'll be back shortly.",
    );
  });

  test("Stripe 4xx still surfaces the generic 'couldn't open Stripe' copy", async () => {
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "stripe",
        apiCreateCheckoutSession: async () => {
          throw new AuthError("Bad request", 400);
        },
      }),
    );
    expect(outcome).toEqual({
      kind: "error",
      message: UPGRADE_STRIPE_FAILED_MESSAGE,
    });
  });

  test("Stripe openExternalUrl throw → 'couldn't open Stripe' copy", async () => {
    const outcome = await runUpgradeFlow(
      buildDeps({
        rail: "stripe",
        openExternalUrl: async () => {
          throw new Error("browser refused — must NOT leak");
        },
      }),
    );
    expect(outcome).toEqual({
      kind: "error",
      message: UPGRADE_STRIPE_FAILED_MESSAGE,
    });
  });
});
