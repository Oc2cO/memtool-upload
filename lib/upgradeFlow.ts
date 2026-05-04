import type { PurchasesPackage } from "react-native-purchases";

import { AuthError } from "./auth";
import { AI_GUIDE_UNAVAILABLE_MESSAGE } from "./aiGuide";
import type { ApplePurchaseResult } from "./revenuecat";
import type { CheckoutResult } from "./subscription";

// Inline error copy lives next to the decision logic so a future
// paywall refactor can't silently change what the user sees on a
// failed Apple purchase or Stripe redirect — the test suite asserts
// these literals.
export const UPGRADE_APPLE_FAILED_MESSAGE =
  "Couldn't complete purchase — try again";
export const UPGRADE_STRIPE_FAILED_MESSAGE =
  "Couldn't open Stripe — try again";
/**
 * Shown on the Upgrade CTA when /subscription/checkout returns a
 * 5xx that isn't the known `STRIPE_NOT_CONFIGURED` 503 (Task #397).
 * Mirrors the AI Guide screen's sustained-outage copy so a
 * launch-day Polsia gateway outage reads consistently across both
 * surfaces — the user knows it's the upstream service, not their
 * card or their connection.
 */
export const UPGRADE_STRIPE_UNAVAILABLE_MESSAGE = AI_GUIDE_UNAVAILABLE_MESSAGE;

export type UpgradeOutcome =
  // Apple sheet closed with an active entitlement. Caller refreshes
  // the server tier and shows the celebration overlay.
  | { kind: "purchased_apple" }
  // User cancelled the Apple sheet — quiet, the OS already gave
  // feedback, no banner.
  | { kind: "cancelled" }
  // Either no package resolved (catalog empty), RC isn't initialised,
  // or Stripe returned 503. Caller flips the screen into the
  // disabled state without surfacing a destructive error to the user.
  | { kind: "not_configured" }
  // Stripe checkout URL was opened in the browser. Caller marks
  // payments configured.
  | { kind: "opened_stripe" }
  // Anything else — generic, rail-specific copy. Never leaks raw
  // SDK / fetch error text.
  | { kind: "error"; message: string };

export interface RunUpgradeFlowDeps {
  rail: "apple" | "stripe";
  selectedPlan: "monthly" | "annual";
  proPackages: {
    monthly: PurchasesPackage | null;
    annual: PurchasesPackage | null;
  };
  purchaseProSubscription: (
    pkg: PurchasesPackage,
  ) => Promise<ApplePurchaseResult>;
  apiCreateCheckoutSession: () => Promise<CheckoutResult>;
  openExternalUrl: (url: string) => Promise<void>;
}

/**
 * Pick the package the user actually intends to buy, falling back to
 * the other cadence when the preferred one isn't in the catalog. The
 * fallback exists so a mid-rollout where Apple hasn't propagated one
 * SKU yet still lets the user upgrade with the available plan
 * instead of seeing an empty paywall.
 */
export function pickUpgradePackage(
  selectedPlan: "monthly" | "annual",
  proPackages: {
    monthly: PurchasesPackage | null;
    annual: PurchasesPackage | null;
  },
): PurchasesPackage | null {
  if (selectedPlan === "annual") {
    return proPackages.annual ?? proPackages.monthly;
  }
  return proPackages.monthly ?? proPackages.annual;
}

export async function runUpgradeFlow(
  deps: RunUpgradeFlowDeps,
): Promise<UpgradeOutcome> {
  if (deps.rail === "apple") {
    const pkg = pickUpgradePackage(deps.selectedPlan, deps.proPackages);
    if (!pkg) return { kind: "not_configured" };
    let result: ApplePurchaseResult;
    try {
      result = await deps.purchaseProSubscription(pkg);
    } catch {
      return { kind: "error", message: UPGRADE_APPLE_FAILED_MESSAGE };
    }
    if (result.ok) return { kind: "purchased_apple" };
    if (result.reason === "cancelled") return { kind: "cancelled" };
    if (
      result.reason === "not_configured" ||
      result.reason === "no_offering"
    ) {
      return { kind: "not_configured" };
    }
    return { kind: "error", message: UPGRADE_APPLE_FAILED_MESSAGE };
  }

  // Stripe rail (web + Android, plus iOS when the server explicitly
  // says payment_platform === "stripe").
  let result: CheckoutResult;
  try {
    result = await deps.apiCreateCheckoutSession();
  } catch (err) {
    // Sustained Polsia outage (Task #397): a 5xx from the gateway
    // (other than the 503 STRIPE_NOT_CONFIGURED, which
    // `apiCreateCheckoutSession` already collapses into an `ok:false`
    // result) means the upstream is down — surface the same calm
    // "Mem is temporarily unavailable" copy the AI Guide screen uses
    // so the user knows it's not their card or their connection.
    if (
      err instanceof AuthError &&
      typeof err.status === "number" &&
      err.status >= 500
    ) {
      return { kind: "error", message: UPGRADE_STRIPE_UNAVAILABLE_MESSAGE };
    }
    return { kind: "error", message: UPGRADE_STRIPE_FAILED_MESSAGE };
  }
  if (!result.ok) return { kind: "not_configured" };
  try {
    await deps.openExternalUrl(result.url);
  } catch {
    return { kind: "error", message: UPGRADE_STRIPE_FAILED_MESSAGE };
  }
  return { kind: "opened_stripe" };
}
