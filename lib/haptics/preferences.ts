// Per-signature mute preferences for MemTool's six haptic
// signatures (Task #243), plus the global haptics master switch
// (Task #252). Mirrors `lib/coreHapticsHint.ts` in shape — a small
// AsyncStorage-backed module with sync read accessors so the
// playback layer can decide whether to skip a pattern without
// awaiting storage on every call.
//
// Why a sync cached read instead of `await AsyncStorage.getItem` in
// `play()`? The hook surface is `play(name): void` and is called
// from button presses, success paths, error paths — turning every
// one of those into an async hop just to consult a mute flag would
// either change the contract of every existing call site or force
// us to fire-and-forget the lookup (race conditions). The compromise
// is: hold the map in module-scope memory, hydrate it once from
// storage on the first `useHaptics()` mount, and let the React hook
// (`useHapticMutePrefs`) subscribe to changes for re-renders.
//
// State machine:
//   - `cache` defaults to {} (no signature muted).
//   - `ensureHydrated()` is idempotent and resolves with the current
//     map. The first call kicks off the AsyncStorage read; later
//     calls return the same in-flight / completed promise.
//   - `setHapticMuted(name, muted)` updates the cache eagerly,
//     notifies subscribers, then writes to AsyncStorage. The order
//     matters: a slow / failing write must not undo the user's tap
//     in the UI.
//   - A failing read is treated as "nothing muted" — the safer
//     default for a first-run experience is "you can hear all the
//     signatures", not "we silently ate them".
//
// Master switch (Task #252): the global "Haptics" toggle on the
// Settings screen lives in this same module so the playback gate
// stays a single sync check. It composes with the per-signature
// mutes — `play()` skips a pattern when EITHER the master is off
// OR that signature has been individually muted. Same cold-start
// tradeoff as the per-signature cache: the default before
// hydration is "on", because silently swallowing every haptic on
// launch would be worse than re-buzzing once.

import { useEffect, useState } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";

import { HAPTIC_NAMES } from "./patterns";
import type { HapticName } from "./types";

export const HAPTIC_MUTE_PREFS_KEY = "memtool:hapticMutePrefs";

export type HapticMutePrefs = Partial<Record<HapticName, boolean>>;

const VALID_NAMES: ReadonlySet<HapticName> = new Set(HAPTIC_NAMES);

let cache: HapticMutePrefs = {};
let hydratePromise: Promise<HapticMutePrefs> | null = null;
const listeners = new Set<(prefs: HapticMutePrefs) => void>();

function snapshot(): HapticMutePrefs {
  return { ...cache };
}

function notify(): void {
  const next = snapshot();
  for (const listener of listeners) {
    listener(next);
  }
}

function parseStored(raw: string | null): HapticMutePrefs {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const next: HapticMutePrefs = {};
    for (const [key, value] of Object.entries(parsed)) {
      // Defensive: AsyncStorage is shared across app versions, so a
      // future-renamed signature or a hand-edited blob shouldn't be
      // able to drop a stray key into the cache and confuse the
      // playback gate.
      if (VALID_NAMES.has(key as HapticName) && typeof value === "boolean") {
        next[key as HapticName] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
}

/**
 * Returns the current in-memory mute map. Always synchronous; safe
 * to call from the playback layer. Before `ensureHydrated()` resolves
 * the first time this returns `{}` (default unmuted), which matches
 * the pre-Task-#243 behaviour for the brief window between app
 * launch and the first AsyncStorage read.
 *
 * Cold-start race (closed by Task #272): without bootstrap-time
 * hydration, a `play()` that fires in the very first tick after
 * launch — i.e. before `useHaptics()` has had a chance to mount and
 * trigger hydration — could produce a buzz the user previously
 * muted. The race is now closed by `bootstrapHapticPreferences()`,
 * which `app/_layout.tsx` calls at module load (before any component
 * mounts), so by the time the first screen renders this cache
 * already reflects the user's saved preferences. Until that promise
 * resolves the cache stays at `{}` (default unmuted) — the
 * fail-open default mirrors the per-signature behaviour and matches
 * the alternative cost: a fire-and-forget await on every `play()`
 * would either change the call-site contract everywhere or
 * introduce worse races.
 */
export function getHapticMutePrefsCached(): HapticMutePrefs {
  return cache;
}

/**
 * Sync predicate the playback layer (`useHaptics().play`) calls to
 * decide whether to skip a pattern. Reads the live cache directly so
 * it always reflects the most recent `setHapticMuted` call, even
 * before AsyncStorage has acknowledged the write.
 */
export function isHapticMutedCached(name: HapticName): boolean {
  return cache[name] === true;
}

/**
 * Hydrate the in-memory cache from AsyncStorage. Idempotent: the
 * first call starts the read, every subsequent call returns the same
 * promise. Tests can re-arm via `__resetHapticMutePrefsForTests()`.
 */
export function ensureHapticMutePrefsHydrated(): Promise<HapticMutePrefs> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(HAPTIC_MUTE_PREFS_KEY);
        cache = parseStored(raw);
      } catch {
        // Best-effort: leave cache as {} so all signatures play.
        cache = {};
      }
      notify();
      return snapshot();
    })();
  }
  return hydratePromise;
}

/**
 * App bootstrap entry point (Task #272). Kicks off BOTH the
 * per-signature mute hydration and the master-switch hydration at
 * the same time, returning a single promise that resolves once both
 * AsyncStorage reads complete.
 *
 * Why this exists: the cold-start tradeoff documented above —
 * "before hydration, default is on" — is fine when `useHaptics()`
 * mounts at the root navigator, because hydration is in flight long
 * before any tab-level button can fire. But a screen that triggers a
 * haptic on its very first frame (`onMount`, a navigation animation,
 * etc.) could still buzz a signature the user previously muted (or
 * fire while the master switch is off) for the few-frame window
 * between launch and `useHaptics()` mounting.
 *
 * Calling this from `app/_layout.tsx` at module load — i.e. before
 * any React component mounts — closes that race: AsyncStorage starts
 * answering during the splash/font-load gate, so by the time the
 * first screen mounts the cache already reflects the user's saved
 * preferences.
 *
 * Returns the combined promise so callers (tests, future
 * splash-gated code) can `await` it. The production caller in
 * `_layout.tsx` fires-and-forgets because both `ensure…Hydrated`
 * helpers are idempotent and fail-safe.
 */
let bootstrapPromise: Promise<void> | null = null;
let bootstrapResolved = false;
const bootstrapListeners = new Set<() => void>();

function notifyBootstrap(): void {
  for (const listener of bootstrapListeners) {
    listener();
  }
}

export function bootstrapHapticPreferences(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = Promise.all([
      ensureHapticMutePrefsHydrated(),
      ensureHapticsMasterEnabledHydrated(),
    ]).then(() => {
      bootstrapResolved = true;
      notifyBootstrap();
    });
  }
  return bootstrapPromise;
}

/**
 * Sync read of whether `bootstrapHapticPreferences()` has resolved.
 * `app/_layout.tsx` uses the `useHapticPreferencesReady()` hook
 * (which subscribes to changes) to gate UI mount; this raw getter
 * exists for tests and any rare caller that needs a one-shot probe.
 */
export function isHapticPreferencesReady(): boolean {
  return bootstrapResolved;
}

/**
 * React hook the root layout uses to hard-gate the first screen
 * mount on bootstrap completion (Task #272). Returns `false` until
 * `bootstrapHapticPreferences()` resolves, then `true` for the rest
 * of the session.
 *
 * The layout calls `bootstrapHapticPreferences()` at module load, so
 * the AsyncStorage reads start during the splash/font-load gate
 * (parallel with font loading) — this hook is the gate that makes
 * sure the first render only happens AFTER both reads finish, even
 * if AsyncStorage is unusually slow. Without the gate the cache
 * defaults to "unmuted / master-on" and a screen that fires a
 * haptic on its very first frame can leak a buzz the user disabled.
 */
export function useHapticPreferencesReady(): boolean {
  const [ready, setReady] = useState<boolean>(bootstrapResolved);

  useEffect(() => {
    if (bootstrapResolved) {
      // Subsequent mounts (e.g. after a fast refresh) hit this path
      // — no need to re-await the same idempotent promise.
      if (!ready) setReady(true);
      return;
    }
    let cancelled = false;
    const onResolved = () => {
      if (!cancelled) setReady(true);
    };
    bootstrapListeners.add(onResolved);
    // Kick off bootstrap if the layout hasn't already (defensive —
    // the production path calls it at module load, but a screen
    // that mounts this hook in isolation should still hydrate).
    void bootstrapHapticPreferences();
    return () => {
      cancelled = true;
      bootstrapListeners.delete(onResolved);
    };
    // `ready` intentionally excluded — once true we stay true and
    // never re-subscribe. Including it would re-run the effect on
    // the very transition we just observed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ready;
}

/**
 * Persist a single signature's mute state. Updates the in-memory
 * cache and notifies subscribers BEFORE awaiting AsyncStorage so the
 * Settings toggle never appears to lag behind the tap. A failing
 * write is swallowed — worst case the user re-toggles next launch.
 */
export async function setHapticMuted(
  name: HapticName,
  muted: boolean,
): Promise<void> {
  if (!VALID_NAMES.has(name)) return;
  const next: HapticMutePrefs = { ...cache };
  if (muted) {
    next[name] = true;
  } else {
    delete next[name];
  }
  cache = next;
  notify();
  try {
    await AsyncStorage.setItem(HAPTIC_MUTE_PREFS_KEY, JSON.stringify(cache));
  } catch {
    // ignore — in-memory state still reflects the user's intent
  }
}

export function subscribeHapticMutePrefs(
  listener: (prefs: HapticMutePrefs) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React hook for screens that need to render mute state and react to
 * changes (currently just the "Try a haptic" card on Settings).
 * Hydrates on mount and subscribes to in-process updates so two
 * Settings instances — or a settings re-mount after a tab switch —
 * stay in lock-step without an extra storage read.
 */
export function useHapticMutePrefs(): {
  prefs: HapticMutePrefs;
  isMuted: (name: HapticName) => boolean;
  setMuted: (name: HapticName, muted: boolean) => Promise<void>;
} {
  const [prefs, setPrefs] = useState<HapticMutePrefs>(() => snapshot());

  useEffect(() => {
    let cancelled = false;
    void ensureHapticMutePrefsHydrated().then((hydrated) => {
      if (!cancelled) setPrefs(hydrated);
    });
    const unsub = subscribeHapticMutePrefs(setPrefs);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return {
    prefs,
    isMuted: (name) => prefs[name] === true,
    setMuted: setHapticMuted,
  };
}

/**
 * Test-only: drop the cached state, the in-flight hydration promise,
 * and any subscribers so each test starts from a clean slate. Not
 * exported from `index.ts`.
 */
export function __resetHapticMutePrefsForTests(): void {
  cache = {};
  hydratePromise = null;
  listeners.clear();
  masterEnabled = true;
  masterHydratePromise = null;
  masterListeners.clear();
  bootstrapPromise = null;
  bootstrapResolved = false;
  bootstrapListeners.clear();
}

// ---------------------------------------------------------------
// Global "Haptics" master switch (Task #252)
// ---------------------------------------------------------------
//
// Before Task #252 the Settings screen had a single "Sound Effects"
// switch (`useSettings().soundEnabled`) whose label promised it
// gated audio + haptic feedback, but it only actually muted audio.
// Splitting it into two independent master switches lets users
// silence haptics app-wide without silencing game audio (and vice
// versa), and composes cleanly with the per-signature mutes above:
// `play()` skips a pattern when EITHER the master is off OR the
// signature has been individually muted.
//
// The master state lives next to the per-signature cache (instead
// of in `SettingsContext`) so the playback layer stays a single
// sync check — pulling React context into `useHaptic.play()` would
// either change its sync contract or force every call site through
// the React tree.

export const HAPTICS_MASTER_ENABLED_KEY = "memtool:hapticsMasterEnabled";

let masterEnabled = true;
let masterHydratePromise: Promise<boolean> | null = null;
const masterListeners = new Set<(enabled: boolean) => void>();

function notifyMaster(): void {
  for (const listener of masterListeners) {
    listener(masterEnabled);
  }
}

/**
 * Sync read of the master "Haptics" switch. Defaults to `true`
 * (haptics on) until hydration completes, matching the per-signature
 * mute cache's default. Same cold-start tradeoff: a `play()` in the
 * very first tick after launch may fire even if the user previously
 * disabled haptics, but the alternative — silently swallowing every
 * haptic until storage answers — is strictly worse.
 */
export function isHapticsMasterEnabledCached(): boolean {
  return masterEnabled;
}

/**
 * Hydrate the master switch from AsyncStorage. Idempotent in the
 * same way `ensureHapticMutePrefsHydrated` is. Anything that isn't
 * the literal string "false" rehydrates as enabled — that includes
 * a missing key (first launch), a read failure, and any malformed
 * value. The fail-open default mirrors the per-signature cache.
 */
export function ensureHapticsMasterEnabledHydrated(): Promise<boolean> {
  if (!masterHydratePromise) {
    masterHydratePromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(HAPTICS_MASTER_ENABLED_KEY);
        // Only treat the explicit "false" string as off; everything
        // else (missing key, malformed value) keeps haptics on so a
        // first-time user never has to discover they're silently
        // disabled.
        masterEnabled = raw === "false" ? false : true;
      } catch {
        masterEnabled = true;
      }
      notifyMaster();
      return masterEnabled;
    })();
  }
  return masterHydratePromise;
}

/**
 * Persist the master switch. Updates the in-memory cache and
 * notifies subscribers BEFORE awaiting AsyncStorage so the toggle
 * never appears to lag behind the tap. A failing write is swallowed
 * — worst case the user re-toggles on next launch.
 */
export async function setHapticsMasterEnabled(enabled: boolean): Promise<void> {
  masterEnabled = enabled;
  notifyMaster();
  try {
    await AsyncStorage.setItem(
      HAPTICS_MASTER_ENABLED_KEY,
      enabled ? "true" : "false",
    );
  } catch {
    // ignore — in-memory state still reflects the user's intent
  }
}

export function subscribeHapticsMasterEnabled(
  listener: (enabled: boolean) => void,
): () => void {
  masterListeners.add(listener);
  return () => {
    masterListeners.delete(listener);
  };
}

/**
 * React hook the Settings screen uses to render the "Haptics"
 * master switch. Hydrates on mount and subscribes to in-process
 * updates so a Settings re-mount stays in sync without an extra
 * storage read.
 */
export function useHapticsMasterEnabled(): {
  enabled: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
} {
  const [enabled, setEnabledState] = useState<boolean>(() => masterEnabled);

  useEffect(() => {
    let cancelled = false;
    void ensureHapticsMasterEnabledHydrated().then((hydrated) => {
      if (!cancelled) setEnabledState(hydrated);
    });
    const unsub = subscribeHapticsMasterEnabled(setEnabledState);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return {
    enabled,
    setEnabled: setHapticsMasterEnabled,
  };
}
