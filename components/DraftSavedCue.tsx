import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated as RNAnimated,
  StyleSheet,
  Text,
} from "react-native";

import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";

/**
 * Tiny "Draft saved" cue shown briefly after a successful background
 * write from `captureDraftStore` (Task #322).
 *
 * Design notes:
 *   - Absolutely positioned by `topOffset`, right-aligned. The screen
 *     passes a `top` value so the cue lands just under the header,
 *     near the Save button — that's where the user's eye is the
 *     moment after the debounce fires.
 *   - zIndex 50 sits below the existing `Toast` (zIndex 100) so a
 *     post-save toast can never stack underneath the cue. The two
 *     surfaces also serve different moments — cue = "the draft is
 *     safe", toast = "the memory is committed" — so they almost
 *     never appear together in practice.
 *   - Reduce-motion: the OS preference is read on mount via
 *     `AccessibilityInfo.isReduceMotionEnabled` and live-updated via
 *     the `reduceMotionChanged` listener. When on, the fade is
 *     replaced by an instant flip so the cue still appears + clears
 *     but without the smooth opacity ramp.
 *   - `pointerEvents="none"` so the cue never blocks Save / Cancel.
 */
interface DraftSavedCueProps {
  visible: boolean;
  /** Absolute Y position in screen coordinates. Screens compute this
   *  from their safe-area insets so the cue floats just under the
   *  header bar. */
  topOffset: number;
}

export function DraftSavedCue({ visible, topOffset }: DraftSavedCueProps) {
  const colors = useColors();
  const opacity = useRef(new RNAnimated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (!cancelled) setReduceMotion(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v) => setReduceMotion(Boolean(v)),
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    const duration = reduceMotion ? 0 : visible ? 180 : 240;
    RNAnimated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration,
      useNativeDriver: true,
    }).start();
  }, [visible, reduceMotion, opacity]);

  return (
    <RNAnimated.View
      pointerEvents="none"
      style={[
        styles.container,
        {
          top: topOffset,
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity,
        },
      ]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "yes" : "no-hide-descendants"}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      accessibilityLabel="Draft saved"
    >
      <Ionicons
        name="cloud-done-outline"
        size={12}
        color={colors.mutedForeground}
      />
      <Text style={[styles.text, { color: colors.mutedForeground }]}>
        Draft saved
      </Text>
    </RNAnimated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: spacing.base,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    zIndex: 50,
  },
  text: {
    ...text.caption,
    fontSize: 11,
  },
});
