import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View, ViewStyle, StyleProp } from "react-native";

import { AliveButton } from "@/components/alive/AliveButton";
import { ScalePress } from "@/components/alive/ScalePress";
import colors from "@/constants/colors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

interface GradientButtonProps {
  title: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  screenKey?: string;
  accessibilityLabel?: string;
  testID?: string;
}

// Primary CTA fill is read from the colour tokens so the home Quick
// Capture button, this component, and any future primary action all
// agree on a single source of truth (Task #168).
const PRIMARY_FILL = colors.dark.primaryAction;
const PRIMARY_FILL_PRESSED = colors.dark.primaryActionPressed;

export function GradientButton({
  title,
  onPress,
  style,
  disabled,
  variant = "primary",
  screenKey,
  accessibilityLabel,
  testID,
}: GradientButtonProps) {
  if (variant === "secondary") {
    return (
      <ScalePress
        onPress={onPress}
        disabled={disabled}
        style={[styles.container, style]}
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityRole="button"
        testID={testID}
      >
        <LinearGradient
          colors={[colors.dark.primary, colors.dark.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.gradient, disabled && { opacity: 0.5 }]}
        >
          <Text style={styles.secondaryTitle}>{title}</Text>
        </LinearGradient>
      </ScalePress>
    );
  }

  return (
    <AliveButton
      onPress={onPress}
      disabled={disabled}
      style={[styles.container, style, disabled && styles.disabled]}
      glowColor={PRIMARY_FILL}
      rippleColor="rgba(255, 255, 255, 0.42)"
      fillColor={PRIMARY_FILL}
      pressedFillColor={PRIMARY_FILL_PRESSED}
      colorDurationMs={200}
      glowInDurationMs={300}
      glowOutDurationMs={300}
      pressScale={1.0}
      screenKey={screenKey}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      testID={testID}
    >
      <View style={styles.primaryInner}>
        <Text style={styles.primaryTitle}>{title}</Text>
      </View>
    </AliveButton>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.md,
    overflow: "hidden",
  },
  disabled: {
    opacity: 0.5,
  },
  gradient: {
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryInner: {
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryTitle: {
    ...text.body,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    color: "#ffffff",
  },
  secondaryTitle: {
    ...text.body,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: colors.dark.background,
  },
});
