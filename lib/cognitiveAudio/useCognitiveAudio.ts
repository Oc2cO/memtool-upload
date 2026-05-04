// Hook screens use to start the cognitive sound bed for their
// context. Driven by `useFocusEffect` (not `useEffect`) so playback
// follows screen focus, not just mount/unmount — in expo-router /
// React Navigation stacks, screens often stay mounted while pushed
// behind another screen, and we don't want a forest bed leaking out
// of `capture` while the user is reading a recap on top of it.
//
// Usage:
//
//   export default function CaptureScreen() {
//     useCognitiveAudio("capture");
//     ...
//   }
//
// Screens never need to know whether the layer is enabled, whether
// binaural is on, or whether assets are bundled — the service in
// `service.ts` makes those decisions and gracefully no-ops when
// audio is disabled or the asset for the requested context is
// missing on the current platform.

import { useCallback } from "react";
import { useFocusEffect } from "expo-router";

import {
  ensureCognitiveAudioPrefsHydrated,
  subscribeCognitiveAudioPrefs,
} from "./preferences";
import { playContext, stop } from "./service";
import type { CognitiveAudioContext } from "./types";

export function useCognitiveAudio(context: CognitiveAudioContext): void {
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void ensureCognitiveAudioPrefsHydrated().then(() => {
        if (cancelled) return;
        void playContext(context);
      });
      // Re-evaluate playback whenever preferences change so toggling
      // the master switch in Settings (likely from a different stack)
      // takes effect immediately while the user is on a cognitive
      // screen.
      const unsub = subscribeCognitiveAudioPrefs(() => {
        if (cancelled) return;
        void playContext(context);
      });
      return () => {
        cancelled = true;
        unsub();
        // Blur / unmount → stop. The next focus on a cognitive
        // screen will re-issue `playContext` for ITS context, which
        // cross-fades cleanly inside the singleton service.
        stop();
      };
    }, [context]),
  );
}
