import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { GradientButton } from "@/components/GradientButton";
import { useColors } from "@/hooks/useColors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

export interface ChallengeResultOverlayProps {
  visible: boolean;
  /** Display name of the friend who sent the challenge. */
  senderName: string;
  /** Score the sender posted on this seed. */
  senderScore: number;
  /** Score the local player just finished with. */
  yourScore: number;
  /** Replay the exact same seed so the head-to-head still lines up. */
  onRematch: () => void;
  /** Re-open the share sheet with the local player's new score. */
  onSendBack: () => void;
  /** Dismiss the overlay (returns to the underlying done screen). */
  onDone: () => void;
}

/**
 * End-of-round head-to-head overlay shown when the round was opened
 * via a friend-challenge deep link (Task #356).
 *
 * Closes the share-loop: we re-state the score gap with the sender's
 * name, then offer Rematch (same seed) / Send your score back
 * (re-share with the new score) / Done. Analytics for the two CTAs
 * (`challenge_rematched`, `challenge_returned`) are fired by the
 * route — this component is presentation only so the same overlay
 * works for all four skill games.
 */
export function ChallengeResultOverlay({
  visible,
  senderName,
  senderScore,
  yourScore,
  onRematch,
  onSendBack,
  onDone,
}: ChallengeResultOverlayProps) {
  const colors = useColors();
  if (!visible) return null;

  const diff = yourScore - senderScore;
  const headline =
    diff > 0
      ? `You beat ${senderName} by ${diff}!`
      : diff < 0
        ? `${senderName} is ahead by ${-diff}.`
        : `Dead even with ${senderName}.`;
  const subline = `You scored ${yourScore} vs ${senderName}'s ${senderScore} — beat them?`;

  return (
    <View
      style={[styles.overlay, { backgroundColor: "rgba(10, 6, 18, 0.85)" }]}
      accessibilityViewIsModal
      accessibilityLabel={`${headline} ${subline}`}
    >
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text
          style={[
            styles.title,
            { color: diff >= 0 ? colors.primary : colors.destructive },
          ]}
        >
          {headline}
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          {subline}
        </Text>

        <View style={styles.scoreRow}>
          <View style={styles.scoreCell}>
            <Text
              style={[styles.scoreLabel, { color: colors.mutedForeground }]}
            >
              You
            </Text>
            <Text style={[styles.scoreValue, { color: colors.foreground }]}>
              {yourScore}
            </Text>
          </View>
          <Text style={[styles.vs, { color: colors.mutedForeground }]}>vs</Text>
          <View style={styles.scoreCell}>
            <Text
              style={[styles.scoreLabel, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {senderName}
            </Text>
            <Text style={[styles.scoreValue, { color: colors.foreground }]}>
              {senderScore}
            </Text>
          </View>
        </View>

        <GradientButton
          title="Rematch"
          onPress={onRematch}
          style={styles.primaryBtn}
        />
        <Pressable
          onPress={onSendBack}
          style={[
            styles.secondaryCta,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send your score back"
        >
          <Text
            style={[text.bodySemibold, { color: colors.foreground }]}
          >
            Send your score back
          </Text>
        </Pressable>
        <Pressable
          onPress={onDone}
          style={styles.tertiaryBtn}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text
            style={[text.helperRegular, { color: colors.mutedForeground }]}
          >
            Done
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    padding: spacing.lg,
  },
  card: {
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
    width: "100%",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  body: {
    ...text.body,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
    gap: spacing.md,
    width: "100%",
  },
  scoreCell: {
    flex: 1,
    alignItems: "center",
  },
  scoreLabel: {
    ...text.helperRegular,
    marginBottom: spacing.xs,
  },
  scoreValue: {
    fontSize: 32,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  vs: {
    ...text.helperRegular,
    paddingHorizontal: spacing.sm,
  },
  primaryBtn: { width: "100%", marginTop: spacing.xs },
  secondaryCta: {
    width: "100%",
    marginTop: spacing.sm,
    paddingVertical: spacing.base,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  tertiaryBtn: {
    marginTop: spacing.base,
    paddingVertical: spacing.sm,
  },
});
