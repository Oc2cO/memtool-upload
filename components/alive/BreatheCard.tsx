import React, { useEffect } from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  withSequence,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";

import { useBreathingEnabled } from "@/lib/aliveUI";
import { DURATIONS } from "@/lib/animationTokens";

type Props = {
  index?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  paused?: boolean;
};

const PERIOD_MS = 4000;
const HALF = PERIOD_MS / 2;
const STAGGER_MS = 250;
const MIN_OPACITY = 0.94;
const MAX_OPACITY = 1.0;

export function BreatheCard({ index = 0, style, children, paused }: Props) {
  const breathingEnabled = useBreathingEnabled();
  const opacity = useSharedValue(MAX_OPACITY);

  useEffect(() => {
    cancelAnimation(opacity);
    if (paused || !breathingEnabled) {
      opacity.value = withTiming(MAX_OPACITY, { duration: DURATIONS.base });
      return;
    }
    const initialDelay = (index % 8) * STAGGER_MS;
    opacity.value = MAX_OPACITY;
    opacity.value = withDelay(
      initialDelay,
      withRepeat(
        withSequence(
          withTiming(MIN_OPACITY, {
            duration: HALF,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(MAX_OPACITY, {
            duration: HALF,
            easing: Easing.inOut(Easing.sin),
          }),
        ),
        -1,
        false,
      ),
    );
    return () => {
      cancelAnimation(opacity);
    };
  }, [breathingEnabled, paused, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  if (!breathingEnabled) {
    return <View style={style}>{children}</View>;
  }

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}
