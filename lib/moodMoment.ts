// Helpers shared by the wellness post-save trigger and the recap
// surface for Mem's mood-reactive moment (Task #336).
//
// The threshold lives here, not inline at the call sites, so the
// wellness slider, the recap detection, and any future surface
// that wants to react to "today's mood was low" all key off one
// constant. The per-day "shown / opted-out" key is also derived
// from a helper so the wellness trigger and the recap surface
// agree on what "today" means.

import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { UserProfile, UserProfileEmpty } from "@workspace/api-client-react";

/** AsyncStorage key for the user-facing "let Mem check in when I'm
 *  having a tough day" toggle (Task #346). Global (not per-user) so
 *  flipping it off silences the MemMomentCard everywhere — wellness
 *  post-save AND the recap surface — without having to plumb a
 *  user id through every call site. Stored as "1" / "0"; missing
 *  value defaults to enabled so existing installs keep the
 *  Task #336 behaviour until the user opts out. */
export const MEM_MOMENT_ENABLED_KEY = "mem_moment_enabled_v1";

let enabledCache: boolean = true;
let enabledHydrated = false;
let enabledHydratePromise: Promise<boolean> | null = null;
const enabledListeners = new Set<(enabled: boolean) => void>();

/** Synchronous read of the cached toggle. Returns `true` until the
 *  first hydrate completes — the safer default is to keep the
 *  Task #336 behaviour visible to existing users; opt-out only
 *  takes effect once the persisted value has loaded. */
export function isMemMomentEnabledSync(): boolean {
  return enabledCache;
}

export async function ensureMemMomentEnabledHydrated(): Promise<boolean> {
  if (enabledHydrated && enabledHydratePromise) return enabledHydratePromise;
  enabledHydrated = true;
  enabledHydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(MEM_MOMENT_ENABLED_KEY);
      const enabled = raw === null ? true : raw === "1";
      enabledCache = enabled;
      for (const cb of enabledListeners) cb(enabled);
      return enabled;
    } catch {
      enabledCache = true;
      for (const cb of enabledListeners) cb(true);
      return true;
    }
  })();
  return enabledHydratePromise;
}

/** Eagerly flip the cached flag, notify subscribers, then write to
 *  disk. Mirrors the mute-toggle ordering in `memVoicePrefs` so a
 *  slow / failing write never undoes the user's tap. */
export async function setMemMomentEnabled(enabled: boolean): Promise<void> {
  enabledCache = enabled;
  enabledHydrated = true;
  enabledHydratePromise = Promise.resolve(enabled);
  for (const cb of enabledListeners) cb(enabled);
  try {
    await AsyncStorage.setItem(MEM_MOMENT_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // best-effort
  }
}

/** React hook returning the live enabled flag, hydrating on first
 *  mount. Re-renders when `setMemMomentEnabled` is called elsewhere
 *  in the tree. */
export function useMemMomentEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() =>
    isMemMomentEnabledSync(),
  );
  useEffect(() => {
    let cancelled = false;
    void ensureMemMomentEnabledHydrated().then((v) => {
      if (!cancelled) setEnabled(v);
    });
    const cb = (v: boolean) => setEnabled(v);
    enabledListeners.add(cb);
    return () => {
      cancelled = true;
      enabledListeners.delete(cb);
    };
  }, []);
  return enabled;
}

/** Stress / mood values at or below this count as "low mood". The
 *  underlying slider is 1–5 ("Low" → "High"). 3 is the midpoint
 *  the task spec calls out. Higher = more stressed. */
export const LOW_MOOD_THRESHOLD = 3;

/** Per-day AsyncStorage key for "we already showed (or the user
 *  dismissed) the MemMomentCard today". Calendar-day keyed so the
 *  next morning gets a fresh chance — this is a "don't badger"
 *  guard, not a permanent suppression. */
export function memMomentDayKey(email: string, day: string): string {
  return `mem_moment_v1_${email}_${day}`;
}

export function todayLocalDayString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function hasShownMemMomentToday(
  email: string,
  day: string = todayLocalDayString(),
): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(memMomentDayKey(email, day));
    return v != null;
  } catch {
    return false;
  }
}

export async function markMemMomentShownToday(
  email: string,
  day: string = todayLocalDayString(),
): Promise<void> {
  try {
    await AsyncStorage.setItem(memMomentDayKey(email, day), "1");
  } catch {
    // best-effort
  }
}

export type MemMomentAction = "breathe" | "recall" | "sit";

interface ProfileSignals {
  movement: boolean;
  reflection: boolean;
}

function readProfileSignals(
  profile: UserProfile | UserProfileEmpty | null,
): ProfileSignals {
  if (!profile || profile.created !== true) {
    return { movement: false, reflection: false };
  }
  const traits = (profile.traits ?? []).map((t) => String(t).toLowerCase());
  const focus = (profile.focus_areas ?? []).map((f) => String(f).toLowerCase());
  const haystack = [...traits, ...focus].join(" ");
  return {
    movement:
      /\b(move|movement|exercis|workout|run|walk|yoga|energy|active)/.test(
        haystack,
      ),
    reflection:
      traits.includes("reflective") ||
      /\b(reflect|reflection|memory|memories|past|journal|gratitud)/.test(
        haystack,
      ),
  };
}

/** Profile-aware ordering of the three offered actions. The first
 *  action is the one the card highlights / shows on top. Falls
 *  back to neutral (breathe → recall → sit) when the profile is
 *  empty or doesn't carry a useful signal. */
export function orderMemMomentActions(
  profile: UserProfile | UserProfileEmpty | null,
): MemMomentAction[] {
  const neutral: MemMomentAction[] = ["breathe", "recall", "sit"];
  const { movement, reflection } = readProfileSignals(profile);
  if (movement && !reflection) return ["breathe", "recall", "sit"];
  if (reflection && !movement) return ["recall", "breathe", "sit"];
  return neutral;
}

export interface MemMomentActionCopy {
  label: string;
  hint: string;
}

/** Profile-aware label + hint for each action. Movement-leaning
 *  users get a more "active reset" framing on breathe; reflective
 *  users get a "remember together" framing on recall. Falls back to
 *  the neutral copy when no profile signal applies. */
export function memMomentActionCopy(
  action: MemMomentAction,
  profile: UserProfile | UserProfileEmpty | null,
): MemMomentActionCopy {
  const { movement, reflection } = readProfileSignals(profile);
  switch (action) {
    case "breathe":
      if (movement) {
        return {
          label: "Try a minute of breathing",
          hint: "A short reset before you move.",
        };
      }
      return {
        label: "Breathe with me",
        hint: "One quiet minute, together.",
      };
    case "recall":
      if (reflection) {
        return {
          label: "Remember something good together",
          hint: "Pull up a moment from your library.",
        };
      }
      return {
        label: "Pull up a good memory",
        hint: "Something from your library.",
      };
    case "sit":
      return {
        label: "Just sit with me",
        hint: "No need to do anything.",
      };
  }
}

/** Warm one-line acknowledgement personalised on the user's first
 *  name when we have one. Profile-aware copy: when reflection is
 *  the user's stated path, use a softer "let's slow down" line;
 *  movement-leaning users get a "let's reset" line. */
export function memMomentHeadline(
  displayName: string | null | undefined,
  profile: UserProfile | UserProfileEmpty | null,
): string {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  const name = first.length > 0 && first.length <= 24 ? first : "";
  const order = orderMemMomentActions(profile);
  if (order[0] === "recall") {
    return name
      ? `That sounds heavy, ${name}. Want to slow down for a sec?`
      : "That sounds heavy. Want to slow down for a sec?";
  }
  if (order[0] === "breathe") {
    return name
      ? `Rough one, ${name}. Let's reset together.`
      : "Rough one. Let's reset together.";
  }
  return name
    ? `I'm here, ${name}.`
    : "I'm here.";
}
