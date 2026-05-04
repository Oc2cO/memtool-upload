import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MemCharacter } from "@/components/MemCharacter";
import { useColors } from "@/hooks/useColors";
import { spacing, radius } from "@/constants/spacing";
import {
  recoverStreak,
  recoveryCopy,
  type StreakSnapshot,
} from "@/lib/streak";

interface StreakRecoveryCardProps {
  streak: StreakSnapshot;
  onRecovered: (next: StreakSnapshot) => void;
  onDismissed?: () => void;
}

/**
 * Gentle "log yesterday" recovery card. Surfaces only when the
 * server has marked the user as recover-eligible (the
 * `pendingRecoveryFor` field is set on the snapshot). Mem appears
 * in her `waiting` state — quietly here, no guilt — and a single
 * tap restores the streak honestly.
 *
 * The card is dismissible: a user who'd rather just start fresh
 * can swipe past without being nagged.
 */
export function StreakRecoveryCard({
  streak,
  onRecovered,
  onDismissed,
}: StreakRecoveryCardProps) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!streak.pendingRecoveryFor) return null;
  const copy = recoveryCopy();

  const handleRecover = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const outcome = await recoverStreak();
    setBusy(false);
    if (outcome.kind === "ok") {
      onRecovered(outcome.streak);
      return;
    }
    if (outcome.kind === "expired" || outcome.kind === "no_offer") {
      // Server says the offer's gone — dismiss instead of leaving a
      // dead button on screen.
      onDismissed?.();
      return;
    }
    setError("Couldn't reach the server. Try again in a moment.");
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      accessibilityLabel="Streak recovery available"
    >
      <View style={styles.memSlot}>
        <MemCharacter size={64} expression="waiting" />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {copy.title}
        </Text>
        <Text style={[styles.text, { color: colors.mutedForeground }]}>
          {copy.body}
        </Text>
        {error !== null && (
          <Text style={[styles.error, { color: colors.destructive }]}>
            {error}
          </Text>
        )}
        <View style={styles.actions}>
          <Pressable
            onPress={handleRecover}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={copy.cta}
            style={[
              styles.primaryCta,
              {
                backgroundColor: colors.primary,
                opacity: busy ? 0.6 : 1,
              },
            ]}
          >
            <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
              {busy ? "…" : copy.cta}
            </Text>
          </Pressable>
          {onDismissed && (
            <Pressable
              onPress={onDismissed}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              style={styles.secondaryCta}
            >
              <Text style={[styles.secondaryText, { color: colors.mutedForeground }]}>
                Not today
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  memSlot: {
    paddingTop: 4,
  },
  body: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    fontSize: 13,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    alignItems: "center",
  },
  primaryCta: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  primaryText: {
    fontSize: 14,
    fontWeight: "600",
  },
  secondaryCta: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  secondaryText: {
    fontSize: 13,
  },
});

export default StreakRecoveryCard;
