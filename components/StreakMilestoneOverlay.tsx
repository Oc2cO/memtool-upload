import React, { useEffect } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { MemCharacter } from "@/components/MemCharacter";
import { useColors } from "@/hooks/useColors";
import { spacing, radius } from "@/constants/spacing";
import {
  ackMilestoneSeen,
  milestoneCopy,
  trackStreakMilestone,
} from "@/lib/streak";

interface StreakMilestoneOverlayProps {
  milestone: number | null;
  onDismiss: () => void;
}

/**
 * Celebration moment for a freshly-crossed streak milestone.
 *
 * Per the brand guide and the Mem-emotional-states task: Mem
 * appears in her `celebrate` expression (sparkle crown + arched
 * eyes), and the celebration scales with the milestone size — a
 * three-day moment reads as a soft "tiny win", a hundred-day
 * moment as a real, gentle ceremony. Never bro-energy, never loud.
 *
 * Acks the milestone server-side on dismiss so the overlay never
 * re-fires on a relaunch (the server caps to current, so a client
 * can't ack a milestone it hasn't earned).
 */
export function StreakMilestoneOverlay({
  milestone,
  onDismiss,
}: StreakMilestoneOverlayProps) {
  const colors = useColors();

  useEffect(() => {
    if (milestone !== null) {
      trackStreakMilestone(milestone);
    }
  }, [milestone]);

  if (milestone === null) return null;
  const { title, body } = milestoneCopy(milestone);
  // Scale Mem with the milestone — tiny three-day, generous hundred.
  const memSize = milestone >= 60 ? 180 : milestone >= 14 ? 150 : 120;

  const handleClose = () => {
    void ackMilestoneSeen(milestone).catch(() => {
      /* best-effort — server will catch up on next read */
    });
    onDismiss();
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          onPress={() => {
            /* swallow press so the inner card doesn't dismiss */
          }}
        >
          <View style={styles.memSlot}>
            <MemCharacter size={memSize} mood="celebrate" />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>{body}</Text>
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Dismiss celebration"
            style={[styles.cta, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>
              Thank you, Mem
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(8, 6, 18, 0.78)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.md,
  },
  memSlot: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  cta: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    alignSelf: "stretch",
    alignItems: "center",
  },
  ctaText: {
    fontSize: 15,
    fontWeight: "600",
  },
});

export default StreakMilestoneOverlay;
