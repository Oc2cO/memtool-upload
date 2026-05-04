/**
 * Lightweight analytics shim. No real provider is wired up yet, so
 * `trackEvent` logs in dev and is a no-op in production. When a real
 * SDK lands, replace the body — call sites stay untouched.
 *
 * Errors are swallowed so a broken analytics path can never bubble
 * into the calling flow (especially purchase celebrations).
 */

export type AnalyticsEventProperties = Record<
  string,
  string | number | boolean | null
>;

export function trackEvent(
  name: string,
  properties?: AnalyticsEventProperties,
): void {
  try {
    if (__DEV__) {
      console.log("[analytics]", name, properties ?? {});
    }
  } catch (err) {
    if (__DEV__) console.warn("[analytics] trackEvent failed", err);
  }
}
