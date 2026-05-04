/**
 * Companion Skills Bundle 1 registry (Task #337).
 *
 * Pure module: no React, no AsyncStorage, no network. Defines the
 * four mini-games shipped in Bundle 1, the RevenueCat product
 * identifiers (one bundle SKU + four per-skill SKUs), and the
 * matching server-side entitlement keys.
 *
 * Two purchase paths exist for every skill:
 *   1. Skills Bundle 1 ($2.99) — grants all four entitlements
 *      `skill_*` at once. This is the default CTA on the paywall.
 *   2. Per-skill ($0.99 each) — grants exactly one `skill_*`
 *      entitlement. Surfaced as "Just want one?" below the bundle
 *      CTA so a curious user is never forced into the bundle.
 *
 * Pro subscribers do NOT auto-receive Skills entitlements — these
 * are separate one-time IAPs by design (see task #337 spec). Mixing
 * them would force every Pro renewal to also re-grant Skills, which
 * RevenueCat models awkwardly and isn't what the spec promised.
 */

export type SkillId =
  | "mem_says"
  | "signal_sort"
  | "pattern_path"
  | "echo_count";

export interface SkillDefinition {
  id: SkillId;
  /** Short title shown on the Skills home tile and the game header. */
  title: string;
  /** One-sentence pitch shown on the home tile. */
  tagline: string;
  /** Per-skill RevenueCat product identifier ($0.99). */
  productId: string;
  /** Per-skill server entitlement key (matches RevenueCat dashboard). */
  entitlementKey: SkillEntitlementKey;
  /** Route under /skills/* the home tile pushes to. */
  route: SkillRoute;
  /**
   * Stable seed component combined with the round seed so two players
   * sharing the same friend-challenge link see the same round shape
   * for the same skill. Different value per skill so the same friend
   * link doesn't accidentally resolve to "the same numbers" across
   * games.
   */
  seedSalt: number;
}

export type SkillEntitlementKey =
  | "skill_mem_says"
  | "skill_signal_sort"
  | "skill_pattern_path"
  | "skill_echo_count";

export type SkillRoute =
  | "/skills/mem-says"
  | "/skills/signal-sort"
  | "/skills/pattern-path"
  | "/skills/echo-count";

export const SKILLS_BUNDLE_PRODUCT_ID = "com.oc2co.memtool.skills.bundle1";
export const SKILLS_BUNDLE_ENTITLEMENT_KEY = "skills_bundle_1";

export const SKILLS_BUNDLE_PRICE_USD = 2.99;
export const SKILL_INDIVIDUAL_PRICE_USD = 0.99;

export const SKILLS: readonly SkillDefinition[] = [
  {
    id: "mem_says",
    title: "Mem Says",
    tagline: "Watch the colour pattern, then play it back.",
    productId: "com.oc2co.memtool.skill.mem_says",
    entitlementKey: "skill_mem_says",
    route: "/skills/mem-says",
    seedSalt: 0x1a2b,
  },
  {
    id: "signal_sort",
    title: "Signal Sort",
    tagline: "Sort the incoming signals before time runs out.",
    productId: "com.oc2co.memtool.skill.signal_sort",
    entitlementKey: "skill_signal_sort",
    route: "/skills/signal-sort",
    seedSalt: 0x3c4d,
  },
  {
    id: "pattern_path",
    title: "Pattern Path",
    tagline: "Trace the path you saw without lifting your finger.",
    productId: "com.oc2co.memtool.skill.pattern_path",
    entitlementKey: "skill_pattern_path",
    route: "/skills/pattern-path",
    seedSalt: 0x5e6f,
  },
  {
    id: "echo_count",
    title: "Echo Count",
    tagline: "Count the chimes — your ears are the only clue.",
    productId: "com.oc2co.memtool.skill.echo_count",
    entitlementKey: "skill_echo_count",
    route: "/skills/echo-count",
    seedSalt: 0x7081,
  },
];

export function getSkill(id: SkillId): SkillDefinition {
  const found = SKILLS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown skill id: ${id}`);
  return found;
}

/** All entitlement keys queried in the skills entitlements endpoint. */
export const ALL_SKILL_ENTITLEMENT_KEYS: readonly string[] = [
  SKILLS_BUNDLE_ENTITLEMENT_KEY,
  ...SKILLS.map((s) => s.entitlementKey),
];

/**
 * True when the user owns the skill — either because they bought
 * the bundle (`skills_bundle_1`) or because they bought just this
 * skill (`skill_<id>`). Pure function so the same logic powers UI
 * gates and the server-trust check helper.
 */
export function isSkillUnlocked(
  skill: SkillDefinition,
  ownedEntitlements: ReadonlySet<string>,
): boolean {
  if (ownedEntitlements.has(SKILLS_BUNDLE_ENTITLEMENT_KEY)) return true;
  return ownedEntitlements.has(skill.entitlementKey);
}

/** True when the user owns the bundle (every skill is unlocked). */
export function ownsBundle(ownedEntitlements: ReadonlySet<string>): boolean {
  return ownedEntitlements.has(SKILLS_BUNDLE_ENTITLEMENT_KEY);
}
