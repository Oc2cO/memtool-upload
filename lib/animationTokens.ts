import { Easing, FadeInUp, ReduceMotion } from "react-native-reanimated";
import { isWeb } from "./platform";

export const DURATIONS = {
  instant: 120,
  fast: 150,
  base: 200,
  medium: 300,
  slow: 500,
  cinematic: 600,
  ambient: 18000,
} as const;

export const EASING = {
  default: Easing.bezier(0.4, 0, 0.2, 1),
  out: Easing.bezier(0, 0, 0.2, 1),
  in: Easing.bezier(0.4, 0, 1, 1),
  expressive: Easing.bezier(0.16, 0, 0.13, 1),
  snap: Easing.bezier(0.2, 1, 0.4, 1),
  anticipate: Easing.bezier(0.65, 0.05, 0.36, 1),
  swift: Easing.bezier(0.8, 0, 0.5, 1),
} as const;

export const SPRINGS = {
  snap: { damping: 22, stiffness: 260, mass: 0.55 },
  lift: { damping: 18, stiffness: 200, mass: 0.7 },
  settle: { damping: 14, stiffness: 170, mass: 0.8 },
} as const;

// Mercury-style "soft fade-up" reveal for stacks of cards on mount.
// 90ms-per-card stagger comes from the research report (§9 item #6 +
// §7.3 Recipe B). Returns `undefined` when motion is disabled so the
// caller can omit `entering` entirely; otherwise returns a layout
// animation that respects the OS reduce-motion preference natively
// via Reanimated's ReduceMotion.System mode.
export const CARD_STAGGER_MS = 90;
export function cardEntering(index: number, enabled: boolean) {
  if (!enabled || isWeb) return undefined;
  return FadeInUp.duration(DURATIONS.slow)
    .delay(index * CARD_STAGGER_MS)
    .easing(EASING.expressive)
    .reduceMotion(ReduceMotion.System);
}
