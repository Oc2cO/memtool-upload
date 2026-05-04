/**
 * Versus stats popover (Task #329) — surfaces per-level history vs Mem
 * (wins / losses / draws and current + best win streak). Shown as a
 * dismissable modal from the level ladder so the player can audit
 * their record without leaving the level select screen.
 */
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import type { VersusRecord } from "@/lib/gameStats";

interface VersusStatsModalProps {
  visible: boolean;
  level: number | null;
  record: VersusRecord | null;
  onClose: () => void;
}

export function VersusStatsModal({
  visible,
  level,
  record,
  onClose,
}: VersusStatsModalProps) {
  const colors = useColors();
  if (level == null) return null;

  const wins = record?.wins ?? 0;
  const losses = record?.losses ?? 0;
  const draws = record?.draws ?? 0;
  const total = wins + losses + draws;
  const currentStreak = record?.currentStreak ?? 0;
  const bestStreak = record?.bestStreak ?? 0;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        accessibilityLabel="Close versus stats"
        onPress={onClose}
      >
        <Pressable
          // Inner Pressable swallows taps so the modal doesn't dismiss
          // when the user taps the card itself.
          onPress={() => {}}
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.headerRow}>
            <Ionicons name="people" size={20} color={colors.accent} />
            <Text style={[styles.title, { color: colors.foreground }]}>
              Level {level} · Versus Mem
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={8}
            >
              <Ionicons name="close" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {total === 0 ? (
            <Text
              style={[styles.empty, { color: colors.mutedForeground }]}
              accessibilityLabel="No versus history yet for this level"
            >
              No matches yet — long-press the tile to challenge Mem.
            </Text>
          ) : (
            <>
              <View style={styles.row}>
                <StatCell label="Wins" value={wins} color={colors.primary} />
                <StatCell
                  label="Losses"
                  value={losses}
                  color={colors.destructive}
                />
                <StatCell
                  label="Draws"
                  value={draws}
                  color={colors.mutedForeground}
                />
              </View>
              <View style={styles.row}>
                <StatCell
                  label="Current streak"
                  value={currentStreak}
                  color={colors.accent}
                />
                <StatCell
                  label="Best streak"
                  value={bestStreak}
                  color={colors.accent}
                />
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function StatCell({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const colors = useColors();
  return (
    <View
      style={[styles.cell, { backgroundColor: colors.muted }]}
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={[styles.cellValue, { color }]}>{value}</Text>
      <Text style={[styles.cellLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    ...text.cardHeading,
    flex: 1,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  cell: {
    flex: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    gap: 2,
  },
  cellValue: {
    ...text.cardHeading,
  },
  cellLabel: {
    ...text.caption,
    textAlign: "center",
  },
  empty: {
    ...text.body,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
});
