// `useHaptic(name)` — one-line access to MemTool's hand-authored haptic
// vocabulary from any component.
//
//   const captureHaptic = useHaptic("capture");
//   captureHaptic.play();
//
// The hook returns a stable `play()` that schedules the AHAP pattern
// for `name` through the JS interpreter in `ahapPlayer.ts`. Any
// pending scheduled events are cancelled when the component unmounts
// so a partially-played pattern never fires after the user has left
// the screen.
//
// `useHaptics()` (plural, no arg) is the lower-level escape hatch
// when a screen needs more than one signature — e.g. recap.tsx fires
// "day-recap-ready" on success and "error" on failure.
//
// Per-signature mute (Task #243): `play()` consults
// `isHapticMutedCached(name)` and silently skips disabled signatures
// at the playback layer. This is what lets every existing call site
// (capture.tsx, recap.tsx, …) keep calling `haptics.play("error")`
// without knowing about user preferences. The "Try a haptic" demo
// is the one caller that needs to bypass the gate so users can
// re-evaluate a disabled signature before turning it back on — it
// passes `{ ignoreMute: true }`.
//
// Master gate (Task #252): `play()` ALSO consults
// `isHapticsMasterEnabledCached()` first. The Settings screen has a
// dedicated "Haptics" master switch (split out from the legacy
// "Sound Effects" switch, which only ever gated audio); flipping it
// off silently skips every signature here. The same `ignoreMute`
// escape hatch bypasses the master gate so the demo can preview a
// disabled signature before the user re-enables haptics.

import { useCallback, useEffect, useRef } from "react";

import { playPattern, type PlayHandle } from "./ahapPlayer";
import { HAPTIC_PATTERNS } from "./patterns";
import {
  ensureHapticMutePrefsHydrated,
  ensureHapticsMasterEnabledHydrated,
  isHapticMutedCached,
  isHapticsMasterEnabledCached,
} from "./preferences";
import type { HapticName } from "./types";

export type HapticPlayOptions = {
  /**
   * Bypass the per-signature mute gate. Used by the Settings "Try a
   * haptic" demo so a user can feel a disabled signature before
   * re-enabling it. Production call sites should NEVER set this —
   * the whole point of muting at the playback layer is that feature
   * code stays oblivious to user preferences.
   */
  ignoreMute?: boolean;
};

export type HapticPlayer = {
  play: (options?: HapticPlayOptions) => void;
};

export type HapticsApi = {
  play: (name: HapticName, options?: HapticPlayOptions) => void;
};

export function useHaptics(): HapticsApi {
  const pendingRef = useRef<PlayHandle[]>([]);

  useEffect(() => {
    // Idempotent — safe to call from every mount. Hydrates the mute
    // map and the master switch once so the first user-triggered
    // `play()` after launch already respects their saved preferences.
    void ensureHapticMutePrefsHydrated();
    void ensureHapticsMasterEnabledHydrated();
    return () => {
      for (const handle of pendingRef.current) {
        handle.cancel();
      }
      pendingRef.current = [];
    };
  }, []);

  const play = useCallback(
    (name: HapticName, options?: HapticPlayOptions) => {
      const pattern = HAPTIC_PATTERNS[name];
      if (!pattern) return;
      if (!options?.ignoreMute) {
        // Master gate first — if the user has flipped the global
        // "Haptics" switch off we skip every signature, no matter
        // what the per-signature map says. The two gates compose:
        // either one can silence a pattern.
        if (!isHapticsMasterEnabledCached()) return;
        if (isHapticMutedCached(name)) return;
      }
      const handle = playPattern(pattern);
      pendingRef.current.push(handle);
    },
    [],
  );

  return { play };
}

export function useHaptic(name: HapticName): HapticPlayer {
  const { play } = useHaptics();
  const playOne = useCallback(
    (options?: HapticPlayOptions) => {
      play(name, options);
    },
    [play, name],
  );
  return { play: playOne };
}
