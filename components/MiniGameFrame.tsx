import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

/**
 * Shared chrome for every Companion Skills mini-game (Task #337).
 *
 * Provides:
 *   - Safe-area-aware top bar with back button and skill title
 *   - Score / round indicator slot
 *   - Body slot (the actual play surface)
 *   - Footer slot (action button row, e.g. Restart / Share challenge)
 *
 * Deliberately minimal. As of Task #357, Memory Match and 24 Game
 * also render through this frame, so all six mini-games share the
 * same chrome (back button, title, scoring pill, footer CTAs).
 */
export interface MiniGameFrameProps {
  title: string;
  subtitle?: string | null;
  /** Top-right slot — typically score badge or round counter. */
  topRight?: React.ReactNode;
  /** Stretchy play surface. */
  children: React.ReactNode;
  /** Action row at the bottom (sticks above safe-area). */
  footer?: React.ReactNode;
  /** Override default back behaviour (router.back()). */
  onBack?: () => void;
  /** Container background — defaults to colors.background. */
  backgroundStyle?: StyleProp<ViewStyle>;
}

export function MiniGameFrame({
  title,
  subtitle,
  topRight,
  children,
  footer,
  onBack,
  backgroundStyle,
}: MiniGameFrameProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleBack = () => {
    if (onBack) onBack();
    else router.back();
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background },
        backgroundStyle,
      ]}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + spacing.sm,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text
            style={[text.cardLabel, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[text.caption, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.topRight}>{topRight}</View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          {
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>

      {footer ? (
        <View
          style={[
            styles.footer,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
              paddingBottom: insets.bottom + spacing.md,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  titleWrap: { flex: 1, marginLeft: spacing.xs },
  topRight: { minWidth: 64, alignItems: "flex-end" },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    flexGrow: 1,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
  },
});

export interface ScorePillProps {
  label: string;
  value: number | string;
}

export function ScorePill({ label, value }: ScorePillProps) {
  const colors = useColors();
  return (
    <View
      style={[
        pillStyles.pill,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[text.caption, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text style={[text.bodySemibold, { color: colors.foreground }]}>
        {String(value)}
      </Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    minWidth: 64,
  },
});
