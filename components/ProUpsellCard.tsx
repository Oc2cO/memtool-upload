import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { AliveButton } from "@/components/alive/AliveButton";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";

interface ProUpsellCardProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  ctaLabel?: string;
}

/**
 * Single, reusable upsell surface used wherever a non-Pro user hits a
 * Pro-only feature (capture cap, smarter recap extras, cloud sync).
 *
 * The card always deep-links to `/subscription` — the one place Task #22
 * wired up for actual upgrade. Centralizing it here keeps the upsell
 * copy/visual style consistent and means a future tweak (e.g. swapping
 * the CTA for a paywall modal) is a one-file change.
 */
export function ProUpsellCard({
  icon = "sparkles",
  title,
  body,
  ctaLabel = "Upgrade to Pro",
}: ProUpsellCardProps) {
  const colors = useColors();
  const router = useRouter();

  const handlePress = () => {
    // Navigation tap to the paywall — upgrade success haptic fires
    // inside the subscription flow.
    Haptics.selectionAsync().catch(() => {});
    router.push("/subscription");
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.secondary, borderColor: colors.primary },
      ]}
    >
      <View style={styles.header}>
        <Ionicons name={icon} size={18} color={colors.primary} />
        <Text style={[styles.title, { color: colors.primary }]}>{title}</Text>
      </View>
      <Text style={[styles.body, { color: colors.foreground }]}>{body}</Text>
      <AliveButton
        onPress={handlePress}
        style={styles.ctaWrapper}
        glowColor="#a78bfa"
        glowIntensity={0.7}
        screenKey="upsell"
        accessibilityLabel={ctaLabel}
      >
        <LinearGradient
          colors={["#a78bfa", "#5eead4"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.ctaButton}
        >
          <Ionicons name="rocket-outline" size={16} color="#0a0612" />
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </LinearGradient>
      </AliveButton>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // 20: deliberate one-off, slightly larger than radius.md (16) but
    // smaller than radius.lg (24) — matches the upsell card's softer
    // feel called out in the design audit.
    borderRadius: 20,
    borderWidth: 1,
    padding: spacing.lgCard,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    ...text.helper,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  body: {
    // 15: deliberate one-off, between text.helper (14) and text.body (16)
    // — keeps the upsell body visually softer than mainline copy.
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
    marginBottom: spacing.base,
  },
  ctaWrapper: { borderRadius: radius.sm, overflow: "hidden", alignSelf: "flex-start" },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    // 10: deliberate one-off, between spacing.sm (8) and spacing.md (12),
    // tunes the CTA height to match the icon size.
    paddingVertical: 10,
  },
  ctaText: {
    color: "#0a0612",
    ...text.helper,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
});
