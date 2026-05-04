import { useCallback } from "react";
import * as Haptics from "expo-haptics";

import { useHaptic } from "./haptics";
import { trackEvent as defaultTrackEvent } from "./analytics";
import {
  openExternalUrl as defaultOpenExternalUrl,
} from "./paymentLinks";
import {
  getCurrentEntitlementIsPro as defaultGetCurrentEntitlementIsPro,
  purchaseProSubscription as defaultPurchaseProSubscription,
  type PackagePricingDisplay,
  type ProPackages,
} from "./revenuecat";
import { apiCreateCheckoutSession as defaultApiCreateCheckoutSession } from "./subscription";
import {
  pickUpgradePackage,
  runUpgradeFlow as defaultRunUpgradeFlow,
} from "./upgradeFlow";

// Post-purchase retry: the RevenueCat → Polsia webhook is async, so
// the first /subscription/status call after the Apple sheet closes
// can still see is_pro=false for a brief window (typically <1s,
// occasionally a few s). Re-poll once after this delay so the UI
// flips to Pro without the user needing to manually refresh.
const POST_PURCHASE_REPOLL_DELAY_MS = 1500;

export interface UseHandleUpgradeOptions {
  rail: "apple" | "stripe";
  selectedPlan: "monthly" | "annual";
  proPackages: ProPackages;
  monthlyPricing: PackagePricingDisplay | null;
  annualPricing: PackagePricingDisplay | null;
  refresh: () => Promise<void> | void;
  setActionError: (next: string | null) => void;
  setActionPending: (next: boolean) => void;
  setPaymentsConfigured: (next: boolean) => void;
  setCelebrationVisible: (next: boolean) => void;
  actionPending: boolean;
  // Test-only overrides; production callers omit these.
  runFlow?: typeof defaultRunUpgradeFlow;
  getCurrentEntitlementIsPro?: typeof defaultGetCurrentEntitlementIsPro;
  trackEvent?: typeof defaultTrackEvent;
  postPurchaseRepollDelayMs?: number;
  purchaseProSubscription?: typeof defaultPurchaseProSubscription;
  apiCreateCheckoutSession?: typeof defaultApiCreateCheckoutSession;
  openExternalUrl?: typeof defaultOpenExternalUrl;
}

export function useHandleUpgrade(
  opts: UseHandleUpgradeOptions,
): () => Promise<void> {
  const {
    rail,
    selectedPlan,
    proPackages,
    monthlyPricing,
    annualPricing,
    refresh,
    setActionError,
    setActionPending,
    setPaymentsConfigured,
    setCelebrationVisible,
    actionPending,
    runFlow = defaultRunUpgradeFlow,
    getCurrentEntitlementIsPro = defaultGetCurrentEntitlementIsPro,
    trackEvent = defaultTrackEvent,
    postPurchaseRepollDelayMs = POST_PURCHASE_REPOLL_DELAY_MS,
    purchaseProSubscription = defaultPurchaseProSubscription,
    apiCreateCheckoutSession = defaultApiCreateCheckoutSession,
    openExternalUrl = defaultOpenExternalUrl,
  } = opts;

  const errorHaptic = useHaptic("error");

  return useCallback(async () => {
    if (actionPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setActionPending(true);
    setActionError(null);
    // Funnel CTA tap. Reflects the plan we'll actually attempt to
    // purchase — for Apple, that means honouring `pickUpgradePackage`'s
    // fallback when the selected cadence isn't in the catalog. Stripe
    // checkout doesn't take a package argument, so we just record the
    // user's selection.
    const startedPlan: "monthly" | "annual" =
      rail === "apple"
        ? (() => {
            const pkg = pickUpgradePackage(selectedPlan, proPackages);
            return pkg !== null && pkg === proPackages.annual
              ? "annual"
              : "monthly";
          })()
        : selectedPlan;
    trackEvent("pro_upgrade_started", { plan: startedPlan, rail });
    try {
      // The rail-specific decision logic lives in `runUpgradeFlow`
      // (lib/upgradeFlow.ts). This hook only wires the screen-side
      // side effects (state, refresh, celebration, post-purchase
      // re-poll, haptics, conversion analytics + funnel events) onto
      // each outcome so the branches stay covered by the unit tests.
      const outcome = await runFlow({
        rail,
        selectedPlan,
        proPackages,
        purchaseProSubscription,
        apiCreateCheckoutSession,
        openExternalUrl,
      });
      switch (outcome.kind) {
        case "purchased_apple": {
          setPaymentsConfigured(true);
          // Two-stage tier propagation:
          //   1. RevenueCat's CustomerInfo updates immediately on a
          //      successful purchase, so we read it directly to flip
          //      the UI without waiting for the webhook round-trip.
          //   2. The server's `is_pro` (the actual source of truth
          //      across all clients) catches up via the RevenueCat →
          //      Polsia webhook; `refresh()` polls it. We don't POST
          //      a tier change ourselves — the webhook owns that.
          await getCurrentEntitlementIsPro().catch(() => null);
          await refresh();
          // Show the celebration overlay. router.back() is deferred
          // to the overlay's onDismiss so the user sees the "You're
          // Pro" beat before landing on the prior screen. The 1500ms
          // re-poll fires in the background regardless — the overlay
          // never blocks or delays it.
          setCelebrationVisible(true);
          // Conversion event. Fires only here — restores and refreshes
          // never reach this branch. `purchasedPlan` is derived from
          // the same `pickUpgradePackage` helper used by `runUpgradeFlow`
          // so the monthly/annual fallback (when only one package is
          // available) is reflected accurately.
          const purchasedPkg = pickUpgradePackage(selectedPlan, proPackages);
          const purchasedPlan: "monthly" | "annual" =
            purchasedPkg !== null && purchasedPkg === proPackages.annual
              ? "annual"
              : "monthly";
          const purchasedPricing =
            purchasedPlan === "annual" ? annualPricing : monthlyPricing;
          trackEvent("pro_upgrade_completed", {
            plan: purchasedPlan,
            intro_offer: purchasedPricing?.introOffer != null,
            rail: "apple",
          });
          // Single bounded retry — no loop, no spinner — so a transient
          // gap doesn't surface as a confusing "still Free" state right
          // after a successful charge. Fire-and-forget; the foreground
          // listener in SubscriptionContext is the safety net beyond
          // this window.
          setTimeout(() => {
            const result = refresh();
            if (
              result !== undefined &&
              result !== null &&
              typeof (result as Promise<void>).catch === "function"
            ) {
              (result as Promise<void>).catch(() => {});
            }
          }, postPurchaseRepollDelayMs);
          return;
        }
        case "opened_stripe": {
          setPaymentsConfigured(true);
          return;
        }
        case "cancelled": {
          // Quiet cancel — Apple's sheet already gave the feedback.
          // Intentionally NOT a `pro_upgrade_failed` event: cancels
          // are normal funnel exits, not errors, and lumping them in
          // would skew the failure-rate metric.
          return;
        }
        case "not_configured": {
          setPaymentsConfigured(false);
          trackEvent("pro_upgrade_failed", {
            reason: "not_configured",
            rail,
          });
          return;
        }
        case "error": {
          setActionError(outcome.message);
          errorHaptic.play();
          // `runUpgradeFlow` already collapses raw SDK / fetch errors
          // into rail-specific copy; mirror that split here so the
          // funnel can distinguish Apple sheet failures from Stripe
          // checkout failures without re-parsing the message string.
          trackEvent("pro_upgrade_failed", {
            reason: rail === "apple" ? "purchase_failed" : "checkout_failed",
            rail,
          });
          return;
        }
      }
    } finally {
      setActionPending(false);
    }
  }, [
    actionPending,
    rail,
    selectedPlan,
    proPackages,
    monthlyPricing,
    annualPricing,
    refresh,
    setActionError,
    setActionPending,
    setPaymentsConfigured,
    setCelebrationVisible,
    runFlow,
    getCurrentEntitlementIsPro,
    trackEvent,
    postPurchaseRepollDelayMs,
    purchaseProSubscription,
    apiCreateCheckoutSession,
    openExternalUrl,
    errorHaptic,
  ]);
}
