/**
 * Pure payment-rail decision logic for the MemTool subscription
 * screen. Lives in its own file (separate from `subscription.ts`) so
 * it has zero React Native dependencies and can be unit-tested in
 * plain Node — see `scripts/src/testPaymentRail.ts`.
 *
 * The runtime wrapper that feeds in `Platform.OS` lives in
 * `subscription.ts` as `resolvePaymentRail(status)`.
 *
 * Decision order (the rules below are intentionally not strictly
 * "server-first" — Apple's App Store rules and the server hint both
 * have veto power, in this priority):
 *
 *   1. Server `payment_platform === "apple"` → Apple, on every
 *      platform. This is the cross-device case in the task brief: a
 *      user who first subscribed on iPhone and now opens the web
 *      build still needs the Manage button to deep-link into Apple's
 *      subscription page (the only place an Apple-billed sub can be
 *      managed). Surfacing the Stripe portal here would either say
 *      "no subscription found" or worse, charge them twice.
 *
 *   2. `platformOS === "ios"` → Apple, regardless of what the server
 *      says. Apple's App Store Review Guidelines forbid selling
 *      digital subscriptions on iOS through anything other than
 *      In-App Purchase, so we must NEVER open the Stripe
 *      checkout/portal on iOS — even if the server's
 *      `payment_platform` field still defaults to "stripe" (which it
 *      does today for every user). The server is treated as a hint,
 *      not a license to violate App Store rules.
 *
 *   3. Otherwise → Stripe. This covers web and Android, where Apple
 *      IAP doesn't apply and the existing Stripe rail continues to
 *      work with no regression.
 *
 * Edge case (rare): a non-Pro user on web whose server status reports
 * "apple" can't actually open Apple's native purchase sheet — that
 * requires StoreKit. The Apple purchase function will return
 * `{ ok: false, reason: "not_configured" }` and the screen falls back
 * to its rail-not-configured inline error, prompting the user
 * to open the iOS app. The Manage button on web for an Apple-billed
 * Pro user still works fine via the https deep link (opens Apple's
 * account page in the browser).
 */
export type PaymentRail = "apple" | "stripe";

export function resolvePaymentRailFor(
  serverPaymentPlatform: string | null | undefined,
  platformOS: string,
): PaymentRail {
  if (serverPaymentPlatform === "apple") return "apple";
  if (platformOS === "ios") return "apple";
  return "stripe";
}
