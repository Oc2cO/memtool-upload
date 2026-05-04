import React, { useEffect } from "react";
import { AccessibilityInfo, StyleProp, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useBreathingEnabled } from "@/lib/aliveUI";
import { EASING } from "@/lib/animationTokens";

type Props = {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  /**
   * Optional pre-roll delay (ms) before the settle starts. Used by
   * lists (archive rows, etc.) to stagger row arrivals so a freshly
   * mounted screen reads as a wave instead of a synchronized jolt.
   * Callers typically pass `(index % N) * STAGGER_MS` with a small
   * cap so a 1000-row list doesn't queue a 30s tail.
   */
  delay?: number;
};

const SETTLE_HALF_DURATION_MS = 175;
const SETTLE_OFFSET_PX = -3;

export function SettleOnMount({ style, children, delay = 0 }: Props) {
  const enabled = useBreathingEnabled();
  const ty = useSharedValue(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled || reduce) return;
        const seq = withSequence(
          withTiming(SETTLE_OFFSET_PX, {
            duration: SETTLE_HALF_DURATION_MS,
            easing: EASING.out,
          }),
          withTiming(0, {
            duration: SETTLE_HALF_DURATION_MS,
            easing: EASING.in,
          }),
        );
        ty.value = delay > 0 ? withDelay(delay, seq) : seq;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, delay]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
  }));

  return <Animated.View style={[style, animStyle]}>{children}</Animated.View>;
}
