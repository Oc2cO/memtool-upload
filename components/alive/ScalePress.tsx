import React, { useCallback } from "react";
import { Pressable, StyleProp, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { SPRINGS } from "@/lib/animationTokens";

type Props = {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  hitSlop?: number;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link" | "none";
  testID?: string;
  pressedScale?: number;
};

export function ScalePress({
  onPress,
  onLongPress,
  disabled,
  style,
  children,
  hitSlop = 4,
  accessibilityLabel,
  accessibilityRole = "button",
  testID,
  pressedScale = 1.02,
}: Props) {
  const scale = useSharedValue(1);

  const handlePressIn = useCallback(() => {
    if (disabled) return;
    scale.value = withSpring(pressedScale, SPRINGS.lift);
  }, [disabled, pressedScale]);

  const handlePressOut = useCallback(() => {
    if (disabled) return;
    scale.value = withSpring(1, SPRINGS.lift);
  }, [disabled]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Style is forwarded to the inner Pressable (not the outer
  // Animated.View) so the touch target matches the visible padded
  // surface of cards/buttons that ride this primitive — Pressables
  // sized smaller than their parent shrink the hit area and were
  // the cause of capture/voice/daily-selfie tile regressions
  // earlier in this branch. The outer Animated.View only carries
  // the scale transform and auto-sizes to the styled Pressable.
  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled}
        hitSlop={hitSlop}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        accessibilityState={{ disabled: !!disabled }}
        testID={testID}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
