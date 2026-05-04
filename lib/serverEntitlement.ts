/**
 * Mobile client for the in-house Pro entitlement endpoint.
 *
 * Architecture (locked Apr 28, 2026):
 *   Apple StoreKit  ── handles payment
 *   RevenueCat      ── verifies receipt, source of truth for `is_pro`
 *   Replit api      ── thin proxy that queries RevenueCat REST API and
 *                      returns a normalized entitlement payload to the app
 *   Polsia          ── NOT in the payment chain (kept only for account
 *                      metadata: login, memories sync, payment_platform hint)
 *
 * Why a Replit-side proxy instead of calling RevenueCat from the device:
 *   - The RevenueCat REST API key is a server-side secret. Embedding it
 *     in the mobile bundle would leak it (any user can decompile an .ipa
 *     and read EXPO_PUBLIC_* values).
 *   - Centralizing the call lets us cache (60s) so repeated `is_pro`
 *     reads from the app don't burn RevenueCat quota.
 *
 * Failure mode:
 *   - 503 / network error / non-2xx → returns null. The caller falls
 *     back to whatever Pro signal it had before (Polsia or local
 *     RevenueCat CustomerInfo). We never throw and never block UI.
 *
 * Base URL resolution lives in `lib/config.ts:resolveReplitApiBase`:
 *   - EXPO_PUBLIC_REPLIT_API_BASE_URL takes precedence when set
 *   - falls back to https://memtool.replit.app (the deployed api-server
 *     domain after `suggestDeploy`)
 */

import { resolveReplitApiBase } from "./config";

export interface ServerEntitlement {
  isPro: boolean;
  expiresAt: string | null;
  productId: string | null;
  source: "revenuecat" | "fallback";
  /**
   * Active server-side free-tier daily capture cap (Task #144).
   * Null when the server didn't return one — older api-server
   * builds don't include this field, so the caller must treat it
   * as advisory-only and fall back to the compiled-in
   * `FREE_DAILY_CAPTURE_LIMIT` constant. Always a positive integer
   * when present (the server's own validation rejects malformed
   * env values before they reach the wire).
   */
  freeDailyCaptureLimit: number | null;
}

function buildEndpoint(): string {
  return `${resolveReplitApiBase()}/api/subscription/entitlement`;
}

export async function fetchServerEntitlement(
  appUserId: string,
): Promise<ServerEntitlement | null> {
  if (!appUserId || appUserId.trim().length === 0) return null;
  try {
    const res = await fetch(buildEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appUserId: appUserId.trim() }),
    });
    if (!res.ok) {
      if (__DEV__) {
        console.log("[entitlement] non-OK response", res.status);
      }
      return null;
    }
    const json = (await res.json()) as Partial<ServerEntitlement>;
    if (typeof json?.isPro !== "boolean") return null;
    // Defensive parse: the cap field is advisory and only present on
    // newer api-server builds. We accept positive integers only;
    // anything else (missing, NaN, negative, fractional) maps to
    // null so the caller falls back to the compiled-in constant
    // rather than rendering "X of 0 left" or "X of 10.5 left".
    const rawCap = json.freeDailyCaptureLimit;
    const freeDailyCaptureLimit =
      typeof rawCap === "number" && Number.isInteger(rawCap) && rawCap >= 1
        ? rawCap
        : null;
    return {
      isPro: json.isPro,
      expiresAt:
        typeof json.expiresAt === "string" ? json.expiresAt : null,
      productId:
        typeof json.productId === "string" ? json.productId : null,
      source:
        json.source === "fallback" ? "fallback" : "revenuecat",
      freeDailyCaptureLimit,
    };
  } catch (err) {
    if (__DEV__) console.log("[entitlement] fetch failed", err);
    return null;
  }
}
