/**
 * Mobile client for the Skills entitlements endpoint (Task #337).
 *
 * Returns which Bundle 1 entitlements the signed-in user owns,
 * as resolved by the server's RevenueCat REST proxy. The mobile
 * app trusts the server (never the on-device SDK) for the gate
 * itself — the SDK is used only to drive purchases.
 *
 * Failure mode: returns null on any non-OK response or network
 * blip. Callers fall back to "no Skills owned" — i.e. the paywall
 * is shown — rather than risking a free-ride from a stale local cache.
 */

import { resolveReplitApiBase } from "./config";
import {
  SKILLS_BUNDLE_ENTITLEMENT_KEY,
  ALL_SKILL_ENTITLEMENT_KEYS,
} from "./skillsBundle";

export interface SkillsEntitlements {
  /** Set of entitlement keys (e.g. `skills_bundle_1`, `skill_mem_says`). */
  owned: ReadonlySet<string>;
  source: "revenuecat" | "fallback";
}

interface WireResponse {
  entitlements?: Record<string, boolean | undefined>;
  source?: string;
}

function buildEndpoint(): string {
  return `${resolveReplitApiBase()}/api/subscription/skills-entitlements`;
}

export async function fetchSkillsEntitlements(
  appUserId: string,
): Promise<SkillsEntitlements | null> {
  if (!appUserId || appUserId.trim().length === 0) return null;
  try {
    const res = await fetch(buildEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appUserId: appUserId.trim(),
        keys: ALL_SKILL_ENTITLEMENT_KEYS,
      }),
    });
    if (!res.ok) {
      if (__DEV__) {
        console.log("[skillsEntitlement] non-OK", res.status);
      }
      return null;
    }
    const json = (await res.json()) as WireResponse;
    const owned = new Set<string>();
    if (json.entitlements && typeof json.entitlements === "object") {
      for (const key of ALL_SKILL_ENTITLEMENT_KEYS) {
        if (json.entitlements[key] === true) owned.add(key);
      }
    }
    // Bundle is the master switch: when present, every per-skill
    // key is unlocked too. Materialise that here so callers can
    // treat the Set as a flat ownership view without re-checking
    // the bundle.
    if (owned.has(SKILLS_BUNDLE_ENTITLEMENT_KEY)) {
      for (const key of ALL_SKILL_ENTITLEMENT_KEYS) owned.add(key);
    }
    return {
      owned,
      source: json.source === "fallback" ? "fallback" : "revenuecat",
    };
  } catch (err) {
    if (__DEV__) console.log("[skillsEntitlement] fetch failed", err);
    return null;
  }
}
