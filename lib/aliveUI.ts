import { useEffect, useRef, useState } from "react";

let breathingEnabledModule = true;
const subscribers = new Set<(enabled: boolean) => void>();

let slowFrameStreak = 0;
const SLOW_FRAME_THRESHOLD_MS = 20;
const SLOW_FRAME_STREAK_LIMIT = 3;

export function getBreathingEnabled(): boolean {
  return breathingEnabledModule;
}

function disableBreathing(): void {
  if (!breathingEnabledModule) return;
  breathingEnabledModule = false;
  for (const cb of subscribers) cb(false);
}

export function subscribeBreathingEnabled(
  cb: (enabled: boolean) => void,
): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function useBreathingEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(getBreathingEnabled());
  useEffect(() => subscribeBreathingEnabled(setEnabled), []);
  return enabled;
}

export function reportFrameDuration(durationMs: number): void {
  if (!breathingEnabledModule) return;
  if (durationMs > SLOW_FRAME_THRESHOLD_MS) {
    slowFrameStreak += 1;
    if (slowFrameStreak >= SLOW_FRAME_STREAK_LIMIT) {
      disableBreathing();
    }
  } else {
    slowFrameStreak = 0;
  }
}

export function useFrameMonitor(): void {
  const lastTsRef = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = (ts: number) => {
      if (lastTsRef.current !== null) {
        reportFrameDuration(ts - lastTsRef.current);
      }
      lastTsRef.current = ts;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lastTsRef.current = null;
    };
  }, []);
}

export function _resetAliveUIForTests(): void {
  breathingEnabledModule = true;
  slowFrameStreak = 0;
  for (const cb of subscribers) cb(true);
}
