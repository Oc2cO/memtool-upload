// Persisted "Developer options" toggle (Task #317).
//
// Why this exists: the Settings → Cloud Sync card has an advanced
// "bring-your-own-backend" Cloud API URL field that no normal Pro
// user should ever touch. Round 1 of the pre-launch audit flagged
// the bare placeholder (`https://your-backend.example.com`) as
// leaking the BYO-server design out loud. Hiding the field outright
// would break the team's own development workflow, so the controls
// stay in place but are now gated on this persisted toggle.
//
// Defaults:
//   - Production builds: OFF — a fresh Pro user never sees the URL
//     field.
//   - `__DEV__` builds: ON — the team's day-to-day flow is unchanged.
//
// Storage shape mirrors `lib/haptics/preferences.ts`'s master switch
// (Task #252): a single AsyncStorage string ("true" / "false") with
// a sync cached read so the Settings UI doesn't have to await
// storage on every render. A previously-saved custom Cloud API URL
// is NOT touched here — toggling Developer options off then back on
// brings the saved URL back unchanged (the URL itself lives in
// `lib/api`'s own AsyncStorage key).
//
// Anything that isn't the literal string "true" / "false" rehydrates
// to the default for the current build (matches the master-switch
// pattern: a hand-edited blob can't accidentally flip a user into
// "Developer options on" in production).

import { useEffect, useState } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";

export const DEVELOPER_OPTIONS_ENABLED_KEY = "memtool:developerOptionsEnabled";

// `__DEV__` is a global injected by the React Native / Expo runtime
// (and by `jest-expo`'s preset). Reading it once at module load is
// fine — it doesn't change for the life of the process.
const DEFAULT_ENABLED: boolean = typeof __DEV__ !== "undefined" && __DEV__;

let enabled: boolean = DEFAULT_ENABLED;
let hydratePromise: Promise<boolean> | null = null;
const listeners = new Set<(next: boolean) => void>();

function notify(): void {
  for (const listener of listeners) {
    listener(enabled);
  }
}

/**
 * Sync read of the Developer options toggle. Defaults to the
 * build-time default (`__DEV__`) until hydration completes.
 */
export function isDeveloperOptionsEnabledCached(): boolean {
  return enabled;
}

/**
 * Hydrate the toggle from AsyncStorage. Idempotent — the first call
 * starts the read, every subsequent call returns the same promise.
 * Tests can re-arm via `__resetDeveloperOptionsForTests()`.
 *
 * Only the explicit strings "true" / "false" are honoured. Anything
 * else (missing key, malformed value, read failure) keeps the
 * build-time default so a production user can never end up with the
 * URL field visible without having flipped the switch themselves.
 */
export function ensureDeveloperOptionsHydrated(): Promise<boolean> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(DEVELOPER_OPTIONS_ENABLED_KEY);
        if (raw === "true") {
          enabled = true;
        } else if (raw === "false") {
          enabled = false;
        } else {
          enabled = DEFAULT_ENABLED;
        }
      } catch {
        enabled = DEFAULT_ENABLED;
      }
      notify();
      return enabled;
    })();
  }
  return hydratePromise;
}

/**
 * Persist the toggle. Updates the in-memory cache and notifies
 * subscribers BEFORE awaiting AsyncStorage so the Settings switch
 * never appears to lag behind the tap. A failing write is swallowed
 * — worst case the user re-toggles next launch.
 */
export async function setDeveloperOptionsEnabled(next: boolean): Promise<void> {
  enabled = next;
  notify();
  try {
    await AsyncStorage.setItem(
      DEVELOPER_OPTIONS_ENABLED_KEY,
      next ? "true" : "false",
    );
  } catch {
    // ignore — in-memory state still reflects the user's intent
  }
}

export function subscribeDeveloperOptionsEnabled(
  listener: (next: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React hook the Settings screen uses to render the Developer
 * options toggle and gate the Cloud API URL controls. Hydrates on
 * mount and subscribes to in-process updates so a re-mount stays in
 * sync without an extra storage read.
 */
export function useDeveloperOptionsEnabled(): {
  enabled: boolean;
  setEnabled: (next: boolean) => Promise<void>;
} {
  const [value, setValue] = useState<boolean>(() => enabled);

  useEffect(() => {
    let cancelled = false;
    void ensureDeveloperOptionsHydrated().then((hydrated) => {
      if (!cancelled) setValue(hydrated);
    });
    const unsub = subscribeDeveloperOptionsEnabled(setValue);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return {
    enabled: value,
    setEnabled: setDeveloperOptionsEnabled,
  };
}

/**
 * Test-only: drop the cached state, the in-flight hydration promise,
 * and any subscribers so each test starts from a clean slate.
 */
export function __resetDeveloperOptionsForTests(): void {
  enabled = DEFAULT_ENABLED;
  hydratePromise = null;
  listeners.clear();
}
