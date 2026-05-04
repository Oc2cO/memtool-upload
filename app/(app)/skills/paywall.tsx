import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useSkills } from "@/context/SkillsContext";
import {
  SKILLS,
  SKILLS_BUNDLE_ENTITLEMENT_KEY,
  SKILLS_BUNDLE_PRODUCT_ID,
  SKILLS_BUNDLE_PRICE_USD,
  SKILL_INDIVIDUAL_PRICE_USD,
  getSkill,
  type SkillId,
} from "@/lib/skillsBundle";
import {
  isRevenueCatConfigured,
  purchaseSkillsProduct,
  restoreApplePurchases,
} from "@/lib/revenuecat";
import { trackEvent } from "@/lib/analytics";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

export default function SkillsPaywallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ skillId?: string }>();
  const focusedSkill = params.skillId
    ? SKILLS.find((s) => s.id === params.skillId)
    : null;
  const { refresh, optimisticallyAdd } = useSkills();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    trackEvent("paywall_viewed", {
      skillId: focusedSkill?.id ?? null,
    });
  }, [focusedSkill?.id]);

  const finishPurchase = async (entitlementKey: string, sku: string) => {
    optimisticallyAdd(entitlementKey);
    trackEvent("paywall_purchased", { sku, entitlementKey });
    await refresh();
    router.back();
  };

  const onBundle = async () => {
    if (!isRevenueCatConfigured()) {
      Alert.alert(
        "App Store purchases coming soon",
        "Once Skills are wired into the store you'll be able to unlock the bundle here.",
      );
      return;
    }
    setBusy("bundle");
    try {
      const result = await purchaseSkillsProduct(SKILLS_BUNDLE_PRODUCT_ID);
      if (result.ok) {
        await finishPurchase(
          SKILLS_BUNDLE_ENTITLEMENT_KEY,
          SKILLS_BUNDLE_PRODUCT_ID,
        );
      } else if (result.reason === "cancelled") {
        // Quiet — Apple sheet already gave feedback.
      } else if (
        result.reason === "not_configured" ||
        result.reason === "no_offering"
      ) {
        Alert.alert(
          "Coming soon",
          "Skills purchases aren't quite ready yet. Try again later.",
        );
      } else {
        Alert.alert("Couldn't complete purchase", "Try again in a moment.");
      }
    } finally {
      setBusy(null);
    }
  };

  const onSingleSkill = async (skillId: SkillId) => {
    if (!isRevenueCatConfigured()) {
      Alert.alert(
        "App Store purchases coming soon",
        "Once Skills are wired into the store you'll be able to unlock individual games here.",
      );
      return;
    }
    const skill = getSkill(skillId);
    setBusy(skillId);
    try {
      const result = await purchaseSkillsProduct(skill.productId);
      if (result.ok) {
        await finishPurchase(skill.entitlementKey, skill.productId);
      } else if (result.reason === "cancelled") {
        // Quiet.
      } else {
        Alert.alert(
          "Couldn't complete purchase",
          "Try again in a moment, or grab the bundle instead.",
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const onRestore = async () => {
    trackEvent("restore_tapped", { from: "skills_paywall" });
    setBusy("restore");
    try {
      const result = await restoreApplePurchases();
      if (result.ok) {
        await refresh();
        Alert.alert("Restored", "Any past purchases are now active.");
      } else if (result.reason === "not_configured") {
        Alert.alert(
          "App Store purchases coming soon",
          "Restore will be available once Skills are wired into the store.",
        );
      } else {
        Alert.alert("Couldn't restore", "Try again in a moment.");
      }
    } finally {
      setBusy(null);
    }
  };

  const skillsToList = focusedSkill ? [focusedSkill] : SKILLS;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close paywall"
          hitSlop={12}
          style={styles.backBtn}
        >
          <Ionicons name="close" size={26} color={colors.foreground} />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <Text style={[text.screenTitle, { color: colors.foreground }]}>
          {focusedSkill ? `Unlock ${focusedSkill.title}` : "Unlock Skills"}
        </Text>
        <Text
          style={[
            text.body,
            { color: colors.mutedForeground, marginVertical: spacing.md },
          ]}
        >
          One-time purchase. No subscription. Pro members keep access on every
          device they sign into.
        </Text>

        <Pressable
          onPress={onBundle}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel={`Buy bundle for $${SKILLS_BUNDLE_PRICE_USD.toFixed(2)}`}
          style={[
            styles.bundleCta,
            {
              backgroundColor: colors.primary,
              borderRadius: radius.md,
              opacity: busy && busy !== "bundle" ? 0.5 : 1,
            },
          ]}
        >
          <Text
            style={[
              text.cardHeading,
              { color: colors.primaryForeground ?? "#fff" },
            ]}
          >
            {busy === "bundle"
              ? "Opening App Store…"
              : `Skills Bundle — $${SKILLS_BUNDLE_PRICE_USD.toFixed(2)}`}
          </Text>
          <Text
            style={[
              text.caption,
              { color: colors.primaryForeground ?? "#fff", opacity: 0.9 },
            ]}
          >
            All four games. Best value.
          </Text>
        </Pressable>

        <Text
          style={[
            text.captionStrong,
            {
              color: colors.mutedForeground,
              marginTop: spacing.lg,
              marginBottom: spacing.sm,
            },
          ]}
        >
          OR PICK ONE — ${SKILL_INDIVIDUAL_PRICE_USD.toFixed(2)} EACH
        </Text>
        <View style={styles.skillRows}>
          {skillsToList.map((skill) => (
            <Pressable
              key={skill.id}
              onPress={() => onSingleSkill(skill.id)}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel={`Buy ${skill.title} for $${SKILL_INDIVIDUAL_PRICE_USD.toFixed(2)}`}
              style={[
                styles.skillRow,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  borderRadius: radius.sm,
                  opacity: busy && busy !== skill.id ? 0.5 : 1,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[text.bodySemibold, { color: colors.foreground }]}>
                  {skill.title}
                </Text>
                <Text
                  style={[
                    text.helperRegular,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {skill.tagline}
                </Text>
              </View>
              <Text style={[text.bodySemibold, { color: colors.primary }]}>
                {busy === skill.id
                  ? "…"
                  : `$${SKILL_INDIVIDUAL_PRICE_USD.toFixed(2)}`}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={onRestore}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel="Restore purchases"
          style={styles.restoreBtn}
        >
          <Text style={[text.bodyMedium, { color: colors.primary }]}>
            {busy === "restore" ? "Restoring…" : "Restore purchases"}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  scroll: { paddingHorizontal: spacing.lg },
  bundleCta: {
    padding: spacing.lg,
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  skillRows: { gap: spacing.sm },
  skillRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  restoreBtn: {
    alignSelf: "center",
    marginTop: spacing.xl,
    padding: spacing.md,
  },
});
