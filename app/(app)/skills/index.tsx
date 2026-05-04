import React, { useEffect } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useSkills } from "@/context/SkillsContext";
import {
  SKILLS,
  SKILLS_BUNDLE_PRICE_USD,
  isSkillUnlocked,
  ownsBundle,
  type SkillDefinition,
} from "@/lib/skillsBundle";
import { trackEvent } from "@/lib/analytics";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

export default function SkillsHomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { owned, refresh } = useSkills();

  useEffect(() => {
    trackEvent("skills_home_viewed", {
      ownsBundle: ownsBundle(owned),
      ownedCount: owned.size,
    });
    void refresh();
    // refresh on mount only — don't loop on owned changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTile = (skill: SkillDefinition) => {
    trackEvent("skill_opened", {
      skillId: skill.id,
      unlocked: isSkillUnlocked(skill, owned),
    });
    if (isSkillUnlocked(skill, owned)) {
      router.push(skill.route);
    } else {
      router.push({
        pathname: "/skills/paywall",
        params: { skillId: skill.id },
      });
    }
  };

  const onBundleCta = () => {
    trackEvent("paywall_viewed", { from: "skills_home" });
    router.push("/skills/paywall");
  };

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
          accessibilityLabel="Back"
          hitSlop={12}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </Pressable>
        <Text style={[text.screenTitle, { color: colors.foreground }]}>
          Skills
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <Text
          style={[
            text.body,
            { color: colors.mutedForeground, marginBottom: spacing.lg },
          ]}
        >
          Four short brain games. Play solo or send a round to a friend.
        </Text>

        {!ownsBundle(owned) ? (
          <Pressable
            onPress={onBundleCta}
            accessibilityRole="button"
            accessibilityLabel={`Unlock all four skills for $${SKILLS_BUNDLE_PRICE_USD.toFixed(2)}`}
            style={[
              styles.bundleCta,
              {
                backgroundColor: colors.primary,
                borderRadius: radius.md,
              },
            ]}
          >
            <Text
              style={[
                text.cardHeading,
                { color: colors.primaryForeground ?? "#fff" },
              ]}
            >
              Unlock all 4 — ${SKILLS_BUNDLE_PRICE_USD.toFixed(2)}
            </Text>
            <Text
              style={[
                text.caption,
                { color: colors.primaryForeground ?? "#fff", opacity: 0.9 },
              ]}
            >
              One-time purchase. Or unlock just one for $0.99.
            </Text>
          </Pressable>
        ) : (
          <View
            style={[
              styles.bundleOwned,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={colors.primary}
            />
            <Text style={[text.bodySemibold, { color: colors.foreground }]}>
              Bundle unlocked — every skill is yours.
            </Text>
          </View>
        )}

        <View style={styles.tiles}>
          {SKILLS.map((skill) => {
            const unlocked = isSkillUnlocked(skill, owned);
            return (
              <Pressable
                key={skill.id}
                onPress={() => onTile(skill)}
                accessibilityRole="button"
                accessibilityLabel={`${skill.title}${unlocked ? "" : ", locked"}`}
                style={[
                  styles.tile,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <View style={styles.tileHeader}>
                  <Text
                    style={[text.cardLabel, { color: colors.foreground }]}
                  >
                    {skill.title}
                  </Text>
                  {!unlocked ? (
                    <Ionicons
                      name="lock-closed"
                      size={16}
                      color={colors.mutedForeground}
                    />
                  ) : (
                    <Ionicons
                      name="play-circle"
                      size={20}
                      color={colors.primary}
                    />
                  )}
                </View>
                <Text
                  style={[
                    text.helperRegular,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {skill.tagline}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  bundleCta: {
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  bundleOwned: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.lg,
  },
  tiles: { gap: spacing.md },
  tile: {
    padding: spacing.base,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  tileHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
});
