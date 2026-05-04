import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import { radius, spacing } from "@/constants/spacing";
import { useColors } from "@/hooks/useColors";
import { useHaptics } from "@/lib/haptics";
import { useBreathingEnabled } from "@/lib/aliveUI";
import { GradientBackground } from "@/components/alive/GradientBackground";
import { AmbientBlobs } from "@/components/alive/AmbientBlobs";
import { RotatingBrandMark } from "@/components/alive/RotatingBrandMark";

const AUTO_DISMISS_MS = 2800;
const ENTER_DURATION_MS = 380;
const EXIT_DURATION_MS = 260;
const BURST_DURATION_MS = 600;
const SPARK_COUNT = 8;
const SPARK_DISTANCE = 44;
const SPARK_SIZE = 6;
const ICON_WRAPPER_SIZE = 72;
const UNLOCK_REVEAL_DELAY_MS = 500;
const UNLOCK_ROW_STAGGER_MS = 70;
const UNLOCK_ROW_FADE_MS = 240;
const UNLOCK_ROW_TRANSLATE = 6;
const SPARK_ANGLES = Array.from(
  { length: SPARK_COUNT },
  (_, i) => (i * 2 * Math.PI) / SPARK_COUNT,
);

type SparkProps = {
  angle: number;
  progress: SharedValue<number>;
  color: string;
};

function Spark({ angle, progress, color }: SparkProps) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const distance = SPARK_DISTANCE * p;
    const opacity =
      p < 0.18 ? p / 0.18 : Math.max(0, 1 - (p - 0.18) / 0.82);
    const scale = 1 - p * 0.4;
    return {
      opacity,
      transform: [
        { translateX: cosA * distance },
        { translateY: sinA * distance },
        { scale },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.spark, { backgroundColor: color }, style]}
    />
  );
}

type UnlockRowProps = {
  index: number;
  total: number;
  reveal: SharedValue<number>;
  label: string;
  iconColor: string;
  textColor: string;
};

function UnlockRow({
  index,
  total,
  reveal,
  label,
  iconColor,
  textColor,
}: UnlockRowProps) {
  const totalWindow = Math.max(
    1,
    (total - 1) * UNLOCK_ROW_STAGGER_MS + UNLOCK_ROW_FADE_MS,
  );
  const start = (index * UNLOCK_ROW_STAGGER_MS) / totalWindow;
  const end = (index * UNLOCK_ROW_STAGGER_MS + UNLOCK_ROW_FADE_MS) / totalWindow;

  const animatedStyle = useAnimatedStyle(() => {
    const r = reveal.value;
    let local = (r - start) / (end - start);
    if (local < 0) local = 0;
    else if (local > 1) local = 1;
    return {
      opacity: local,
      transform: [{ translateY: (1 - local) * UNLOCK_ROW_TRANSLATE }],
    };
  });

  return (
    <Animated.View style={[styles.unlockRow, animatedStyle]}>
      <Ionicons
        name="checkmark-circle"
        size={18}
        color={iconColor}
        style={styles.checkIcon}
      />
      <Text style={[styles.unlockText, { color: textColor }]}>{label}</Text>
    </Animated.View>
  );
}

type Props = {
  visible: boolean;
  onDismiss: () => void;
  unlocks: string[];
};

export function ProCelebrationOverlay({ visible, onDismiss, unlocks }: Props) {
  const colors = useColors();
  const breathingEnabled = useBreathingEnabled();
  // Destructured so `play` (which is stable via useCallback inside the
  // hook) can safely sit in the celebration useEffect's deps without
  // re-triggering on every render — `useHaptics()` itself returns a
  // fresh object literal each call.
  const { play: playHaptic } = useHaptics();
  const [reduceMotion, setReduceMotion] = useState(false);
  const burstAllowed = breathingEnabled && !reduceMotion;
  const burstAllowedRef = useRef(burstAllowed);
  burstAllowedRef.current = burstAllowed;

  const backdropOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0.88);
  const cardOpacity = useSharedValue(0);
  const burstProgress = useSharedValue(0);
  const ringProgress = useSharedValue(0);
  const unlockReveal = useSharedValue(0);

  // Internal mount state so the overlay stays rendered through its exit
  // animation even after the parent flips `visible` back to false. Without
  // this, the animated children (Animated.View backdrop + card) get
  // unmounted while shared values are still being driven, which on web
  // tickles the Reanimated `_touchableNode is undefined` bug class.
  const [mounted, setMounted] = useState(visible);
  const dismissedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finalizeUnmount = useCallback(() => {
    setMounted(false);
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((rm) => {
        if (!cancelled) setReduceMotion(rm);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (rm) => setReduceMotion(rm),
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const runDismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    backdropOpacity.value = withTiming(0, {
      duration: EXIT_DURATION_MS,
      easing: Easing.out(Easing.quad),
    });
    cardOpacity.value = withTiming(0, {
      duration: EXIT_DURATION_MS,
      easing: Easing.out(Easing.quad),
    });
    cardScale.value = withTiming(
      0.92,
      { duration: EXIT_DURATION_MS, easing: Easing.out(Easing.quad) },
      (finished) => {
        if (finished) runOnJS(finalizeUnmount)();
      },
    );
  }, [finalizeUnmount, backdropOpacity, cardOpacity, cardScale]);

  // Mirror the `visible` prop into our internal mount state. Going
  // visible → mount + animate in. Going hidden → start exit animation
  // (which will eventually unmount via finalizeUnmount).
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    if (mounted && !dismissedRef.current) {
      runDismiss();
    }
  }, [visible, mounted, runDismiss]);

  // Drive the enter animation + auto-dismiss timer once mounted.
  useEffect(() => {
    if (!mounted || !visible) return;

    dismissedRef.current = false;
    backdropOpacity.value = 0;
    cardOpacity.value = 0;
    cardScale.value = 0.88;

    backdropOpacity.value = withTiming(1, {
      duration: ENTER_DURATION_MS,
      easing: Easing.out(Easing.quad),
    });
    cardOpacity.value = withTiming(1, {
      duration: ENTER_DURATION_MS,
      easing: Easing.out(Easing.quad),
    });
    cardScale.value = withSequence(
      withTiming(1.04, {
        duration: 300,
        easing: Easing.out(Easing.back(1.6)),
      }),
      withTiming(1.0, {
        duration: 180,
        easing: Easing.inOut(Easing.quad),
      }),
    );

    burstProgress.value = 0;
    ringProgress.value = 0;
    unlockReveal.value = 0;
    if (burstAllowedRef.current) {
      burstProgress.value = withTiming(1, {
        duration: BURST_DURATION_MS,
        easing: Easing.out(Easing.quad),
      });
      ringProgress.value = withTiming(1, {
        duration: BURST_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
      const totalStaggerWindow = Math.max(
        1,
        (Math.max(unlocks.length, 1) - 1) * UNLOCK_ROW_STAGGER_MS +
          UNLOCK_ROW_FADE_MS,
      );
      unlockReveal.value = withDelay(
        UNLOCK_REVEAL_DELAY_MS,
        withTiming(1, {
          duration: totalStaggerWindow,
          easing: Easing.out(Easing.quad),
        }),
      );
    } else {
      // Reduce-motion / breathing-disabled: rows just appear.
      unlockReveal.value = 1;
    }

    // Pro upgrade is a milestone moment — use the rising-three-tap
    // "streak-extended" verb so the haptic matches other crescendo
    // moments (streak day extended, milestone hit) instead of the
    // generic system success buzz.
    playHaptic("streak-extended");

    timerRef.current = setTimeout(() => {
      runDismiss();
    }, AUTO_DISMISS_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [mounted, visible, runDismiss, playHaptic]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));

  const ringStyle = useAnimatedStyle(() => {
    const p = ringProgress.value;
    return {
      opacity: (1 - p) * 0.7,
      transform: [{ scale: 1 + p * 0.85 }],
    };
  });

  if (!mounted) return null;

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={runDismiss}>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
        pointerEvents="none"
      />
      <Animated.View
        style={[StyleSheet.absoluteFill, backdropStyle]}
        pointerEvents="none"
      >
        <GradientBackground style={StyleSheet.absoluteFill} />
        <AmbientBlobs />
        <RotatingBrandMark
          size={420}
          color={colors.primary}
          baseOpacity={0.07}
        />
      </Animated.View>
      <View style={styles.centerer} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
            cardStyle,
          ]}
          pointerEvents="none"
        >
          <View style={styles.iconRow}>
            <View style={styles.iconWrapper}>
              {burstAllowed ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.glowRing,
                    { borderColor: colors.primary },
                    ringStyle,
                  ]}
                />
              ) : null}
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Ionicons name="sparkles" size={36} color={colors.primary} />
              </View>
              {burstAllowed
                ? SPARK_ANGLES.map((angle, i) => (
                    <View
                      key={i}
                      pointerEvents="none"
                      style={styles.sparkAnchor}
                    >
                      <Spark
                        angle={angle}
                        progress={burstProgress}
                        color={colors.primary}
                      />
                    </View>
                  ))
                : null}
            </View>
          </View>

          <Text style={[styles.headline, { color: colors.foreground }]}>
            You're MemTool Pro
          </Text>
          <Text style={[styles.subline, { color: colors.mutedForeground }]}>
            Your subscription is active
          </Text>

          <View
            style={[styles.divider, { backgroundColor: colors.border }]}
          />

          <View style={styles.unlockList}>
            {unlocks.map((unlock, i) => (
              <UnlockRow
                key={unlock}
                index={i}
                total={unlocks.length}
                reveal={unlockReveal}
                label={unlock}
                iconColor={colors.primary}
                textColor={colors.foreground}
              />
            ))}
          </View>

          <Text style={[styles.tapHint, { color: colors.mutedForeground }]}>
            Tap anywhere to continue
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(10, 6, 18, 0.88)",
  },
  centerer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xlTight,
  },
  card: {
    width: "100%",
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xlTight,
    alignItems: "center",
  },
  iconRow: {
    marginBottom: spacing.lgCard,
  },
  iconWrapper: {
    width: ICON_WRAPPER_SIZE,
    height: ICON_WRAPPER_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircle: {
    width: ICON_WRAPPER_SIZE,
    height: ICON_WRAPPER_SIZE,
    borderRadius: ICON_WRAPPER_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  glowRing: {
    position: "absolute",
    width: ICON_WRAPPER_SIZE,
    height: ICON_WRAPPER_SIZE,
    borderRadius: ICON_WRAPPER_SIZE / 2,
    borderWidth: 2,
  },
  sparkAnchor: {
    position: "absolute",
    top: (ICON_WRAPPER_SIZE - SPARK_SIZE) / 2,
    left: (ICON_WRAPPER_SIZE - SPARK_SIZE) / 2,
    width: SPARK_SIZE,
    height: SPARK_SIZE,
  },
  spark: {
    width: SPARK_SIZE,
    height: SPARK_SIZE,
    borderRadius: SPARK_SIZE / 2,
  },
  headline: {
    // 26: deliberate one-off, between text.cardTitle (24) and
    // text.screenTitle (28).
    fontSize: 26,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: spacing.sm,
    letterSpacing: -0.3,
  },
  subline: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  divider: {
    width: "100%",
    height: 1,
    marginBottom: spacing.lgCard,
  },
  unlockList: {
    width: "100%",
    gap: spacing.md,
    marginBottom: spacing.xlTight,
  },
  unlockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkIcon: {
    flexShrink: 0,
  },
  unlockText: {
    // 15: deliberate one-off, between text.helper (14) and text.body (16).
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    flexShrink: 1,
  },
  tapHint: {
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
