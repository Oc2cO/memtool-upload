import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Per-user persistence for the AI Guide "Mem voice" preferences:
 *   - the mute toggle (Task #283 step 6) — persisted under
 *     `mem_voice_muted:<userId>`, defaults to *unmuted* on first
 *     install (per task brief).
 *   - the one-shot intro greeting flag (Task #283 step 7) —
 *     persisted under `mem_voice_intro_spoken:<userId>` so that
 *     re-mounts of the screen never re-speak the intro.
 *
 * Mirrors the cached-read shape used by `lib/haptics/preferences.ts`:
 * the playback layer needs a synchronous gate (`isMutedSync`) so a
 * re-render mid-speech doesn't wait on AsyncStorage. The cache is
 * keyed by user id; switching accounts re-hydrates with the new
 * user's flag.
 *
 * Failing reads collapse to "not muted" / "intro not yet spoken" —
 * the safer default is to give the user the experience once and
 * let them mute it, rather than silently swallow the very first
 * voice they were supposed to hear.
 */

export const MUTE_KEY_PREFIX = "mem_voice_muted:";
export const INTRO_SPOKEN_KEY_PREFIX = "mem_voice_intro_spoken:";
export const SKIP_HINT_SEEN_KEY_PREFIX = "mem_voice_skip_hint_seen:";
// Per-user "show a caption strip mirroring Mem's spoken word" flag
// (Task #293). Default OFF — captions are an accessibility opt-in
// for users who keep their phone on silent (so they don't hear Mem)
// and for users with Reduce Motion on (where the mouth is frozen).
// Persisted under `mem_voice_captions:<userId>`.
export const CAPTIONS_KEY_PREFIX = "mem_voice_captions:";
/**
 * Per-user persisted voice identifier (Task #292). Value is whatever
 * `Speech.getAvailableVoicesAsync()` returned for the user's pick;
 * an empty / missing value means "use the system default".
 */
export const VOICE_ID_KEY_PREFIX = "mem_voice_id:";

let mutedCache: { userId: string | null; muted: boolean } = {
  userId: null,
  muted: false,
};
let muteHydratePromise: Promise<boolean> | null = null;
let muteHydratedFor: string | null = null;
const muteListeners = new Set<(muted: boolean) => void>();

let captionsCache: { userId: string | null; enabled: boolean } = {
  userId: null,
  enabled: false,
};
let captionsHydratePromise: Promise<boolean> | null = null;
let captionsHydratedFor: string | null = null;
const captionsListeners = new Set<(enabled: boolean) => void>();

function muteKey(userId: string): string {
  return `${MUTE_KEY_PREFIX}${userId}`;
}

function introKey(userId: string): string {
  return `${INTRO_SPOKEN_KEY_PREFIX}${userId}`;
}

function skipHintKey(userId: string): string {
  return `${SKIP_HINT_SEEN_KEY_PREFIX}${userId}`;
}

function captionsKey(userId: string): string {
  return `${CAPTIONS_KEY_PREFIX}${userId}`;
}

function voiceIdKey(userId: string): string {
  return `${VOICE_ID_KEY_PREFIX}${userId}`;
}

let voiceIdCache: { userId: string | null; voiceId: string | null } = {
  userId: null,
  voiceId: null,
};
let voiceHydratePromise: Promise<string | null> | null = null;
let voiceHydratedFor: string | null = null;
const voiceIdListeners = new Set<(voiceId: string | null) => void>();


/**
 * Synchronous read of the cached mute flag. Returns `false` (audio
 * on) until the first hydrate completes, matching the brief: a
 * fresh install hears Mem speak the intro the first time the
 * screen opens, not after a hydration round-trip.
 */
export function isMemVoiceMutedSync(userId: string): boolean {
  if (!userId) return false;
  if (mutedCache.userId === userId) return mutedCache.muted;
  return false;
}

/**
 * Hydrate (and cache) the mute flag for the given user. Idempotent
 * for the same user; switching to a different user re-hydrates
 * from disk. Read failures default to "not muted".
 */
export async function ensureMemVoiceMuteHydrated(
  userId: string,
): Promise<boolean> {
  if (!userId) return false;
  if (muteHydratedFor === userId && muteHydratePromise) {
    return muteHydratePromise;
  }
  muteHydratedFor = userId;
  muteHydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(muteKey(userId));
      const muted = raw === "1";
      mutedCache = { userId, muted };
      for (const cb of muteListeners) cb(muted);
      return muted;
    } catch {
      mutedCache = { userId, muted: false };
      for (const cb of muteListeners) cb(false);
      return false;
    }
  })();
  return muteHydratePromise;
}

/**
 * Eagerly toggle the cached flag, notify subscribers, then write
 * to disk. The order matters — a slow / failing write must not
 * undo the user's tap in the UI.
 */
export async function setMemVoiceMuted(
  userId: string,
  muted: boolean,
): Promise<void> {
  if (!userId) return;
  mutedCache = { userId, muted };
  for (const cb of muteListeners) cb(muted);
  try {
    await AsyncStorage.setItem(muteKey(userId), muted ? "1" : "0");
  } catch {
    // best-effort
  }
}

/**
 * React hook returning the live mute flag for `userId`, hydrating
 * on first mount. Re-renders when `setMemVoiceMuted` is called
 * elsewhere in the tree.
 */
export function useMemVoiceMuted(userId: string | null | undefined): boolean {
  const safeId = userId ?? "";
  const [muted, setMuted] = useState<boolean>(() =>
    safeId ? isMemVoiceMutedSync(safeId) : false,
  );
  useEffect(() => {
    if (!safeId) {
      setMuted(false);
      return;
    }
    let cancelled = false;
    void ensureMemVoiceMuteHydrated(safeId).then((m) => {
      if (!cancelled) setMuted(m);
    });
    const cb = (m: boolean) => {
      if (mutedCache.userId === safeId) setMuted(m);
    };
    muteListeners.add(cb);
    return () => {
      cancelled = true;
      muteListeners.delete(cb);
    };
  }, [safeId]);
  return muted;
}

/** Best-effort read of the "intro spoken" one-shot flag. */
export async function hasMemIntroBeenSpoken(userId: string): Promise<boolean> {
  if (!userId) return true;
  try {
    const raw = await AsyncStorage.getItem(introKey(userId));
    return raw === "1";
  } catch {
    // If we can't read, assume already spoken so we don't re-speak
    // on every cold start of a broken-storage device.
    return true;
  }
}

/** Mark the intro as spoken so subsequent screen mounts skip it. */
export async function markMemIntroSpoken(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(introKey(userId), "1");
  } catch {
    // best-effort
  }
}

/**
 * Best-effort read of the "tap-to-skip hint already seen" one-shot
 * flag. The hint must appear *exactly once per user across the
 * lifetime of the install* — it is, by design, training. After the
 * user has seen it once we never show it again, even after app
 * relaunch.
 *
 * Read failures default to "already seen" so a broken-storage
 * device doesn't keep nagging the user every cold start.
 */
export async function hasMemSkipHintBeenSeen(
  userId: string,
): Promise<boolean> {
  if (!userId) return true;
  try {
    const raw = await AsyncStorage.getItem(skipHintKey(userId));
    return raw === "1";
  } catch {
    return true;
  }
}

/** Mark the skip hint as seen so subsequent talking replies skip it. */
export async function markMemSkipHintSeen(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(skipHintKey(userId), "1");
  } catch {
    // best-effort
  }
}

/**
 * Synchronous read of the cached "Mem captions" flag. Returns
 * `false` (captions off) until the first hydrate completes — the
 * brief specifies the toggle defaults to off, and showing a caption
 * strip on first paint that then disappears once hydration lands
 * would be more disruptive than the brief moment of "no captions
 * yet" while AsyncStorage is read.
 */
export function isMemCaptionsEnabledSync(userId: string): boolean {
  if (!userId) return false;
  if (captionsCache.userId === userId) return captionsCache.enabled;
  return false;
}

/**
 * Hydrate (and cache) the captions-enabled flag for the given user.
 * Idempotent for the same user; switching users re-hydrates from
 * disk. Read failures default to "off" — captions are an opt-in
 * affordance, never something we want to silently turn ON because
 * AsyncStorage choked.
 */
export async function ensureMemCaptionsEnabledHydrated(
  userId: string,
): Promise<boolean> {
  if (!userId) return false;
  if (captionsHydratedFor === userId && captionsHydratePromise) {
    return captionsHydratePromise;
  }
  captionsHydratedFor = userId;
  captionsHydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(captionsKey(userId));
      const enabled = raw === "1";
      captionsCache = { userId, enabled };
      for (const cb of captionsListeners) cb(enabled);
      return enabled;
    } catch {
      captionsCache = { userId, enabled: false };
      for (const cb of captionsListeners) cb(false);
      return false;
    }
  })();
  return captionsHydratePromise;
}

/**
 * Eagerly toggle the cached captions flag, notify subscribers, then
 * write to disk. Mirrors the mute-toggle ordering so a slow / failing
 * write never undoes the user's tap in the UI.
 */
export async function setMemCaptionsEnabled(
  userId: string,
  enabled: boolean,
): Promise<void> {
  if (!userId) return;
  captionsCache = { userId, enabled };
  for (const cb of captionsListeners) cb(enabled);
  try {
    await AsyncStorage.setItem(captionsKey(userId), enabled ? "1" : "0");
  } catch {
    // best-effort
  }
}

/**
 * Synchronous read of the cached selected voice id. Returns `null`
 * (= use system default) until the first hydrate completes for this
 * user. The async path below populates the cache on mount so a
 * subsequent re-render gets the saved value without a round-trip.
 */
export function getMemVoiceIdSync(userId: string): string | null {
  if (!userId) return null;
  if (voiceIdCache.userId === userId) return voiceIdCache.voiceId;
  return null;
}

/**
 * Hydrate (and cache) the selected voice id for the given user.
 * Idempotent for the same user; switching users re-hydrates from
 * disk. Read failures collapse to "system default" so a corrupt
 * value doesn't strand Mem in silence.
 */
export async function ensureMemVoiceIdHydrated(
  userId: string,
): Promise<string | null> {
  if (!userId) return null;
  if (voiceHydratedFor === userId && voiceHydratePromise) {
    return voiceHydratePromise;
  }
  voiceHydratedFor = userId;
  voiceHydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(voiceIdKey(userId));
      const value = raw && raw.length > 0 ? raw : null;
      voiceIdCache = { userId, voiceId: value };
      for (const cb of voiceIdListeners) cb(value);
      return value;
    } catch {
      voiceIdCache = { userId, voiceId: null };
      for (const cb of voiceIdListeners) cb(null);
      return null;
    }
  })();
  return voiceHydratePromise;
}

/**
 * Eagerly update the cached voice id, notify subscribers, then write
 * to disk. Mirror of `setMemVoiceMuted`'s ordering: a slow / failing
 * write must not undo the user's tap in the UI.
 *
 * Pass `null` (or empty string) to clear the override and go back to
 * the system default voice — handy for the "Default" row in Settings.
 */
export async function setMemVoiceId(
  userId: string,
  voiceId: string | null,
): Promise<void> {
  if (!userId) return;
  const normalized = voiceId && voiceId.length > 0 ? voiceId : null;
  voiceIdCache = { userId, voiceId: normalized };
  for (const cb of voiceIdListeners) cb(normalized);
  try {
    if (normalized === null) {
      await AsyncStorage.removeItem(voiceIdKey(userId));
    } else {
      await AsyncStorage.setItem(voiceIdKey(userId), normalized);
    }
  } catch {
    // best-effort — the cache update + listener notify above is what
    // the UI actually renders off, so a failed disk write only
    // affects the next cold start (which will refresh from whatever
    // AsyncStorage actually holds).
  }
}

/**
 * React hook returning the live captions-enabled flag for `userId`,
 * hydrating on first mount. Re-renders when `setMemCaptionsEnabled`
 * is called elsewhere in the tree (e.g. the Settings toggle while
 * the AI Guide screen is also mounted in another tab).
 */
export function useMemCaptionsEnabled(
  userId: string | null | undefined,
): boolean {
  const safeId = userId ?? "";
  const [enabled, setEnabled] = useState<boolean>(() =>
    safeId ? isMemCaptionsEnabledSync(safeId) : false,
  );
  useEffect(() => {
    if (!safeId) {
      setEnabled(false);
      return;
    }
    let cancelled = false;
    void ensureMemCaptionsEnabledHydrated(safeId).then((m) => {
      if (!cancelled) setEnabled(m);
    });
    const cb = (m: boolean) => {
      if (captionsCache.userId === safeId) setEnabled(m);
    };
    captionsListeners.add(cb);
    return () => {
      cancelled = true;
      captionsListeners.delete(cb);
    };
  }, [safeId]);
  return enabled;
}

/**
 * React hook returning the live selected voice id for `userId`,
 * hydrating on first mount. Re-renders when `setMemVoiceId` is
 * called elsewhere in the tree. `null` means "use the system
 * default voice".
 */
export function useMemVoiceId(
  userId: string | null | undefined,
): string | null {
  const safeId = userId ?? "";
  const [voiceId, setVoiceId] = useState<string | null>(() =>
    safeId ? getMemVoiceIdSync(safeId) : null,
  );
  useEffect(() => {
    if (!safeId) {
      setVoiceId(null);
      return;
    }
    let cancelled = false;
    void ensureMemVoiceIdHydrated(safeId).then((v) => {
      if (!cancelled) setVoiceId(v);
    });
    const cb = (v: string | null) => {
      if (voiceIdCache.userId === safeId) setVoiceId(v);
    };
    voiceIdListeners.add(cb);
    return () => {
      cancelled = true;
      voiceIdListeners.delete(cb);
    };
  }, [safeId]);
  return voiceId;
}

/** Test helper — wipe module-level caches between tests. */
export function _resetMemVoicePrefsForTests(): void {
  mutedCache = { userId: null, muted: false };
  muteHydratePromise = null;
  muteHydratedFor = null;
  muteListeners.clear();
  captionsCache = { userId: null, enabled: false };
  captionsHydratePromise = null;
  captionsHydratedFor = null;
  captionsListeners.clear();
  voiceIdCache = { userId: null, voiceId: null };
  voiceHydratePromise = null;
  voiceHydratedFor = null;
  voiceIdListeners.clear();
}
