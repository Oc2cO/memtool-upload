// Bottom-sheet style breathing modal opened from MemMomentCard's
// "Breathe with me" action (Task #336). Wraps the existing
// `BreatheCard` (which provides the gentle pulse animation) with a
// guided "Breathe in / Hold / Out" cue and a clean dismiss path.
// Intentionally tiny — the heavy lifting is the calm presentation,
// not a new exercise library.

import React, { useEffect, useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { BreatheCard } from "@/components/alive/BreatheCard";
import { MemCharacter } from "@/components/MemCharacter";
import { useColors } from "@/hooks/useColors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const PHASES: { label: string; duration: number }[] = [
  { label: "Breathe in", duration: 4000 },
  { label: "Hold", duration: 2000 },
  { label: "Breathe out", duration: 6000 },
];

export function BreatheModal({ visible, onClose }: Props) {
  const colors = useColors();
  const [phaseIdx, setPhaseIdx] = useState(0);

  useEffect(() => {
    if (!visible) {
      setPhaseIdx(0);
      return;
    }
    const t = setTimeout(
      () => setPhaseIdx((i) => (i + 1) % PHASES.length),
      PHASES[phaseIdx]?.duration ?? 4000,
    );
    return () => clearTimeout(t);
  }, [visible, phaseIdx]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              A minute with Mem
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close breathing exercise"
            >
              <Ionicons name="close" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          <BreatheCard style={styles.breatheRow}>
            <MemCharacter size={140} expression="calm" />
          </BreatheCard>

          <Text style={[styles.cue, { color: colors.primary }]}>
            {PHASES[phaseIdx]?.label ?? "Breathe in"}
          </Text>

          <Pressable
            onPress={onClose}
            style={[styles.doneButton, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Finish"
          >
            <Text
              style={[styles.doneText, { color: colors.primaryForeground }]}
            >
              I'm done
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xlTight,
    alignItems: "center",
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  title: { ...text.sectionTitle },
  breatheRow: { alignItems: "center", paddingVertical: spacing.base },
  cue: { ...text.bodySemibold, fontSize: 22 },
  doneButton: {
    paddingHorizontal: spacing.xlTight,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  doneText: { ...text.bodySemibold },
});
