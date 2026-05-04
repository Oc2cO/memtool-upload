import React, { useCallback, useMemo } from "react";
import { Pressable, StyleProp, StyleSheet, ViewStyle } from "react-native";
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
  liftDistance?: number;
  /**
   * When true, also animates the shadow/elevation half of Mercury Recipe E
   * (iOS `shadowOpacity` +0.06, Android `elevation` +4) on press, relative
   * to whatever baseline the parent's `style` defines. Defaults to `false`
   * so existing call sites stay visually unchanged.
   *
   * Note: enabling this (and animation in general) means the wrapper's
   * animated style takes precedence over `transform` you pass via `style`,
   * since the wrapper merges as `[style, animatedStyle]` so the animated
   * shadow keys can win during the press. Don't pass a custom `transform`
   * via `style` and expect it to override the press lift.
   */
  liftShadow?: boolean;
};

export function LiftPress({
  onPress,
  onLongPress,
  disabled,
  style,
  children,
  hitSlop = 4,
  accessibilityLabel,
  accessibilityRole = "button",
  testID,
  liftDistance = 2,
  liftShadow = false,
}: Props) {
  const translateY = useSharedValue(0);
  const shadowProgress = useSharedValue(0);

  // Read the baseline shadow/elevation from the parent's own style so the
  // bump animates *relative* to whatever the card already defines. Cards
  // with no baseline shadow fall back to the Mercury Recipe E values
  // (shadowOpacity 0.04, elevation 2). The parent is still responsible
  // for shadowColor/offset/radius so we don't inject any shadow geometry
  // a card didn't ask for.
  const { baseShadowOpacity, baseElevation } = useMemo(() => {
    const flat = StyleSheet.flatten(style) ?? {};
    const op = typeof flat.shadowOpacity === "number" ? flat.shadowOpacity : 0.04;
    const el = typeof flat.elevation === "number" ? flat.elevation : 2;
    return { baseShadowOpacity: op, baseElevation: el };
  }, [style]);

  const handlePressIn = useCallback(() => {
    if (disabled) return;
    translateY.value = withSpring(-liftDistance, SPRINGS.lift);
    if (liftShadow) {
      shadowProgress.value = withSpring(1, SPRINGS.lift);
    }
  }, [disabled, liftDistance, liftShadow]);

  const handlePressOut = useCallback(() => {
    if (disabled) return;
    translateY.value = withSpring(0, SPRINGS.lift);
    if (liftShadow) {
      shadowProgress.value = withSpring(0, SPRINGS.lift);
    }
  }, [disabled, liftShadow]);

  const animatedStyle = useAnimatedStyle(() => {
    if (!liftShadow) {
      return { transform: [{ translateY: translateY.value }] };
    }
    const p = shadowProgress.value;
    return {
      transform: [{ translateY: translateY.value }],
      shadowOpacity: baseShadowOpacity + p * 0.06,
      elevation: baseElevation + p * 4,
    };
  });

  // Parent style first so its shadow geometry (color/offset/radius) is kept,
  // then animatedStyle so the animated shadowOpacity/elevation/transform win
  // during the press instead of being clobbered by any baseline values the
  // parent set on the same keys.
  return (
    <Animated.View style={[style, animatedStyle]}>
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
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
