import React from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { BlurView, type BlurTint } from "expo-blur";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useDerivedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { DURATIONS, EASING } from "@/lib/animationTokens";

// Mercury's sticky nav goes from transparent to a frosted-glass
// blur as the user scrolls past ~32px (research §4 / §9 #7 / Recipe
// F). The intensity is `interpolate`'d directly off the scroll
// position over the first 32px so the frost builds up smoothly with
// the user's gesture, then `withTiming` (DURATIONS.base + EASING.default)
// smooths transitions when the value lands on a new target — i.e.
// the canonical animation curve from Task #90 governs the ramp shape.
export const SCROLL_FROST_THRESHOLD = 32;
const MAX_INTENSITY = 28;

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

type Props = {
  scrollY: SharedValue<number>;
  tint?: BlurTint;
  style?: StyleProp<ViewStyle>;
};

/**
 * Shared frosted-glass backdrop driven by a scroll shared value.
 *
 * Drop into the absolute-fill stack of a sticky header. The wrapper
 * BlurView interpolates its `intensity` between `0` and `28` over
 * the first `SCROLL_FROST_THRESHOLD` pixels of scroll, then
 * `withTiming` smooths the value toward each new interpolated target
 * using `DURATIONS.base` + `EASING.default` so every screen that
 * opts in lands on the same Mercury polish curve.
 *
 * `pointerEvents="none"` so the frost never steals taps from the
 * header content above it.
 */
export function FrostBackground({ scrollY, tint = "dark", style }: Props) {
  const intensity = useDerivedValue(() => {
    const target = interpolate(
      scrollY.value,
      [0, SCROLL_FROST_THRESHOLD],
      [0, MAX_INTENSITY],
      Extrapolation.CLAMP,
    );
    return withTiming(target, {
      duration: DURATIONS.base,
      easing: EASING.default,
    });
  });

  const animatedProps = useAnimatedProps(() => ({
    intensity: intensity.value,
  }));

  return (
    <AnimatedBlurView
      pointerEvents="none"
      tint={tint}
      animatedProps={animatedProps}
      style={[StyleSheet.absoluteFill, style]}
    />
  );
}
