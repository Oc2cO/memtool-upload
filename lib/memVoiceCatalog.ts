import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Speech from "expo-speech";

/**
 * Curated "Mem voice" catalog (Task #292, expanded for warmer defaults).
 *
 * `Speech.getAvailableVoicesAsync()` returns *every* voice installed
 * on the device — typically dozens, in many languages, with raw
 * identifiers like `com.apple.voice.compact.en-US.Samantha` or
 * `com.apple.voice.premium.en-US.Ava`. Surfacing that whole list in
 * Settings would be hostile; surfacing nothing would deny users the
 * choice the brief asks for.
 *
 * The compromise is a small, friendly catalog of voices selected for
 * warmth and a calming cadence — the brief is "feels like 'their' Mem".
 *
 * Quality tiers (iOS):
 *   - **Premium**: Apple's neural Siri voices. Free, on-device, no
 *     copyright concerns. Ship with iOS 16+ but the audio data must
 *     be downloaded by the user from
 *     Settings → Accessibility → Spoken Content → Voices → English.
 *     These are the voices that actually sound human and are the
 *     ones we want to default to whenever they're installed.
 *   - **Enhanced**: built-in higher-quality voices that don't
 *     require a download. Markedly less robotic than the Compact
 *     tier and a fine fallback for users who haven't gone hunting
 *     for the Premium ones.
 *   - **Compact**: the legacy small-footprint voices. Available
 *     everywhere but they're the robotic ones the user explicitly
 *     wanted us to move away from. We never promote a Compact voice
 *     in the catalog; if nothing else is installed the catalog
 *     collapses to "System default" only.
 *
 * Default selection (first-launch behaviour):
 *   When no voice id has been persisted yet, `useEffectiveMemVoiceId`
 *   resolves to the highest-tier installed voice from this catalog,
 *   preferring the curated "default" pair: **Ava** (US English,
 *   female) and **Evan** (US English, male). This way a brand new
 *   user hears a warm, calming voice the very first time Mem speaks
 *   — without having to discover the picker.
 *
 * Only English voices are included by design: the rest of MemTool's
 * UI is English-only, and a Spanish voice reading "Hi — I'm Mem."
 * would mispronounce the dash. Localising the voice picker is a
 * separate task once the rest of the app supports more languages.
 */

export type MemVoiceTier = "premium" | "enhanced" | "system";
export type MemVoiceGender = "female" | "male" | "neutral";

export interface CuratedMemVoice {
  /**
   * Stable id used for persistence + passed straight to
   * `Speech.speak({ voice })`. `null` is the "system default"
   * pseudo-voice and means "let the OS pick" (clears the saved id).
   */
  id: string | null;
  /** Friendly label shown in Settings (e.g. "Ava — Calm"). */
  label: string;
  /** One-line description shown beneath the label. */
  subtitle: string;
  /** Quality tier — drives the "Premium" badge in Settings. */
  tier: MemVoiceTier;
  /** Voice gender, for the male/female grouping in Settings. */
  gender: MemVoiceGender;
  /**
   * True when this is one of the curated "warmest defaults" — the
   * voices we recommend for first-launch users. Used by Settings to
   * pin a small "Recommended" star next to the row.
   */
  recommended?: boolean;
}

interface NamedPersona {
  label: string;
  subtitle: string;
  tier: MemVoiceTier;
  gender: MemVoiceGender;
  recommended?: boolean;
  /**
   * Match against an installed voice. iOS exposes the human name
   * directly (`Ava`); we additionally check the identifier substring
   * so renamed/localised name fields still match. For Premium voices
   * we *also* require the identifier to contain "premium" so we don't
   * accidentally promote a Compact `Ava` (which sounds noticeably
   * worse) just because the name happens to match.
   */
  match: (voice: Speech.Voice) => boolean;
}

/**
 * Voice match helpers. Apple's identifier convention is
 *   `com.apple.voice.{tier}.{lang}.{Name}`
 * so we can filter by tier substring even though `Speech.VoiceQuality`
 * only exposes Default/Enhanced (no Premium constant).
 */
function isPremiumVoice(v: Speech.Voice): boolean {
  return v.identifier.toLowerCase().includes("premium");
}
function nameOrIdMatches(v: Speech.Voice, name: string): boolean {
  return (
    v.name === name || v.identifier.toLowerCase().includes(name.toLowerCase())
  );
}

const IOS_PERSONAS: NamedPersona[] = [
  // ── Premium (neural Siri) voices — the warm defaults ───────────
  // Curated for a calming, "feels-like-a-real-person" delivery.
  // Order matters: this is the order they appear in Settings, with
  // the two recommended defaults at the top.
  {
    label: "Ava — Calm",
    subtitle: "American English · Premium female",
    tier: "premium",
    gender: "female",
    recommended: true,
    match: (v) => isPremiumVoice(v) && nameOrIdMatches(v, "Ava"),
  },
  {
    label: "Evan — Warm",
    subtitle: "American English · Premium male",
    tier: "premium",
    gender: "male",
    recommended: true,
    match: (v) => isPremiumVoice(v) && nameOrIdMatches(v, "Evan"),
  },
  {
    label: "Zoe — Soft",
    subtitle: "American English · Premium female",
    tier: "premium",
    gender: "female",
    match: (v) => isPremiumVoice(v) && nameOrIdMatches(v, "Zoe"),
  },
  {
    label: "Nathan — Deep",
    subtitle: "American English · Premium male",
    tier: "premium",
    gender: "male",
    match: (v) => isPremiumVoice(v) && nameOrIdMatches(v, "Nathan"),
  },
  {
    label: "Serena — Serene",
    subtitle: "British English · Premium female",
    tier: "premium",
    gender: "female",
    match: (v) => isPremiumVoice(v) && nameOrIdMatches(v, "Serena"),
  },
  {
    label: "Tom — Steady",
    subtitle: "American English · Premium male",
    tier: "premium",
    gender: "male",
    match: (v) => isPremiumVoice(v) && nameOrIdMatches(v, "Tom"),
  },
  {
    label: "Allison — Gentle",
    subtitle: "American English · Premium female",
    tier: "premium",
    gender: "female",
    match: (v) => isPremiumVoice(v) && nameOrIdMatches(v, "Allison"),
  },
  // ── Enhanced quality (no download required) ────────────────────
  // Universally available fallbacks so the picker isn't empty when
  // the user hasn't installed any Premium voices yet.
  {
    label: "Samantha — Warm",
    subtitle: "American English · Enhanced female",
    tier: "enhanced",
    gender: "female",
    match: (v) =>
      nameOrIdMatches(v, "Samantha") &&
      v.quality === Speech.VoiceQuality.Enhanced,
  },
  {
    label: "Daniel — Crisp",
    subtitle: "British English · Enhanced male",
    tier: "enhanced",
    gender: "male",
    match: (v) =>
      nameOrIdMatches(v, "Daniel") &&
      v.quality === Speech.VoiceQuality.Enhanced,
  },
  {
    label: "Karen — Bright",
    subtitle: "Australian English · Enhanced female",
    tier: "enhanced",
    gender: "female",
    match: (v) =>
      nameOrIdMatches(v, "Karen") &&
      v.quality === Speech.VoiceQuality.Enhanced,
  },
  {
    label: "Moira — Lilt",
    subtitle: "Irish English · Enhanced female",
    tier: "enhanced",
    gender: "female",
    match: (v) =>
      nameOrIdMatches(v, "Moira") &&
      v.quality === Speech.VoiceQuality.Enhanced,
  },
];

const LANGUAGE_LABELS: Record<string, string> = {
  "en-US": "American English",
  "en-GB": "British English",
  "en-AU": "Australian English",
  "en-IE": "Irish English",
  "en-IN": "Indian English",
  "en-ZA": "South African English",
  "en-CA": "Canadian English",
  "en-NZ": "New Zealand English",
};

const DEFAULT_VOICE: CuratedMemVoice = {
  id: null,
  label: "System default",
  subtitle: "Whichever voice your device prefers",
  tier: "system",
  gender: "neutral",
};

/** True if the voice's `language` is any flavour of English. */
function isEnglish(voice: Speech.Voice): boolean {
  return /^en[-_]?/i.test(voice.language ?? "");
}

/**
 * Generate a friendly label for an English voice when the curated
 * persona list didn't catch it. Android voice names are typically
 * identifier-shaped (`en-us-x-sfg-network`); fall back to a
 * `Voice 1`, `Voice 2`, … numbering so rows don't read like junk.
 */
function fallbackLabel(voice: Speech.Voice, index: number): string {
  const name = voice.name ?? "";
  if (/^[A-Z][a-zA-Z]+$/.test(name)) return name;
  return `Voice ${index + 1}`;
}

/**
 * Build the curated list of voices for the Settings picker. Always
 * resolves with at least one entry (the "System default" pseudo-voice).
 *
 * Read failures of `getAvailableVoicesAsync()` collapse to that
 * single-entry list rather than throwing — Settings still renders,
 * just without the alternative picks. This matches the rest of the
 * voice prefs layer's "best-effort, never strand the user" stance.
 */
export async function getCuratedMemVoices(): Promise<CuratedMemVoice[]> {
  const list: CuratedMemVoice[] = [DEFAULT_VOICE];

  let installed: Speech.Voice[] = [];
  try {
    installed = await Speech.getAvailableVoicesAsync();
  } catch {
    return list;
  }
  if (!installed || installed.length === 0) return list;

  if (Platform.OS === "ios") {
    const seenIds = new Set<string>();
    for (const persona of IOS_PERSONAS) {
      const matches = installed.filter(persona.match);
      if (matches.length === 0) continue;
      const best = matches[0]!;
      if (seenIds.has(best.identifier)) continue;
      seenIds.add(best.identifier);
      list.push({
        id: best.identifier,
        label: persona.label,
        subtitle: persona.subtitle,
        tier: persona.tier,
        gender: persona.gender,
        recommended: persona.recommended,
      });
    }
    if (list.length > 1) return list;
    // No personas matched (extremely thin voice install) — fall
    // through to the generic English-pick branch below so the user
    // still gets *some* alternative to the system default.
  }

  const englishVoices = installed.filter(isEnglish);
  const enhanced = englishVoices.filter(
    (v) => v.quality === Speech.VoiceQuality.Enhanced,
  );
  const candidates = (enhanced.length > 0 ? enhanced : englishVoices).slice(
    0,
    4,
  );
  for (let i = 0; i < candidates.length; i += 1) {
    const v = candidates[i]!;
    list.push({
      id: v.identifier,
      label: fallbackLabel(v, i),
      subtitle: LANGUAGE_LABELS[v.language] ?? v.language ?? "English",
      tier:
        v.quality === Speech.VoiceQuality.Enhanced ? "enhanced" : "system",
      gender: "neutral",
    });
  }
  return list;
}

/**
 * Pick the single best installed voice from the curated catalog to
 * use as the implicit default when the user hasn't made a choice yet.
 *
 * Ranking:
 *   1. The two `recommended` premium voices (Ava, Evan) if installed
 *   2. Any other premium voice from the catalog
 *   3. Any enhanced voice from the catalog
 *   4. `null` (= let the OS pick — its system default)
 *
 * Returning `null` is the safe last resort: `useMemSpeech` knows to
 * omit the `voice` key entirely when it's null, which makes
 * `expo-speech` use the device's chosen system voice.
 */
export function getRecommendedDefaultVoiceId(
  catalog: CuratedMemVoice[],
): string | null {
  const real = catalog.filter((v) => v.id !== null);
  const recommended = real.find((v) => v.recommended && v.tier === "premium");
  if (recommended) return recommended.id;
  const anyPremium = real.find((v) => v.tier === "premium");
  if (anyPremium) return anyPremium.id;
  const anyEnhanced = real.find((v) => v.tier === "enhanced");
  if (anyEnhanced) return anyEnhanced.id;
  return null;
}

/**
 * True when the persisted `voiceId` corresponds to a voice that's
 * actually installed on the current device. Used by Settings to
 * gracefully degrade the selection indicator: if the user picked
 * "Ava" on an iPhone and then signed in on an Android tablet that
 * doesn't have Ava, the row renders as "System default" selected
 * rather than orphaning the choice.
 */
export function isInstalledVoice(
  voiceId: string | null,
  catalog: CuratedMemVoice[],
): boolean {
  if (voiceId === null) return true;
  return catalog.some((v) => v.id === voiceId);
}

/**
 * Resolve a persisted voice id against the curated catalog on the
 * *current* device.
 *
 * Behaviour:
 *   - Saved id installed here → return it.
 *   - Saved id NOT installed here (cross-device case) → return `null`
 *     so Mem speaks with the system default until the user re-picks.
 *   - No saved id (`savedVoiceId === null`) AND a recommended
 *     premium voice IS installed → return that premium voice id, so
 *     a fresh-install user automatically hears the warm default
 *     (Ava / Evan) the very first time Mem speaks.
 *   - No saved id and no premium voice installed → return `null`
 *     (system default).
 *
 * The catalog is fetched once on mount (same hardware-static call
 * used by Settings' picker), so subsequent renders are cheap. Until
 * the catalog hydrates we deliberately return `null` rather than
 * picking a voice — a one-frame "system default voice" is preferable
 * to passing an unverified id to `Speech.speak`.
 */
export function useEffectiveMemVoiceId(
  savedVoiceId: string | null,
): string | null {
  const [catalog, setCatalog] = useState<CuratedMemVoice[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await getCuratedMemVoices();
        if (!cancelled) setCatalog(list);
      } catch {
        if (!cancelled) setCatalog([DEFAULT_VOICE]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  if (catalog === null) return null;
  if (savedVoiceId === null) {
    return getRecommendedDefaultVoiceId(catalog);
  }
  return isInstalledVoice(savedVoiceId, catalog) ? savedVoiceId : null;
}
