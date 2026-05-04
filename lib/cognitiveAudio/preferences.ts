// AsyncStorage-backed preferences for the cognitive sound layer
// (Task #341). Mirrors the shape of `lib/haptics/preferences.ts`
// — a tiny module-scope cache with sync read accessors so the
// audio service can decide whether to start a track without
// awaiting storage on every transition.
//
// Defaults:
//   - master enabled    → false (the layer is opt-in, per task)
//   - binaural enabled  → false (binaural is the loudest opt-in;
//                                we surface the ambient bed first)
//   - master volume     → 0.4   (low — sound is enhancement, not
//                                event audio)
//   - headphones hint   → not yet shown
//
// Cold-start tradeoff is the OPPOSITE of haptics: we default to
// OFF, so the worst-case cold-start race is "the user enabled
// audio yesterday but the first frame after launch doesn't play
// until hydration finishes" — strictly safer than fail-open audio
// in a quiet room.

import { useEffect, useState } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";

export const COGNITIVE_AUDIO_PREFS_KEY = "memtool:cognitiveAudioPrefs";

export type CognitiveAudioPrefs = {
  /** Master switch for the entire sound layer. Default false. */
  enabled: boolean;
  /** Whether the optional binaural sub-layer plays. Default false. */
  binauralEnabled: boolean;
  /**
   * Master volume independent of the device volume. 0..1, defaults
   * to 0.4 so the bed sits comfortably under foreground audio.
   */
  masterVolume: number;
  /**
   * Has the "headphones recommended" inline hint already been shown
   * once? Persists so we never re-nag the same user.
   */
  headphonesHintShown: boolean;
};

export const DEFAULT_COGNITIVE_AUDIO_PREFS: CognitiveAudioPrefs = {
  enabled: false,
  binauralEnabled: false,
  masterVolume: 0.4,
  headphonesHintShown: false,
};

let cache: CognitiveAudioPrefs = { ...DEFAULT_COGNITIVE_AUDIO_PREFS };
let hydratePromise: Promise<CognitiveAudioPrefs> | null = null;
const listeners = new Set<(prefs: CognitiveAudioPrefs) => void>();

function snapshot(): CognitiveAudioPrefs {
  return { ...cache };
}

function notify(): void {
  const next = snapshot();
  for (const listener of listeners) {
    listener(next);
  }
}

function clampVolume(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0.4;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function parseStored(raw: string | null): CognitiveAudioPrefs {
  if (!raw) return { ...DEFAULT_COGNITIVE_AUDIO_PREFS };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_COGNITIVE_AUDIO_PREFS };
    }
    const obj = parsed as Record<string, unknown>;
    return {
      enabled: obj.enabled === true,
      binauralEnabled: obj.binauralEnabled === true,
      masterVolume: clampVolume(obj.masterVolume),
      headphonesHintShown: obj.headphonesHintShown === true,
    };
  } catch {
    return { ...DEFAULT_COGNITIVE_AUDIO_PREFS };
  }
}

export function getCognitiveAudioPrefsCached(): CognitiveAudioPrefs {
  return cache;
}

export function isCognitiveAudioEnabledCached(): boolean {
  return cache.enabled;
}

export function isBinauralEnabledCached(): boolean {
  return cache.binauralEnabled;
}

export function getMasterVolumeCached(): number {
  return cache.masterVolume;
}

export function ensureCognitiveAudioPrefsHydrated(): Promise<CognitiveAudioPrefs> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(COGNITIVE_AUDIO_PREFS_KEY);
        cache = parseStored(raw);
      } catch {
        cache = { ...DEFAULT_COGNITIVE_AUDIO_PREFS };
      }
      notify();
      return snapshot();
    })();
  }
  return hydratePromise;
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(
      COGNITIVE_AUDIO_PREFS_KEY,
      JSON.stringify(cache),
    );
  } catch {
    // ignore — the in-memory cache still reflects the user's intent
  }
}

// Setters await hydration before mutating so a write that races
// the first storage read can't be silently overwritten when the
// read finally lands. The first call seeds `hydratePromise`; every
// setter after that just awaits the same idempotent promise. After
// a setter completes the cache is the user's intended value and
// any subsequent `ensureHydrated()` is a cheap no-op.

export async function setCognitiveAudioEnabled(enabled: boolean): Promise<void> {
  await ensureCognitiveAudioPrefsHydrated();
  cache = { ...cache, enabled };
  notify();
  await persist();
}

export async function setBinauralEnabled(enabled: boolean): Promise<void> {
  await ensureCognitiveAudioPrefsHydrated();
  cache = { ...cache, binauralEnabled: enabled };
  notify();
  await persist();
}

export async function setMasterVolume(volume: number): Promise<void> {
  await ensureCognitiveAudioPrefsHydrated();
  cache = { ...cache, masterVolume: clampVolume(volume) };
  notify();
  await persist();
}

export async function markHeadphonesHintShown(): Promise<void> {
  await ensureCognitiveAudioPrefsHydrated();
  if (cache.headphonesHintShown) return;
  cache = { ...cache, headphonesHintShown: true };
  notify();
  await persist();
}

export function subscribeCognitiveAudioPrefs(
  listener: (prefs: CognitiveAudioPrefs) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCognitiveAudioPrefs(): {
  prefs: CognitiveAudioPrefs;
  setEnabled: (enabled: boolean) => Promise<void>;
  setBinauralEnabled: (enabled: boolean) => Promise<void>;
  setMasterVolume: (v: number) => Promise<void>;
  markHeadphonesHintShown: () => Promise<void>;
} {
  const [prefs, setPrefs] = useState<CognitiveAudioPrefs>(() => snapshot());

  useEffect(() => {
    let cancelled = false;
    void ensureCognitiveAudioPrefsHydrated().then((hydrated) => {
      if (!cancelled) setPrefs(hydrated);
    });
    const unsub = subscribeCognitiveAudioPrefs(setPrefs);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return {
    prefs,
    setEnabled: setCognitiveAudioEnabled,
    setBinauralEnabled,
    setMasterVolume,
    markHeadphonesHintShown,
  };
}

/** Test-only: drop the cache and any subscribers. */
export function __resetCognitiveAudioPrefsForTests(): void {
  cache = { ...DEFAULT_COGNITIVE_AUDIO_PREFS };
  hydratePromise = null;
  listeners.clear();
}
