import { Platform } from "react-native";

import { authFetch, AuthError } from "./auth";
import { resolvePaymentRailFor } from "./paymentRail";

export { resolvePaymentRailFor };

/**
 * Polsia MemTool subscription / payments backend contract
 * (verified Apr 28, 2026 with test@test.com).
 *
 * Base: https://oc2coos-2.polsia.app/api/memtool (set in lib/config.ts).
 * Auth: Bearer token from AsyncStorage `mt_token` (handled by authFetch).
 *
 * - GET /subscription/status
 *     -> 200 {
 *          is_pro: boolean,
 *          plan: string,                 // e.g. "free" | "pro"
 *          pro_since: string | null,     // ISO date when Pro started
 *          pro_expires: string | null,   // ISO date when Pro renews/ends
 *          payment_platform: string,     // "stripe" today
 *          manage_url: string | null     // stripe portal hint, NOT relied on
 *        }
 *
 * - POST /subscription/checkout
 *     body: none required (server picks the price)
 *     -> 200 { url } | { checkout_url } | { checkoutUrl }   (when Stripe is wired)
 *     -> 503 { error, code: "STRIPE_NOT_CONFIGURED" }       (today)
 *
 * - POST /subscription/portal
 *     body: none required
 *     -> 200 { url } | { portal_url } | { portalUrl }       (when Stripe is wired)
 *     -> 503 { error, code: "STRIPE_NOT_CONFIGURED" }       (today)
 *
 * Critical contract notes:
 * - `STRIPE_NOT_CONFIGURED` is a known TRANSIENT state while the Polsia
 *   team finishes wiring Stripe. It is NOT a user-facing error — the UI
 *   surfaces it as a calm rail-not-configured message and keeps the
 *   rest of the screen rendered. The two write functions express this
 *   as a discriminated result instead of throwing, so the screen can
 *   branch on the type without parsing error strings.
 * - The exact success-shape of checkout / portal isn't verifiable yet
 *   (server returns 503 today). To stay forward-compatible we accept
 *   any of `url`, `checkout_url`, `checkoutUrl`, `portal_url`,
 *   `portalUrl` and normalize to a single `url` string. Anything that
 *   doesn't pass the http(s) check throws — never silently no-op.
 * - `manage_url` on /status is just a hint. We always re-call
 *   /subscription/portal on tap so the URL is fresh and single-use.
 * - Auth required on all three: without a Bearer token the server
 *   returns 401 `{"error":"Authorization token required"}` (verified).
 * - Dead routes (do NOT call): /payments/status, /payments/plans,
 *   /subscription, /stripe/plans, /stripe/checkout — all 404.
 *
 * No client cache: status is read-only, small, and Stripe is the
 * source of truth. The SubscriptionContext refetches on mount and on
 * subscription-screen focus so a tier change after returning from
 * Stripe shows up automatically.
 */

/**
 * Free-tier daily capture cap. Anything beyond this rolls into a
 * "Upgrade to Pro for unlimited captures" upsell on the capture +
 * log-call screens. Pro users bypass the cap entirely.
 *
 * Kept here (not in capture.tsx) so the same constant gates both the
 * capture and log-call flows and any future memory-creation surface.
 */
export const FREE_DAILY_CAPTURE_LIMIT = 10;

/**
 * Streak-freeze allowances by tier (Task #368). Free users start
 * with `FREE_MONTHLY_FREEZES` per calendar month and can earn one
 * extra by completing the wellness check-in. Pro users get
 * `PRO_MONTHLY_FREEZES` per month, baked into their entitlement —
 * the home screen surfaces this inline as part of the Pro upsell
 * copy when a free user taps the snowflake badge.
 *
 * The values here MUST match the server constants in
 * `artifacts/api-server/src/lib/streakStore.ts` so the upsell copy
 * matches what the server will actually grant. The server is the
 * source of truth (its values land in `StreakConfig.monthlyFreeze
 * Allowance`); these client constants only drive offline copy on
 * the upsell screen, never enforcement.
 */
export const FREE_MONTHLY_FREEZES = 1;
export const PRO_MONTHLY_FREEZES = 3;

/**
 * Free-tier daily cap on the AI Guide chat surface (the "Mem" tab).
 * Free users get a few messages per local-midnight day; Pro users
 * have no cap. Kept here next to FREE_DAILY_CAPTURE_LIMIT so all
 * tier-gating constants live in one file and a future tier change
 * is a one-line flip — `getAiGuideLimitState` in
 * `./aiGuideLimits.ts` is the only consumer.
 *
 * v1 value picked from the Task #63 brief. The persisted counter
 * lives in AsyncStorage as `mt_ai_guide_count_v1` keyed by the
 * local ISO date so date rollover resets without a background job.
 */
export const FREE_DAILY_AI_GUIDE_LIMIT = 3;

/**
 * How many days into the past the Archive list and editor allow on
 * each tier. Free users see the last week; Pro users see the last
 * month. Older items render as a "preview tease" locked card with a
 * deep-link to the paywall.
 *
 * These live next to FREE_DAILY_CAPTURE_LIMIT so a future tier-tweak
 * is a one-line constant flip — `getLibraryWindowState` in
 * `./captureLimits.ts` is the only consumer.
 */
export const FREE_LIBRARY_DAYS = 7;
export const PRO_LIBRARY_DAYS = 31;

/**
 * Code returned by Polsia's `/sync/memories` 402 response when a free
 * user tries to create a memory after they've already hit the daily
 * cap on the SERVER side. It mirrors the client-side
 * `CaptureLimitReachedError.code` exactly so the client can surface
 * the same upsell flow regardless of which layer caught the cap
 * first.
 *
 * Kept as a literal-typed constant (not a plain string) so a typo at
 * a usage site is a TypeScript error instead of a silent miss. The
 * actual 402 → CaptureLimitReachedError translation lives in
 * `lib/memories.ts:apiCreateMemory`.
 */
export const SERVER_CAPTURE_LIMIT_CODE = "FREE_TIER_CAPTURE_LIMIT" as const;
export type ServerCaptureLimitCode = typeof SERVER_CAPTURE_LIMIT_CODE;

/**
 * Code returned by the api-server's `/sync/memories` 429 response
 * when an account has been auto-blocked for the rest of the UTC
 * day after crossing the hard implausible-`localDay` threshold
 * (see `IMPLAUSIBLE_LOCAL_DAY_HARD_BLOCK_THRESHOLD` in
 * `artifacts/api-server/src/routes/sync-memories.ts`).
 *
 * This is distinct from `SERVER_CAPTURE_LIMIT_CODE` — that's the
 * normal "you've used your 10 free captures today" upsell case.
 * This code means the server is refusing service because we've
 * detected the client is gaming the cap window (rotating spoofed
 * `localDay` values). The 429 → `CaptureBlockedError` translation
 * lives in `lib/memories.ts:apiCreateMemory`; the screens that
 * call addMemory catch it and surface a cooldown alert instead of
 * an upsell.
 *
 * Kept as a literal-typed constant so a typo at a usage site is a
 * TypeScript error instead of a silent miss.
 */
export const SERVER_CAPTURE_BLOCKED_CODE = "CAPTURE_BLOCKED_ABUSE" as const;
export type ServerCaptureBlockedCode = typeof SERVER_CAPTURE_BLOCKED_CODE;

/**
 * Thrown by `MemoriesContext.addMemory` (and therefore `addCall`)
 * when a non-Pro user tries to create a memory after hitting
 * `FREE_DAILY_CAPTURE_LIMIT` for the day. This is the data-layer
 * enforcement (Layer 3 of the three-layer defense documented in
 * replit.md). It exists as defense in depth so that:
 *
 * - race conditions between two open capture surfaces are caught
 * - stale UI state (screen rendered before subscription status
 *   loaded) cannot sneak past the cap
 * - any future surface that calls addMemory without remembering to
 *   gate the cap itself still gets enforcement for free
 *
 * Screens that call `addMemory` (capture.tsx, log-call.tsx) catch
 * this specific error type and route the user to /subscription
 * instead of letting it bubble up as an unhandled crash.
 *
 * `code` is a string literal — kept stable so the server-side
 * enforcement follow-up ("Enforce the free daily capture cap on the
 * server too") can reuse the same constant when proxying the cap
 * from the API. The 402 → CaptureLimitReachedError translation lives
 * in `lib/memories.ts::apiCreateMemory` and is locked by
 * `lib/memories.test.ts` so a future refactor can't silently regress
 * the server-error contract.
 */
export class CaptureLimitReachedError extends Error {
  readonly code = "CAPTURE_LIMIT_REACHED" as const;
  readonly limit: number;
  constructor(limit: number = FREE_DAILY_CAPTURE_LIMIT) {
    super(`Daily capture limit of ${limit} reached`);
    this.name = "CaptureLimitReachedError";
    this.limit = limit;
  }
}

/**
 * Thrown by `apiCreateMemory` when the api-server's `/sync/memories`
 * proxy returns 429 with `code: "CAPTURE_BLOCKED_ABUSE"`. The
 * server has auto-blocked this account for the rest of the UTC
 * day after detecting repeated cap-bypass attempts (rotating
 * spoofed `localDay` values).
 *
 * This is intentionally NOT a subclass of
 * `CaptureLimitReachedError`: the screens that handle the cap
 * (capture.tsx, log-call.tsx) currently route to `/subscription`
 * for the upsell, which is the wrong response here — there is no
 * upsell, the user is being told to wait. So the screens catch
 * this type separately and surface a cooldown alert.
 *
 * The block automatically clears at the next UTC midnight (the
 * counter is bucketed by UTC day server-side), so we don't expose
 * any retry-after — the user just won't see this anymore on the
 * next UTC day.
 */
export class CaptureBlockedError extends Error {
  readonly code = "CAPTURE_BLOCKED" as const;
  constructor() {
    super("Capture is temporarily unavailable for this account");
    this.name = "CaptureBlockedError";
  }
}

/**
 * Shared title + body for the cooldown alert that the
 * memory-creation screens (capture.tsx, log-call.tsx, and any
 * future surface that calls `addMemory`/`addCall`) show when they
 * catch a `CaptureBlockedError`.
 *
 * Defined once here — next to `CaptureBlockedError` itself — so the
 * user-visible copy can never drift between the two screens (and so
 * a future tweak like rewording the auto-clear sentence or adding
 * "Contact support" is a one-line change). The screen-level tests
 * import these same constants instead of re-typing the strings, so
 * "screen and test drift together to a wrong-but-consistent
 * message" is impossible.
 */
export const CAPTURE_COOLDOWN_ALERT_TITLE = "Capture temporarily unavailable";
export const CAPTURE_COOLDOWN_ALERT_BODY =
  "We've paused new memories from your account for the rest of the day after detecting unusual activity. This will lift automatically tomorrow.";

/**
 * Thrown by `MemoriesContext.updateMemory` (and any future write
 * surface) when a user tries to mutate a memory that falls outside
 * their tier's library window — e.g. a free user editing something
 * older than 7 days. Screens catch this and route to /subscription
 * instead of letting it bubble.
 *
 * Mirrors the discriminated-error pattern used by
 * `CaptureLimitReachedError` so any future call site can branch on
 * `instanceof` cleanly without parsing message strings.
 *
 * `lockedReason` is the same string returned by
 * `getLibraryWindowState(...).lockedReason` — kept here so a future
 * UI can show different copy for "older than your free window" vs.
 * other locked states without re-deriving it.
 */
export class LibraryWindowLockedError extends Error {
  readonly code = "LIBRARY_WINDOW_LOCKED" as const;
  readonly lockedReason: string;
  constructor(lockedReason: string) {
    super(`Memory is outside your library window: ${lockedReason}`);
    this.name = "LibraryWindowLockedError";
    this.lockedReason = lockedReason;
  }
}

export interface SubscriptionStatus {
  is_pro: boolean;
  plan: string;
  pro_since: string | null;
  pro_expires: string | null;
  payment_platform: string;
  manage_url: string | null;
}

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; reason: "not_configured" };

export type PortalResult =
  | { ok: true; url: string }
  | { ok: false; reason: "not_configured" };

type ServerStatusResponse = Partial<SubscriptionStatus> & Record<string, unknown>;

/**
 * Defensive normalization (rule #6 in the task brief): coerce
 * missing/malformed fields to safe defaults so a backend hiccup can
 * never crash the screen with a render-time TypeError. Empty strings
 * on the nullable date fields are treated as null so the hide-on-null
 * UI rules apply uniformly.
 */
function normalizeStatus(raw: unknown): SubscriptionStatus {
  const r = (raw && typeof raw === "object" ? raw : {}) as ServerStatusResponse;
  const nullableString = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v : null;
  return {
    is_pro: r.is_pro === true,
    plan: typeof r.plan === "string" && r.plan.length > 0 ? r.plan : "free",
    pro_since: nullableString(r.pro_since),
    pro_expires: nullableString(r.pro_expires),
    payment_platform:
      typeof r.payment_platform === "string" && r.payment_platform.length > 0
        ? r.payment_platform
        : "stripe",
    manage_url: nullableString(r.manage_url),
  };
}

/**
 * Pull the checkout / portal URL out of an unknown server response.
 * Accepts any of the common Stripe-style key names. Returns null if
 * none of the candidates is a non-empty https:// URL — the caller
 * turns that into a thrown error so the UI shows "Couldn't open
 * Stripe". https-only because Stripe never serves checkout / portal
 * over plain http and we don't want to be tricked into opening one.
 */
function extractUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const candidates = [
    r.url,
    r.checkout_url,
    r.checkoutUrl,
    r.portal_url,
    r.portalUrl,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^https:\/\/\S+$/i.test(c)) {
      return c;
    }
  }
  return null;
}

export async function apiGetSubscriptionStatus(): Promise<SubscriptionStatus> {
  const data = await authFetch("/subscription/status", { method: "GET" });
  return normalizeStatus(data);
}

/**
 * Distinguishes the known `STRIPE_NOT_CONFIGURED` transient state
 * from real failures. We rely on the structured `code` field in the
 * server's response body (preserved on AuthError.body), NOT on the
 * error message — `authFetch` rewrites all 5xx messages to a generic
 * "Server error — please try again", so message-string matching
 * would silently miss this case. All other thrown errors propagate
 * so the screen can show a generic retryable error.
 */
async function postSubscriptionAction(
  path: "/subscription/checkout" | "/subscription/portal",
): Promise<{ ok: true; url: string } | { ok: false; reason: "not_configured" }> {
  try {
    // No body sent: server picks the price and the return URL.
    // Verified empty-POST behavior against /checkout and /portal —
    // 503 came from STRIPE_NOT_CONFIGURED, never from missing fields.
    const data = await authFetch(path, { method: "POST" });
    const url = extractUrl(data);
    if (!url) {
      throw new Error("Server returned an invalid URL");
    }
    return { ok: true, url };
  } catch (err) {
    if (err instanceof AuthError && err.status === 503) {
      const body = err.body;
      const code =
        body && typeof body === "object"
          ? (body as { code?: unknown }).code
          : undefined;
      if (code === "STRIPE_NOT_CONFIGURED") {
        return { ok: false, reason: "not_configured" };
      }
    }
    throw err;
  }
}

export async function apiCreateCheckoutSession(): Promise<CheckoutResult> {
  return postSubscriptionAction("/subscription/checkout");
}

export async function apiCreatePortalSession(): Promise<PortalResult> {
  return postSubscriptionAction("/subscription/portal");
}

/**
 * Runtime wrapper around `resolvePaymentRailFor` (defined in
 * `./paymentRail.ts`) that injects `Platform.OS` from React Native.
 *
 * The pure decision logic and full rule documentation live in
 * `./paymentRail.ts` so they can be unit-tested in plain Node — see
 * `scripts/src/testPaymentRail.ts` for the rail decision matrix.
 */
export type { PaymentRail } from "./paymentRail";

export function resolvePaymentRail(
  status: SubscriptionStatus | null,
): import("./paymentRail").PaymentRail {
  return resolvePaymentRailFor(status?.payment_platform, Platform.OS);
}
