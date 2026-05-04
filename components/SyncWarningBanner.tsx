import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";

/**
 * Surface banner shown at the top of the Archive tab when the outbox
 * has at least one entry that has been failing for ≥24h. The user can:
 *   - tap "Retry" to force an immediate drain attempt, or
 *   - tap the close icon to dismiss the banner for this session.
 *
 * The dismiss is in-memory only — if the entry still exists tomorrow
 * the banner returns. That's intentional: silent failure is the bug
 * we're guarding against, so we re-surface until the entry resolves.
 */

interface Props {
  count: number;
  onRetry: () => void;
  onDismiss: () => void;
}

export function SyncWarningBanner({ count, onRetry, onDismiss }: Props) {
  const colors = useColors();
  if (count <= 0) return null;
  const label =
    count === 1
      ? "1 memory couldn't sync"
      : `${count} memories couldn't sync`;
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      accessibilityRole="alert"
      accessibilityLabel={`${label} — tap to retry`}
    >
      <Ionicons
        name="cloud-offline-outline"
        size={18}
        color={colors.destructive}
        style={styles.icon}
      />
      <View style={styles.body}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          Tap retry to try again now.
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Retry sync"
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retry,
          { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.retryText, { color: colors.primaryForeground }]}>
          Retry
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Dismiss sync warning"
        onPress={onDismiss}
        hitSlop={10}
        style={styles.close}
      >
        <Ionicons name="close" size={18} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    // 14: deliberate one-off, between spacing.md (12) and spacing.base (16).
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.md,
    gap: 10,
  },
  icon: { marginRight: 2 },
  body: { flex: 1 },
  label: {
    ...text.helper,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  hint: {
    ...text.caption,
    marginTop: 2,
  },
  retry: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    // 8: deliberate one-off — small pill chip below radius.sm (12).
    borderRadius: 8,
  },
  retryText: {
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  close: {
    padding: 2,
  },
});
