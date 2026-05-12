import * as React from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import Purchases, {
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from "react-native-purchases";

import { useAuth } from "@/context/AuthContext";

/**
 * MemTool RevenueCat (Apple In-App Purchase) client wrapper.
 *
 * Why this file exists:
 * - MemTool ships iOS-only. Per Apple App Store rules for digital
 *   subscriptions, iOS users must pay through Apple's native purchase
 *   sheet, which RevenueCat wraps around StoreKit. This module is the
 *   only place that talks to `react-native-purchases`.
 * - The web dev preview (Expo Web) keeps running with RevenueCat
 *   disabled — `isRevenueCatConfigured()` returns false there and the
 *   subscription screen falls back to its non-purchase UX so the
 *   preview never crashes.
 *
 * Configuration model:
 * - The two EXPO_PUBLIC_REVENUECAT_*_API_KEY env vars (iOS production
 *   + test/sandbox) are expected once the RevenueCat integration is
 *   wired and the seed script has been run. Until then,
 *   `isRevenueCatConfigured()` returns false and the screen handles it
 *   gracefully. We never throw from import / init to keep startup safe
 *   in a partially-configured environment.
 * - `REVENUECAT_ENTITLEMENT_IDENTIFIER` is the entitlement key created
 *   by the seed script. Convention here is `pro` to match the server's
 *   `is_pro` semantics.
 *
 * Authoritative tier source:
 * - The server's `/subscription/status.is_pro` remains the source of
 *   truth for whether the account is Pro (it sees Apple receipt
 *   webhooks alongside Stripe webhooks). RevenueCat's CustomerInfo is
 *   used here only to drive the *purchase* flow on iOS, after which we
 *   refresh the server status so the rest of the app sees the new
 *   tier. We deliberately do NOT branch the UI's Pro badge on
 *   RevenueCat state — the server-side `is_pro` flag is authoritative
 *   so the badge stays consistent across surfaces.
 */

const REVENUECAT_TEST_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;

export const REVENUECAT_ENTITLEMENT_IDENTIFIER = "pro";

/**
 * Pro subscription product identifiers as configured in App Store
 * Connect and mirrored in RevenueCat. These are the EXACT, immutable
 * Apple StoreKit product IDs — they MUST match what's in the
 * RevenueCat dashboard's product catalog (and downstream, App Store
 * Connect). If a product ID in either system is renamed, the resolved
 * package will be `null` and the paywall renders only the resolved
 * options (or none) — never a misleading hardcoded price.
 *
 * We resolve packages by exact product identifier (not by index into
 * `availablePackages` and not by RevenueCat package identifier like
 * `$rc_monthly`) so we can guarantee which option the UI is showing
 * regardless of how the offering is laid out in the dashboard.
 *
 * Pricing, intro offers (e.g. $0.99 for first 12 months on monthly,
 * $9.99 for first year on annual), and currency-localized priceString
 * all come from `pkg.product.*` — never hardcode money in the UI.
 * App Store Review will reject a paywall that displays prices
 * inconsistent with App Store Connect.
 */
export const PRO_MONTHLY_PRODUCT_ID = "memtool_pro_monthly";
export const PRO_ANNUAL_PRODUCT_ID = "memtool_pro_annual";

/**
 * Resolved pair of packages for the two-option paywall. Either side
 * can be null independently — we render only the resolved options
 * rather than blocking the whole screen if (for example) the annual
 * package is mid-rollout in App Store Connect.
 */
export interface ProPackages {
  monthly: PurchasesPackage | null;
  annual: PurchasesPackage | null;
}

let initialized = false;
let initializationError: Error | null = null;

/**
 * Pick the RevenueCat public API key for this runtime. The Test Store
 * key covers Expo Go (`storeClient`), web, and dev builds — the
 * production iOS key is only used in a real App Store build.
 *
 * MemTool ships iOS-only. On any non-iOS platform (web dev preview,
 * Expo Go on a non-iOS host, or a future RN platform we haven't shipped
 * to), this returns null rather than throwing so the dev preview keeps
 * running and the screen falls back to its non-purchase UX.
 *
 * Returns null when no key is available — the caller treats that as
 * "RevenueCat not configured" rather than throwing, so the app keeps
 * running.
 */
function pickApiKey(): string | null {
  if (
    __DEV__ ||
    Platform.OS === "web" ||
    Constants.executionEnvironment === "storeClient"
  ) {
    return REVENUECAT_TEST_API_KEY ?? null;
  }
  if (Platform.OS === "ios") return REVENUECAT_IOS_API_KEY ?? null;
  return null;
}

/**
 * `true` once `Purchases.configure` has succeeded. Used by the screen
 * to decide whether to render the live Apple-rail CTA vs. keep the
 * upgrade button disabled until a key is configured (web preview path).
 */
export function isRevenueCatConfigured(): boolean {
  return initialized;
}

export function getRevenueCatInitError(): Error | null {
  return initializationError;
}

/**
 * Idempotent. Safe to call multiple times — only configures once.
 * Never throws: a failed init is recorded in `initializationError`
 * and surfaced to the UI by `isRevenueCatConfigured()` returning
 * false. The skill's canonical pattern is to wrap in try/catch at
 * the call site; we keep that contract by also catching internally
 * so a missing key in dev doesn't fail the whole app.
 */
export function initializeRevenueCat(): void {
  if (initialized) return;
  const apiKey = pickApiKey();
  if (!apiKey) {
    initializationError = new Error(
      "RevenueCat public API key not set — Apple IAP disabled",
    );
    if (__DEV__) {
      console.log(
        "[revenuecat] not configured (no EXPO_PUBLIC_REVENUECAT_*_API_KEY set)",
      );
    }
    return;
  }
  try {
    if (__DEV__) {
      Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
    }
    Purchases.configure({ apiKey });
    initialized = true;
    initializationError = null;
    if (__DEV__) console.log("[revenuecat] configured");
  } catch (err) {
    initializationError = err instanceof Error ? err : new Error(String(err));
    console.warn("[revenuecat] configure failed", err);
  }
}

/**
 * Bind the signed-in user's identity to RevenueCat so receipts on this
 * device are credited to the right account on the server. Safe to call
 * with the same id multiple times. No-op when not configured.
 */
export async function identifyRevenueCatUser(
  appUserId: string,
): Promise<void> {
  if (!initialized) return;
  try {
    await Purchases.logIn(appUserId);
  } catch (err) {
    console.warn("[revenuecat] logIn failed", err);
  }
}

export async function logoutRevenueCatUser(): Promise<void> {
  if (!initialized) return;
  try {
    await Purchases.logOut();
  } catch (err) {
    // logOut throws if the user is already anonymous — non-fatal.
    if (__DEV__) console.log("[revenuecat] logOut noop", err);
  }
}

export type ApplePurchaseResult =
  | { ok: true; isPro: boolean }
  | { ok: false; reason: "not_configured" | "cancelled" | "no_offering" }
  | { ok: false; reason: "error"; message: string };

/**
 * Resolve the monthly + annual packages from the current offering by
 * EXACT Apple product identifier. We deliberately do not pick by
 * index or by RevenueCat package id (`$rc_monthly` / `$rc_annual`)
 * so a dashboard re-order can never accidentally swap which product
 * the user is buying. Either side can be null independently — the
 * paywall renders only what's resolved, so a mid-rollout where one
 * product hasn't propagated yet still shows the available option
 * instead of an empty screen.
 */
function resolveProPackages(
  offering: PurchasesOffering | null | undefined,
): ProPackages {
  const empty: ProPackages = { monthly: null, annual: null };
  if (!offering) return empty;
  const pkgs = offering.availablePackages;
  if (!pkgs || pkgs.length === 0) return empty;
  let monthly: PurchasesPackage | null = null;
  let annual: PurchasesPackage | null = null;
  for (const pkg of pkgs) {
    const id = pkg.product?.identifier;
    if (id === PRO_MONTHLY_PRODUCT_ID) monthly = pkg;
    else if (id === PRO_ANNUAL_PRODUCT_ID) annual = pkg;
  }
  return { monthly, annual };
}

export async function getProPackages(): Promise<ProPackages> {
  if (!initialized) return { monthly: null, annual: null };
  try {
    const offerings = await Purchases.getOfferings();
    return resolveProPackages(offerings.current);
  } catch (err) {
    console.warn("[revenuecat] getOfferings failed", err);
    return { monthly: null, annual: null };
  }
}

/**
 * Single-source-of-truth pricing label builder for both paywall
 * options. Every cent and every period string is read live from
 * `pkg.product.*` — there is intentionally no string fallback that
 * substitutes hardcoded money. App Store Review rejects paywalls
 * whose displayed prices don't match App Store Connect, so the only
 * safe path is "render what the SDK returns or render nothing".
 *
 * Returned shape:
 *   - `headlinePrice`  — the big price the option card shows
 *                        (e.g. "$2.99", "$29.99"). Always
 *                        currency-localized via `priceString`.
 *   - `cadence`        — short suffix like "/month" or "/year". For
 *                        non-month/year cycles we fall back to the
 *                        ISO period string (rare for our products).
 *   - `introOffer`     — null when there's no Apple-configured intro
 *                        price; otherwise a one-line summary the UI
 *                        renders below the headline (e.g. "$0.99/mo
 *                        for first 12 months").
 *   - `freeTrial`      — null unless the SDK reports a $0 intro
 *                        phase; otherwise "X days free, then
 *                        $Y/period" for the Annual card.
 *   - `pricePerMonth`  — currency-localized per-month price for
 *                        cross-comparison with the monthly card. The
 *                        SDK provides this directly via
 *                        `pricePerMonthString`; we never compute it
 *                        ourselves to avoid currency rounding drift.
 *
 * Comments here are deliberately verbose because this is the one
 * helper that, if it silently falls back to wrong copy, will get the
 * app rejected. Any future code touching paywall pricing should go
 * through this function — no exceptions.
 */
export interface PackagePricingDisplay {
  headlinePrice: string;
  cadence: string;
  introOffer: string | null;
  freeTrial: string | null;
  pricePerMonth: string | null;
}

export function formatPackagePricing(
  pkg: PurchasesPackage,
): PackagePricingDisplay {
  const product = pkg.product;
  const headlinePrice = product.priceString;
  const cadence = cadenceFromIso(product.subscriptionPeriod);
  const pricePerMonth = product.pricePerMonthString ?? null;
  const intro = product.introPrice;
  let introOffer: string | null = null;
  let freeTrial: string | null = null;
  if (intro) {
    const cycles = intro.cycles;
    const unit = (intro.periodUnit || "").toUpperCase();
    const introCadence = unit === "MONTH"
      ? cycles === 1
        ? "for first month"
        : `for first ${cycles} months`
      : unit === "YEAR"
      ? cycles === 1
        ? "for first year"
        : `for first ${cycles} years`
      : unit === "WEEK"
      ? cycles === 1
        ? "for first week"
        : `for first ${cycles} weeks`
      : unit === "DAY"
      ? cycles === 1
        ? "for first day"
        : `for first ${cycles} days`
      : `for first ${cycles} cycles`;
    // Detect numeric zero (locale-safe) rather than parsing priceString.
    const isFreeTrial =
      typeof (intro as { price?: number }).price === "number" &&
      (intro as { price: number }).price === 0;
    if (isFreeTrial) {
      const trialUnit = unit === "MONTH"
        ? cycles === 1 ? "1 month free" : `${cycles} months free`
        : unit === "YEAR"
        ? cycles === 1 ? "1 year free" : `${cycles} years free`
        : unit === "WEEK"
        ? cycles === 1 ? "1 week free" : `${cycles} weeks free`
        : unit === "DAY"
        ? cycles === 1 ? "1 day free" : `${cycles} days free`
        : `${cycles} cycles free`;
      freeTrial = `${trialUnit}, then ${headlinePrice}${cadence}`;
    } else {
      introOffer = `${intro.priceString} ${introCadence}`;
    }
  }
  return { headlinePrice, cadence, introOffer, freeTrial, pricePerMonth };
}

function cadenceFromIso(iso: string | null): string {
  if (!iso) return "";
  if (iso === "P1M") return "/month";
  if (iso === "P1Y") return "/year";
  if (iso === "P1W") return "/week";
  if (iso === "P3M") return "/3 months";
  if (iso === "P6M") return "/6 months";
  return `/${iso}`;
}

/**
 * Trigger Apple's native purchase sheet for the current Pro package.
 *
 * Result discrimination mirrors the Stripe-side `CheckoutResult` so
 * the screen can branch the same way:
 *   - { ok: true, isPro }            → purchase completed (or already
 *                                       owned via restore-on-purchase).
 *   - { ok: false, reason: "cancelled" }
 *                                    → user dismissed Apple's sheet.
 *                                       Not an error, no toast needed.
 *   - { ok: false, reason: "not_configured" }
 *                                    → RevenueCat keys missing (web
 *                                       dev preview only) — UI keeps
 *                                       the CTA disabled.
 *   - { ok: false, reason: "no_offering" }
 *                                    → RevenueCat is configured but
 *                                       no current offering yet (seed
 *                                       script not run / not synced).
 *   - { ok: false, reason: "error", message }
 *                                    → unexpected purchase failure;
 *                                       UI surfaces a generic message.
 *
 * `userCancelled` detection: the SDK sets a `userCancelled: true`
 * field on the thrown error for cancellations. We match on that
 * (authoritative), not on error message text.
 */
export async function purchaseProSubscription(
  pkg: PurchasesPackage,
): Promise<ApplePurchaseResult> {
  if (!initialized) return { ok: false, reason: "not_configured" };
  if (!pkg) return { ok: false, reason: "no_offering" };
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { ok: true, isPro: hasProEntitlement(customerInfo) };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "userCancelled" in err &&
      (err as { userCancelled?: boolean }).userCancelled === true
    ) {
      return { ok: false, reason: "cancelled" };
    }
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Purchase failed",
    };
  }
}

/**
 * Read the latest CustomerInfo from RevenueCat after a purchase or
 * restore. The webhook flow (RevenueCat → Polsia) updates the
 * server's `is_pro` asynchronously; while that propagates, the UI
 * checks this directly to avoid a brief "thanks for upgrading"
 * screen that still says "Free". Returns null when not configured
 * or when the SDK call fails — caller falls back to the server
 * status refresh.
 */
export async function getCurrentEntitlementIsPro(): Promise<boolean | null> {
  if (!initialized) return null;
  try {
    const info = await Purchases.getCustomerInfo();
    return hasProEntitlement(info);
  } catch (err) {
    if (__DEV__) console.log("[revenuecat] getCustomerInfo failed", err);
    return null;
  }
}

export type RestoreResult =
  | { ok: true; isPro: boolean }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "error"; message: string };

export async function restoreApplePurchases(): Promise<RestoreResult> {
  if (!initialized) return { ok: false, reason: "not_configured" };
  try {
    const info = await Purchases.restorePurchases();
    return { ok: true, isPro: hasProEntitlement(info) };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Restore failed",
    };
  }
}

function hasProEntitlement(info: CustomerInfo): boolean {
  const active = info?.entitlements?.active;
  if (!active) return false;
  return active[REVENUECAT_ENTITLEMENT_IDENTIFIER] !== undefined;
}

// ---------------------------------------------------------------------
// Skills Bundle 1 — non-subscription IAP helpers (Task #337).
//
// One-time purchases (RevenueCat models them as non-renewing
// "consumable"/"non_consumable" products attached to per-skill
// entitlements). We resolve packages by exact product identifier so a
// dashboard re-order can never accidentally swap which SKU the user
// is buying. Server-trust gating still applies — these helpers only
// drive the StoreKit sheet; the on-device CustomerInfo is treated as
// advisory, the server's `/subscription/skills-entitlements` is the
// authoritative read.
// ---------------------------------------------------------------------

export type SkillsPurchaseResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "cancelled" | "no_offering" }
  | { ok: false; reason: "error"; message: string };

async function resolvePackageByProductId(
  productId: string,
): Promise<PurchasesPackage | null> {
  if (!initialized) return null;
  try {
    const offerings = await Purchases.getOfferings();
    // Search every offering (current first) so a Skills package
    // configured in a non-default offering still resolves.
    const all: PurchasesOffering[] = [];
    if (offerings.current) all.push(offerings.current);
    for (const key of Object.keys(offerings.all || {})) {
      const o = offerings.all[key];
      if (o && o !== offerings.current) all.push(o);
    }
    for (const o of all) {
      for (const pkg of o.availablePackages || []) {
        if (pkg.product?.identifier === productId) return pkg;
      }
    }
    return null;
  } catch (err) {
    if (__DEV__) console.log("[revenuecat] resolveSkillsPackage failed", err);
    return null;
  }
}

export async function getSkillsPackage(
  productId: string,
): Promise<PurchasesPackage | null> {
  return resolvePackageByProductId(productId);
}

export async function purchaseSkillsProduct(
  productId: string,
): Promise<SkillsPurchaseResult> {
  if (!initialized) return { ok: false, reason: "not_configured" };
  const pkg = await resolvePackageByProductId(productId);
  if (!pkg) return { ok: false, reason: "no_offering" };
  try {
    await Purchases.purchasePackage(pkg);
    return { ok: true };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "userCancelled" in err &&
      (err as { userCancelled?: boolean }).userCancelled === true
    ) {
      return { ok: false, reason: "cancelled" };
    }
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Purchase failed",
    };
  }
}

/**
 * Apple's official deep link to the user's subscription management
 * screen, per the App Store Review Guidelines (3.1.2):
 * https://apps.apple.com/account/subscriptions opens directly into
 * the iOS Settings → Subscriptions sheet on a real device, and the
 * App Store on a simulator. We use the https form (not itms-apps://)
 * so Linking.openURL accepts it without an extra
 * LSApplicationQueriesSchemes entry.
 */
export const APPLE_MANAGE_SUBSCRIPTIONS_URL =
  "https://apps.apple.com/account/subscriptions";

/**
 * Hook that ensures RevenueCat sees the same identity as the rest of
 * the app. Called from a small bridge component in _layout so we keep
 * the side-effect inside React's lifecycle (auth state + initialized
 * flag) instead of firing it from module scope.
 */
export function useRevenueCatIdentity(): void {
  const { user } = useAuth();
  React.useEffect(() => {
    if (!initialized) return;
    if (user?.email) {
      identifyRevenueCatUser(user.email).catch(() => {});
    } else {
      logoutRevenueCatUser().catch(() => {});
    }
  }, [user?.email]);
}
