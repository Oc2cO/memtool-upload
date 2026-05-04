// MemMomentCard — Mem's real-time response when the user logs a low
// mood (Task #336). Pure presentational: the parent owns the
// "trigger / dismiss / pick action" logic and the analytics. This
// card's only job is to render the warm acknowledgement, the three
// action buttons in profile-aware order, and the calm
// "Just sit with me" / "Not now" affordances.

import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { MemCharacter } from "@/components/MemCharacter";
import { useColors } from "@/hooks/useColors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import {
  memMomentActionCopy,
  memMomentHeadline,
  orderMemMomentActions,
  type MemMomentAction,
} from "@/lib/moodMoment";
import type {
  UserProfile,
  UserProfileEmpty,
} from "@workspace/api-client-react";

export interface MemMomentCardProps {
  /** Resolved profile from `useProfile()`. May be `null` when the
   *  user hasn't completed onboarding — falls back to neutral copy. */
  profile: UserProfile | UserProfileEmpty | null;
  /** First-name source (typically `user.display_name`). The card
   *  uses just the first token when ≤ 24 chars; otherwise stays
   *  unpersonalised. */
  displayName?: string | null;
  onBreathe: () => void;
  onRecall: () => void;
  onSit: () => void;
  /** "Not now — just saving" — dismisses for the rest of the day. */
  onSkip: () => void;
}

const ACTION_ICONS: Record<MemMomentAction, keyof typeof Ionicons.glyphMap> = {
  breathe: "leaf-outline",
  recall: "heart-outline",
  sit: "moon-outline",
};

export function MemMomentCard({
  profile,
  displayName,
  onBreathe,
  onRecall,
  onSit,
  onSkip,
}: MemMomentCardProps) {
  const colors = useColors();
  const order = orderMemMomentActions(profile);
  const headline = memMomentHeadline(displayName, profile);

  const handlers: Record<MemMomentAction, () => void> = {
    breathe: onBreathe,
    recall: onRecall,
    sit: onSit,
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      accessibilityRole="summary"
    >
      <View style={styles.memRow}>
        <MemCharacter size={72} expression="calm" />
      </View>
      <Text style={[styles.headline, { color: colors.foreground }]}>
        {headline}
      </Text>

      <View style={styles.actionsCol}>
        {order.map((key) => {
          const copy = memMomentActionCopy(key, profile);
          return (
            <Pressable
              key={key}
              onPress={handlers[key]}
              style={({ pressed }) => [
                styles.actionRow,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={copy.label}
              accessibilityHint={copy.hint}
            >
              <Ionicons
                name={ACTION_ICONS[key]}
                size={20}
                color={colors.primary}
              />
              <View style={styles.actionTextCol}>
                <Text
                  style={[styles.actionLabel, { color: colors.foreground }]}
                >
                  {copy.label}
                </Text>
                <Text
                  style={[styles.actionHint, { color: colors.mutedForeground }]}
                >
                  {copy.hint}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.mutedForeground}
              />
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={onSkip}
        hitSlop={8}
        style={styles.skipRow}
        accessibilityRole="button"
        accessibilityLabel="Not now — just saving"
      >
        <Text style={[styles.skipText, { color: colors.mutedForeground }]}>
          Not now — just saving
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  memRow: {
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  headline: {
    ...text.bodySemibold,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  actionsCol: {
    gap: spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.base,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
  },
  actionTextCol: { flex: 1 },
  actionLabel: { ...text.bodySemibold },
  actionHint: { ...text.helperRegular, marginTop: 2 },
  skipRow: {
    alignItems: "center",
    marginTop: spacing.base,
    paddingVertical: spacing.sm,
  },
  skipText: { ...text.helperRegular, textDecorationLine: "underline" },
});
