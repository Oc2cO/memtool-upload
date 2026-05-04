// "Mem noticed…" card on the Home tab. Renders one rotating insight
// drawn from the on-device patterns envelope and offers a tap-target
// to /insights for the full picture, plus a "How Mem knows"
// disclosure that explains the on-device privacy story.
//
// The component is intentionally read-only: it never triggers a
// patterns rebuild or an embed call. MemoriesContext.maintainAiEngine
// is the only place that mutates engine state. We just paint what's
// already in AsyncStorage. That's why the card stays cheap to mount
// and re-mount — it's a `loadStoredPatterns` call plus a pure
// selector, nothing that touches the network.

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";

import { LiftPress } from "@/components/alive/LiftPress";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { loadStoredPatterns } from "@/lib/aiEngineStorage";
import type { PatternsEnvelope } from "@/lib/aiEngine";
import { pickHomeInsight, type HomeInsight } from "@/lib/homeInsight";

const KIND_ICON: Record<HomeInsight["kind"], keyof typeof Ionicons.glyphMap> = {
  top_theme: "color-palette",
  weekday_best: "calendar",
  top_person: "person",
  mood_trend: "trending-up",
  recurring_theme: "infinite",
  cold_start: "leaf-outline",
};

function renderTemplate(
  insight: HomeInsight,
  styles: { plain: object; highlight: object },
): React.ReactElement {
  // Templates use a single `{HL}` placeholder so we can colour the
  // highlight span without forcing the selector to know about UI.
  // Cold-start has no placeholder → renders straight through.
  const idx = insight.template.indexOf("{HL}");
  if (idx === -1 || insight.highlight.length === 0) {
    return <Text style={styles.plain}>{insight.template}</Text>;
  }
  const before = insight.template.slice(0, idx);
  const after = insight.template.slice(idx + 4);
  return (
    <Text style={styles.plain}>
      {before}
      <Text style={styles.highlight}>{insight.highlight}</Text>
      {after}
    </Text>
  );
}

export function MemNoticedCard() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const [patterns, setPatterns] = useState<PatternsEnvelope | null>(null);
  const [showHow, setShowHow] = useState(false);

  const loadPatterns = useCallback(async () => {
    if (!user?.email) {
      setPatterns(null);
      return;
    }
    const env = await loadStoredPatterns<PatternsEnvelope>(user.email);
    setPatterns(env);
  }, [user?.email]);

  useEffect(() => {
    void loadPatterns();
  }, [loadPatterns]);

  // Refresh on focus so a patterns rebuild that finishes while the
  // user is on another tab shows up the next time they open Home,
  // without us needing to subscribe to engine events.
  useFocusEffect(
    useCallback(() => {
      void loadPatterns();
    }, [loadPatterns]),
  );

  const insight = pickHomeInsight(patterns);

  const handleSeeMore = () => {
    // Navigation taps (this + handleHow) — raw selection is correct.
    Haptics.selectionAsync().catch(() => {});
    router.push("/insights");
  };

  const handleHow = () => {
    Haptics.selectionAsync().catch(() => {});
    setShowHow(true);
  };

  const textStyles = {
    plain: { ...styles.copyPlain, color: colors.foreground },
    highlight: { ...styles.copyHighlight, color: colors.primary },
  };

  return (
    <LiftPress
      onPress={handleSeeMore}
      style={styles.cardOuter}
      // Intentionally NOT passing `liftShadow` — this card is a
      // translucent gradient (LinearGradient w/ rgba fills) rather than
      // a solid surface, so a press-time shadow bump would darken the
      // canvas behind the gradient and read as out-of-place. See
      // attached_assets/research/mercury-interaction-design.md §7.3
      // Recipe E for the rationale.
      accessibilityRole="button"
      accessibilityLabel={`Mem noticed insight: ${insight.template.replace("{HL}", insight.highlight)}. Tap for more.`}
    >
      <LinearGradient
        colors={["rgba(167, 139, 250, 0.20)", "rgba(94, 234, 212, 0.10)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.cardGradient, { borderColor: colors.border }]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Ionicons name={KIND_ICON[insight.kind]} size={16} color="#a78bfa" />
            <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>
              Mem noticed
            </Text>
          </View>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              handleHow();
            }}
            hitSlop={10}
            accessibilityLabel="How Mem knows"
          >
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={colors.mutedForeground}
            />
          </Pressable>
        </View>

        <View style={styles.copyWrap}>
          {renderTemplate(insight, textStyles)}
        </View>

        <View style={styles.cardFooter}>
          <Text style={[styles.cardCta, { color: colors.accent }]}>
            See more from Mem
          </Text>
          <Ionicons name="arrow-forward" size={14} color={colors.accent} />
        </View>
      </LinearGradient>

      <Modal
        visible={showHow}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHow(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowHow(false)}
        >
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={() => {}}
          >
            <View style={styles.modalHeader}>
              <Ionicons name="lock-closed" size={18} color={colors.primary} />
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                How Mem knows
              </Text>
            </View>
            <Text
              style={[styles.modalBody, { color: colors.mutedForeground }]}
            >
              Your memories are sent to MemTool's secure backend, which
              turns each one into a small numerical fingerprint
              (called an embedding) and computes the patterns you see
              here — top themes, people, weekday mood. A copy of those
              patterns is mirrored to this device so the card paints
              instantly, even offline. The server is the source of
              truth; you can clear the local mirror anytime in
              Settings.
            </Text>
            <Pressable
              onPress={() => {
                setShowHow(false);
                router.push("/settings");
              }}
              style={[styles.modalManage, { borderColor: colors.primary }]}
              accessibilityLabel="Manage Mem AI cache in Settings"
            >
              <Text style={[styles.modalManageText, { color: colors.primary }]}>
                Manage in Settings
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setShowHow(false)}
              style={styles.modalClose}
              accessibilityLabel="Close"
            >
              <Text style={[styles.modalCloseText, { color: colors.mutedForeground }]}>
                Close
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </LiftPress>
  );
}

const styles = StyleSheet.create({
  cardOuter: {
    marginBottom: spacing.lgCard,
    // 18: deliberate one-off, between radius.md (16) and radius.lg (24).
    borderRadius: 18,
    overflow: "hidden",
  },
  cardGradient: {
    // 18: deliberate one-off, between spacing.base (16) and spacing.lgCard (20).
    padding: 18,
    // 18: deliberate one-off, between radius.md (16) and radius.lg (24).
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardLabel: {
    ...text.caption,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  copyWrap: { paddingVertical: 2 },
  copyPlain: {
    ...text.bodyMedium,
    lineHeight: 22,
  },
  copyHighlight: {
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  cardCta: {
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.lgCard,
    gap: 14,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  modalTitle: {
    ...text.body,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  modalBody: {
    ...text.helperRegular,
    lineHeight: 20,
  },
  modalManage: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  modalManageText: {
    ...text.helper,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  modalClose: { paddingVertical: 6, alignItems: "center" },
  modalCloseText: {
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
});
