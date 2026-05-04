import React, { useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useColors } from "@/hooks/useColors";
import { spacing, radius } from "@/constants/spacing";
import { flameIntensity, type StreakSnapshot } from "@/lib/streak";
import { getLocalDayKey } from "@/lib/captureLimits";

interface StreakIndicatorProps {
  streak: StreakSnapshot;
  onPress?: () => void;
  /** Tap on the snowflake badge — surfaces "earn / buy more freezes"
   *  paths (Task #368). Optional: when omitted the badge is non-
   *  interactive so the chip degrades cleanly on surfaces that
   *  don't have an upsell flow wired (e.g. tests, recap). */
  onFreezePress?: () => void;
  /** Test seam: pin the wall-clock hour. Defaults to live `Date`. */
  hourOverride?: number;
}

const AnimatedIonicon = Animated.createAnimatedComponent(Ionicons);

/**
 * Small home/recap surface chip showing the user's current capture
 * streak. The flame's color and a subtle pulse intensify as the
 * day's window narrows — never alarming, just gently noticeable.
 *
 * Hard rules:
 *   - Zero state (no streak yet) renders as a soft, unfilled chip
 *     so we never advertise "0 days" as a number-shaped guilt-trip.
 *   - Pulse and color escalation only fire when the user has NOT
 *     captured today — once today is logged, the chip relaxes.
 *   - Every animation honors the existing reduce-motion plumbing
 *     via the `useSharedValue` no-op (Reanimated already respects
 *     the OS preference for repeated animations).
 */
export function StreakIndicator({
  streak,
  onPress,
  onFreezePress,
  hourOverride,
}: StreakIndicatorProps) {
  const colors = useColors();
  const today = useMemo(() => getLocalDayKey(), []);
  const hour = hourOverride ?? new Date().getHours();
  const intensity = flameIntensity(streak.lastCountedDay, today, hour);

  // Pulse the flame when the day-window is closing. Smooth, slow
  // sine wave — closer to "breathing" than to "alarm".
  const pulse = useSharedValue(1);
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;
  useEffect(() => {
    if (intensity === 0) {
      pulse.value = withTiming(1, { duration: 240 });
      return;
    }
    const peak = 1 + 0.08 * intensity;
    pulse.value = withRepeat(
      withTiming(peak, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [intensity, pulse]);

  const flameStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const flameColor = useMemo(() => {
    // Calm amber baseline; warms toward the brand's "ember" color
    // as intensity climbs. Stays inside the wellness palette — no
    // pure red, no high-contrast danger signaling.
    if (intensity === 0) return "#f59e0b";
    if (intensity < 0.5) return "#fb923c";
    if (intensity < 0.9) return "#f97316";
    return "#ef6c1c";
  }, [intensity]);

  const isZero = streak.current === 0;
  const a11yLabel = isZero
    ? "No streak yet — your first capture starts one"
    : `Capture streak: ${streak.current} ${streak.current === 1 ? "day" : "days"}`;

  const Container = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={a11yLabel}
      style={[
        styles.chip,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: isZero ? 0.7 : 1,
        },
      ]}
    >
      <Animated.View style={flameStyle}>
        <AnimatedIonicon
          name={isZero ? "flame-outline" : "flame"}
          size={18}
          color={isZero ? colors.mutedForeground : flameColor}
        />
      </Animated.View>
      <Text style={[styles.count, { color: colors.foreground }]}>
        {isZero ? "—" : streak.current}
      </Text>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        {isZero ? "Streak" : streak.current === 1 ? "day" : "days"}
      </Text>
      {!isZero && (
        // The badge is always rendered when `onFreezePress` is wired
        // OR the user has at least one freeze stockpiled. The
        // "0 freezes" affordance is the entry point to the
        // earn / buy flow (Task #368) — without it, free users with
        // a depleted stockpile have no way to discover they can
        // earn another one. The visual treatment dims when empty so
        // it reads as "tap to get one" rather than "you have one".
        (streak.freezesAvailable > 0 || onFreezePress) && (
          <FreezeBadge
            count={streak.freezesAvailable}
            onPress={onFreezePress}
          />
        )
      )}
    </Container>
  );
}

interface FreezeBadgeProps {
  count: number;
  onPress?: () => void;
}

function FreezeBadge({ count, onPress }: FreezeBadgeProps) {
  const empty = count <= 0;
  const a11y = empty
    ? "No freezes available — tap to earn or buy one"
    : `${count} freeze${count === 1 ? "" : "s"} available — tap for options`;
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={a11y}
      style={[
        styles.freezeBadge,
        empty && styles.freezeBadgeEmpty,
      ]}
    >
      <Ionicons
        name={empty ? "snow-outline" : "snow"}
        size={12}
        color="#7dd3fc"
      />
      {!empty && (
        <Text style={styles.freezeBadgeCount}>{count}</Text>
      )}
    </Wrap>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "flex-start",
  },
  count: {
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: "500",
  },
  freezeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginLeft: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(125, 211, 252, 0.15)",
  },
  freezeBadgeEmpty: {
    backgroundColor: "rgba(125, 211, 252, 0.06)",
    opacity: 0.7,
  },
  freezeBadgeCount: {
    fontSize: 11,
    fontWeight: "600",
    color: "#7dd3fc",
    marginLeft: 2,
  },
});

export default StreakIndicator;
