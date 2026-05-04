import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  runOnJS,
} from "react-native-reanimated";

import { useColors } from "@/hooks/useColors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import type { LevelMilestone } from "@/lib/gameLevels";

interface MilestoneToastProps {
  milestone: LevelMilestone | null;
  onDismiss: () => void;
}

/**
 * Short celebration overlay that animates in when the player crosses
 * a milestone for the first time. The parent owns the "should this
 * show?" logic — typically by reading from AsyncStorage so each
 * milestone only fires its toast once per game.
 */
export function MilestoneToast({ milestone, onDismiss }: MilestoneToastProps) {
  const colors = useColors();
  const scale = useSharedValue(0.6);
  const opacity = useSharedValue(0);
  const glyphSpin = useSharedValue(0);

  useEffect(() => {
    if (!milestone) return;
    // Reset every shared value to its starting state on each new
    // milestone — without this, a second milestone toast would
    // animate from the first toast's settled values (scale=1,
    // opacity=0, glyphSpin=0) and skip most of the entrance.
    scale.value = 0.6;
    opacity.value = 0;
    glyphSpin.value = 0;
    scale.value = withSpring(1, { damping: 9, stiffness: 140 });
    opacity.value = withTiming(1, { duration: 220 });
    glyphSpin.value = withSequence(
      withTiming(15, { duration: 200, easing: Easing.out(Easing.quad) }),
      withTiming(-10, { duration: 220 }),
      withTiming(0, { duration: 180 }),
    );
    // Auto-dismiss after ~2.6s — long enough to read but short enough
    // it doesn't block the player from tapping "Next Level".
    opacity.value = withDelay(
      2400,
      withTiming(0, { duration: 280 }, (finished) => {
        if (finished) runOnJS(onDismiss)();
      }),
    );
  }, [milestone, scale, opacity, glyphSpin, onDismiss]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${glyphSpin.value}deg` }],
  }));

  if (!milestone) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable onPress={onDismiss} style={styles.backdropArea} />
      <Animated.View
        style={[
          styles.card,
          cardStyle,
          {
            backgroundColor: colors.card,
            borderColor: colors.accent,
          },
        ]}
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`Milestone unlocked: ${milestone.title}. ${milestone.description}`}
      >
        <Animated.Text style={[styles.glyph, glyphStyle]}>
          {milestone.glyph}
        </Animated.Text>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>
          MILESTONE UNLOCKED
        </Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {milestone.title}
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {milestone.description}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 200,
  },
  backdropArea: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: "82%",
    maxWidth: 360,
    borderRadius: radius.lg,
    borderWidth: 2,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 12,
  },
  glyph: { fontSize: 64, marginBottom: spacing.sm },
  eyebrow: {
    ...text.captionStrong,
    letterSpacing: 1.2,
  },
  title: {
    ...text.cardTitle,
    textAlign: "center",
  },
  body: {
    ...text.body,
    textAlign: "center",
  },
});
