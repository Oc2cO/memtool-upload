import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useColors } from "@/hooks/useColors";

// Loading state shown while gpt-image-1 paints a memory. Modeled on
// the brand's "alive UI" cadence: a slowly rotating brand mark
// (mirrors `RotatingBrandMark`'s 60s turn) with three radiating
// dots that pulse out from the center on a 1.6s loop, plus a soft
// caption. Designed to feel intentional and unhurried — the user
// just spent a slot of their daily quota; the loader's job is to
// reassure them the result is worth the wait, not to nag them with
// a spinner.
//
// Self-contained: no props beyond an optional caption override and
// size, so any screen that wants to show "an illustration is being
// generated" can drop it in without re-deriving the animation
// math. The Archive uses it inline inside the polaroid frame; the
// Capture screen uses it full-bleed under the just-saved memory.
export interface IllustrationLoaderProps {
  size?: number;
  caption?: string;
}

const DEFAULT_CAPTION = "Creating your memory…";

export function IllustrationLoader({
  size = 96,
  caption = DEFAULT_CAPTION,
}: IllustrationLoaderProps) {
  const colors = useColors();
  const rotation = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 4_000, easing: Easing.linear }),
      -1,
      false,
    );
    pulse.value = withRepeat(
      withTiming(1, { duration: 1_600, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(rotation);
      cancelAnimation(pulse);
    };
  }, [rotation, pulse]);

  const markStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  // Three dots phased 1/3 of the cycle apart so the rings always
  // stagger out from the center. Each ring fades from solid → 0 as
  // it expands to 1.4× the loader size.
  const ring1 = useAnimatedStyle(() => {
    const t = pulse.value;
    return {
      transform: [{ scale: interpolate(t, [0, 1], [0.4, 1.4]) }],
      opacity: interpolate(t, [0, 0.5, 1], [0.6, 0.3, 0]),
    };
  });
  const ring2 = useAnimatedStyle(() => {
    const t = (pulse.value + 0.33) % 1;
    return {
      transform: [{ scale: interpolate(t, [0, 1], [0.4, 1.4]) }],
      opacity: interpolate(t, [0, 0.5, 1], [0.6, 0.3, 0]),
    };
  });
  const ring3 = useAnimatedStyle(() => {
    const t = (pulse.value + 0.66) % 1;
    return {
      transform: [{ scale: interpolate(t, [0, 1], [0.4, 1.4]) }],
      opacity: interpolate(t, [0, 0.5, 1], [0.6, 0.3, 0]),
    };
  });

  const ringBase = {
    position: "absolute" as const,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 1.5,
    borderColor: colors.primary,
  };

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={caption}
      style={styles.container}
    >
      <View style={[styles.stage, { width: size * 1.6, height: size * 1.6 }]}>
        <Animated.View style={[ringBase, ring1]} />
        <Animated.View style={[ringBase, ring2]} />
        <Animated.View style={[ringBase, ring3]} />
        <Animated.View
          style={[
            styles.mark,
            { width: size * 0.55, height: size * 0.55, borderRadius: size * 0.28 },
            { backgroundColor: colors.primary, opacity: 0.92 },
            markStyle,
          ]}
        >
          <Text
            style={[
              styles.markGlyph,
              { color: colors.primaryForeground, fontSize: size * 0.28 },
            ]}
          >
            ✦
          </Text>
        </Animated.View>
      </View>
      <Text style={[styles.caption, { color: colors.mutedForeground }]}>
        {caption}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
  },
  stage: {
    alignItems: "center",
    justifyContent: "center",
  },
  mark: {
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  markGlyph: {
    fontWeight: "700",
  },
  caption: {
    marginTop: 14,
    fontSize: 13,
    letterSpacing: 0.2,
  },
});
