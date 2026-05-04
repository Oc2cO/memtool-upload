// Bottom-sheet shown when the user taps "Pull up a good memory" on
// the MemMomentCard (Task #336). Read-only: a single memory card
// with Mem's caption, plus a quiet dismiss. Falls back to a gentle
// prompt when the library is too sparse for a meaningful pick.

import React from "react";
import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { MemCharacter } from "@/components/MemCharacter";
import { useColors } from "@/hooks/useColors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

export interface RecallMemorySheetProps {
  visible: boolean;
  /** The memory content to surface. Null → render the fallback
   *  prompt for sparse libraries. */
  memoryContent: string | null;
  /** Optional ISO timestamp shown as a quiet caption under the
   *  memory text. */
  memoryTimestamp?: string | null;
  onClose: () => void;
  /** Optional tertiary "Talk to Mem" affordance shown only on the
   *  fallback (sparse-library) state — keeps a path open without
   *  pulling chat into this surface. */
  onTalkToMem?: () => void;
}

function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
  if (days === 0) return "Earlier today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export function RecallMemorySheet({
  visible,
  memoryContent,
  memoryTimestamp,
  onClose,
  onTalkToMem,
}: RecallMemorySheetProps) {
  const colors = useColors();
  const hasMemory = memoryContent !== null && memoryContent.trim().length > 0;
  const relative = formatRelative(memoryTimestamp);

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
            <View style={styles.memRow}>
              <MemCharacter size={48} expression="calm" />
              <Text
                style={[styles.caption, { color: colors.foreground }]}
                numberOfLines={2}
              >
                {hasMemory
                  ? "Remember this one?"
                  : "Tell me about a moment you'd like to remember more often."}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {hasMemory ? (
            <ScrollView
              style={styles.memoryScroll}
              contentContainerStyle={styles.memoryBody}
            >
              <Text style={[styles.memoryText, { color: colors.foreground }]}>
                {memoryContent}
              </Text>
              {relative !== null && (
                <Text
                  style={[
                    styles.memoryMeta,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {relative}
                </Text>
              )}
            </ScrollView>
          ) : (
            <View style={styles.fallbackBody}>
              <Text
                style={[styles.fallbackHint, { color: colors.mutedForeground }]}
              >
                Your library is still small. Even one good moment, written
                down, helps next time.
              </Text>
              {onTalkToMem && (
                <Pressable
                  onPress={onTalkToMem}
                  style={styles.talkLink}
                  accessibilityRole="button"
                  accessibilityLabel="Talk to Mem"
                >
                  <Text
                    style={[styles.talkLinkText, { color: colors.primary }]}
                  >
                    Talk to Mem instead →
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          <Pressable
            onPress={onClose}
            style={[styles.doneButton, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text
              style={[styles.doneText, { color: colors.primaryForeground }]}
            >
              Thanks, Mem
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
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.base,
  },
  memRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.base,
  },
  caption: { ...text.bodySemibold, flex: 1 },
  memoryScroll: { maxHeight: 220 },
  memoryBody: { gap: spacing.sm },
  memoryText: { ...text.bodySemibold, lineHeight: 22, fontWeight: "400" },
  memoryMeta: { ...text.helperRegular },
  fallbackBody: { gap: spacing.base },
  fallbackHint: { ...text.helperRegular, lineHeight: 20 },
  talkLink: { paddingVertical: spacing.xs },
  talkLinkText: { ...text.bodySemibold },
  doneButton: {
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  doneText: { ...text.bodySemibold },
});
