import React, { useCallback, useRef } from "react";
import {
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
  GestureResponderEvent,
  LayoutChangeEvent,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  cancelAnimation,
  interpolate,
  interpolateColor,
  Easing,
} from "react-native-reanimated";

import { radius } from "@/constants/spacing";
import { DURATIONS, SPRINGS } from "@/lib/animationTokens";

import { RippleTouch, type RippleTouchHandle } from "./RippleTouch";

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

const screenHapticFiredRefs = new WeakMap<object, boolean>();
const screenHapticTokens = new Map<string, object>();

function getScreenToken(screenKey: string | undefined): object {
  const key = screenKey ?? "global";
  let token = screenHapticTokens.get(key);
  if (!token) {
    token = {};
    screenHapticTokens.set(key, token);
  }
  return token;
}

export function resetAliveScreenHaptic(screenKey: string): void {
  const token = screenHapticTokens.get(screenKey);
  if (token) screenHapticFiredRefs.delete(token);
}

type Props = {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  glowColor?: string;
  rippleColor?: string;
  glowIntensity?: number;
  glowInDurationMs?: number;
  glowOutDurationMs?: number;
  fillColor?: string;
  pressedFillColor?: string;
  colorDurationMs?: number;
  pressScale?: number;
  fillBorderRadius?: number;
  screenKey?: string;
  hitSlop?: number;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link" | "none";
  testID?: string;
  /** Disable the hover/shimmer effects (e.g. for chrome-free buttons). */
  shimmer?: boolean;
  /** Tint of the diagonal sheen sweep. */
  shimmerColor?: string;
  children: React.ReactNode;
};

export function AliveButton({
  onPress,
  onLongPress,
  disabled,
  style,
  glowColor = "#a78bfa",
  rippleColor = "rgba(255, 255, 255, 0.42)",
  glowIntensity = 1,
  glowInDurationMs = 120,
  glowOutDurationMs = 320,
  fillColor,
  pressedFillColor,
  colorDurationMs = 200,
  pressScale = 1.02,
  fillBorderRadius,
  screenKey,
  hitSlop = 4,
  accessibilityLabel,
  accessibilityRole = "button",
  testID,
  shimmer = true,
  shimmerColor = "rgba(255,255,255,0.55)",
  children,
}: Props) {
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);
  const pressed = useSharedValue(0);
  // hover (web/desktop only — RN ignores hover events on native, where
  // these stay at 0). Drives the idle shimmer sweep + a subtle lift,
  // restoring the "scrolled the cursor over and it came alive" moment
  // the user remembered from an earlier build.
  const hover = useSharedValue(0);
  // sheen drives the diagonal water-shimmer strip 0->1 across the
  // button face. Looped while hovered, one-shot on press.
  const sheen = useSharedValue(0);
  const rippleRef = useRef<RippleTouchHandle>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    sizeRef.current = {
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    };
  }, []);

  const startShimmerLoop = useCallback(() => {
    if (!shimmer) return;
    sheen.value = 0;
    sheen.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.cubic) }),
      -1,
      false,
    );
  }, [shimmer]);

  const stopShimmerLoop = useCallback(() => {
    cancelAnimation(sheen);
    sheen.value = withTiming(0, { duration: 220 });
  }, []);

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      if (disabled) return;
      const { locationX, locationY } = e.nativeEvent;
      scale.value = withSpring(pressScale, SPRINGS.lift);
      glow.value = withTiming(1, { duration: glowInDurationMs });
      pressed.value = withTiming(1, {
        duration: colorDurationMs,
        easing: Easing.inOut(Easing.ease),
      });
      // One-shot sheen sweep on press (independent of hover loop):
      // gives the button a satisfying water-flash on tap.
      if (shimmer) {
        cancelAnimation(sheen);
        sheen.value = 0;
        sheen.value = withTiming(1, {
          duration: 520,
          easing: Easing.out(Easing.cubic),
        });
      }
      rippleRef.current?.trigger(locationX, locationY);
    },
    [disabled, pressScale, glowInDurationMs, colorDurationMs, shimmer],
  );

  const handlePressOut = useCallback(() => {
    if (disabled) return;
    scale.value = withSpring(1, SPRINGS.lift);
    glow.value = withTiming(0, { duration: glowOutDurationMs });
    pressed.value = withTiming(0, {
      duration: colorDurationMs,
      easing: Easing.inOut(Easing.ease),
    });
    // If the cursor is still hovering after release (web), resume the
    // ambient shimmer loop. Otherwise the sheen quietly settles.
    if (shimmer && hover.value > 0.5) {
      startShimmerLoop();
    }
  }, [disabled, glowOutDurationMs, colorDurationMs, shimmer, startShimmerLoop]);

  const handleHoverIn = useCallback(() => {
    if (disabled) return;
    hover.value = withTiming(1, { duration: 180 });
    glow.value = withTiming(0.55, { duration: 220 });
    scale.value = withSpring(1.012, SPRINGS.lift);
    startShimmerLoop();
  }, [disabled, startShimmerLoop]);

  const handleHoverOut = useCallback(() => {
    if (disabled) return;
    hover.value = withTiming(0, { duration: 220 });
    glow.value = withTiming(0, { duration: 280 });
    scale.value = withSpring(1, SPRINGS.lift);
    stopShimmerLoop();
  }, [disabled, stopShimmerLoop]);

  const handlePress = useCallback(() => {
    if (disabled) return;
    const token = getScreenToken(screenKey);
    if (!screenHapticFiredRefs.get(token)) {
      // Generic "tap registered" cue for a reusable button shell.
      // Verb haptics fire from the call site on the actual outcome.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      screenHapticFiredRefs.set(token, true);
    }
    onPress?.();
  }, [disabled, onPress, screenKey]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.85 * glowIntensity,
  }));

  // Diagonal water-shimmer sweep. The strip sits at width*1.6 and
  // sweeps from -1.2*W to +1.2*W so the highlight enters left and
  // exits right, regardless of the resolved button width. Opacity is
  // strongest in the middle of the pass for a soft "water roll".
  const sheenStyle = useAnimatedStyle(() => {
    const w = sizeRef.current.width || 1;
    return {
      opacity:
        sheen.value === 0
          ? 0
          : interpolate(sheen.value, [0, 0.5, 1], [0, 0.85, 0]),
      transform: [
        { translateX: interpolate(sheen.value, [0, 1], [-w * 1.2, w * 1.2]) },
        { rotate: "18deg" },
      ],
    };
  });

  const fillStyle = useAnimatedStyle(() => {
    if (!fillColor) return {};
    const target = pressedFillColor ?? fillColor;
    return {
      backgroundColor: interpolateColor(
        pressed.value,
        [0, 1],
        [fillColor, target],
      ),
    };
  });

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glow,
          {
            shadowColor: glowColor,
            backgroundColor: glowColor,
          },
          glowStyle,
        ]}
      />
      <Pressable
        onLayout={handleLayout}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        onLongPress={onLongPress}
        onHoverIn={Platform.OS === "web" ? handleHoverIn : undefined}
        onHoverOut={Platform.OS === "web" ? handleHoverOut : undefined}
        disabled={disabled}
        hitSlop={hitSlop}
        style={styles.pressable}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        accessibilityState={{ disabled: !!disabled }}
        testID={testID}
      >
        {fillColor ? (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              fillBorderRadius !== undefined && { borderRadius: fillBorderRadius },
              fillStyle,
            ]}
          />
        ) : null}
        <View style={styles.content}>{children}</View>
        {shimmer ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.sheenWrap, sheenStyle]}
          >
            <AnimatedLinearGradient
              colors={[
                "rgba(255,255,255,0)",
                shimmerColor,
                "rgba(255,255,255,0)",
              ]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.sheenStrip}
            />
          </Animated.View>
        ) : null}
        <RippleTouch
          ref={rippleRef}
          color={rippleColor}
          containerSize={sizeRef.current}
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: "absolute",
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 28,
    opacity: 0,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 20,
    elevation: 0,
  },
  pressable: {
    position: "relative",
    overflow: "hidden",
    borderRadius: radius.lg,
  },
  content: {
    position: "relative",
  },
  sheenWrap: {
    position: "absolute",
    top: -8,
    bottom: -8,
    left: 0,
    width: "60%",
    justifyContent: "center",
    alignItems: "center",
  },
  sheenStrip: {
    width: "100%",
    height: "260%",
  },
});
