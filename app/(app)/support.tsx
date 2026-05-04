import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import {
  getPrivacyPolicyUrl,
  getSupportEmail,
  getTermsOfServiceUrl,
  openLegalUrl,
  openSupportEmail,
} from "@/lib/legal";

type FaqItem = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  question: string;
  answer: string;
};

const FAQ_ITEMS: FaqItem[] = [
  {
    icon: "create-outline",
    question: "How do I capture a thought?",
    answer: "Use voice or text input on the Home screen.",
  },
  {
    icon: "sparkles-outline",
    question: "Where is my AI recap?",
    answer:
      "In the AI chat screen — appears daily once you've logged 5 captures.",
  },
  {
    icon: "star-outline",
    question: "How do I go Pro?",
    answer: "Settings → Subscription.",
  },
  {
    icon: "mic-outline",
    question: "Can I use voice recording?",
    answer: "Yes — voice capture is a Pro feature.",
  },
  {
    icon: "lock-closed-outline",
    question: "Is my data private?",
    answer:
      "Yes — memories are stored locally unless you choose to share them.",
  },
  {
    icon: "refresh-outline",
    question: "How do I restore my purchases?",
    answer: "Settings → Restore Purchases.",
  },
];

export default function SupportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleBack = () => {
    Haptics.selectionAsync();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  const handleOpenPrivacy = async () => {
    Haptics.selectionAsync();
    await openLegalUrl(getPrivacyPolicyUrl());
  };

  const handleOpenTerms = async () => {
    Haptics.selectionAsync();
    await openLegalUrl(getTermsOfServiceUrl());
  };

  const handleContact = async () => {
    Haptics.selectionAsync();
    await openSupportEmail();
  };

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + spacing.base,
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
      >
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => [
            styles.backRow,
            pressed && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <Ionicons
            name="chevron-back"
            size={24}
            color={colors.foreground}
          />
          <Text style={[styles.backLabel, { color: colors.foreground }]}>
            Back
          </Text>
        </Pressable>

        <Text style={[styles.title, { color: colors.foreground }]}>
          MemTool Support
        </Text>
        <Text
          style={[styles.subhead, { color: colors.mutedForeground }]}
        >
          We're here to help.
        </Text>

        <Text style={[styles.intro, { color: colors.foreground }]}>
          MemTool is your personal memory companion — capture thoughts,
          track wellness, and get AI-powered daily recaps.
        </Text>

        <Text
          style={[styles.sectionTitle, { color: colors.mutedForeground }]}
        >
          QUICK HELP
        </Text>

        {FAQ_ITEMS.map((item, idx) => (
          <View
            key={item.question}
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              idx === FAQ_ITEMS.length - 1 && { marginBottom: spacing.xl },
            ]}
          >
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Ionicons
                  name={item.icon}
                  size={24}
                  color={colors.accent}
                />
              </View>
              <View style={styles.rowContent}>
                <Text
                  style={[
                    styles.rowTitle,
                    { color: colors.foreground },
                  ]}
                >
                  {item.question}
                </Text>
                <Text
                  style={[
                    styles.rowSubtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {item.answer}
                </Text>
              </View>
            </View>
          </View>
        ))}

        <Text
          style={[styles.sectionTitle, { color: colors.mutedForeground }]}
        >
          LEGAL
        </Text>

        <Pressable
          onPress={handleOpenPrivacy}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { opacity: 0.8 },
          ]}
          accessibilityRole="link"
          accessibilityLabel="Open Privacy Policy"
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name="shield-checkmark-outline"
                size={24}
                color={colors.accent}
              />
            </View>
            <View style={styles.rowContent}>
              <Text
                style={[styles.rowTitle, { color: colors.foreground }]}
              >
                Privacy Policy
              </Text>
              <Text
                style={[
                  styles.rowSubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                How your data is handled
              </Text>
            </View>
            <Ionicons
              name="open-outline"
              size={20}
              color={colors.mutedForeground}
            />
          </View>
        </Pressable>

        <Pressable
          onPress={handleOpenTerms}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { opacity: 0.8 },
          ]}
          accessibilityRole="link"
          accessibilityLabel="Open Terms of Service"
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name="document-text-outline"
                size={24}
                color={colors.accent}
              />
            </View>
            <View style={styles.rowContent}>
              <Text
                style={[styles.rowTitle, { color: colors.foreground }]}
              >
                Terms of Service
              </Text>
              <Text
                style={[
                  styles.rowSubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                The rules of using MemTool
              </Text>
            </View>
            <Ionicons
              name="open-outline"
              size={20}
              color={colors.mutedForeground}
            />
          </View>
        </Pressable>

        <Text
          style={[styles.sectionTitle, { color: colors.mutedForeground }]}
        >
          CONTACT
        </Text>

        <Pressable
          onPress={handleContact}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { opacity: 0.8 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Email MemTool support at ${getSupportEmail()}`}
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name="mail-outline"
                size={24}
                color={colors.primary}
              />
            </View>
            <View style={styles.rowContent}>
              <Text
                style={[styles.rowTitle, { color: colors.foreground }]}
              >
                Email Support
              </Text>
              <Text
                style={[
                  styles.rowSubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                We respond within 48 hours.
              </Text>
            </View>
            <Ionicons
              name="open-outline"
              size={20}
              color={colors.mutedForeground}
            />
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.base,
    marginLeft: -spacing.xs,
  },
  backLabel: {
    ...text.bodyMedium,
    marginLeft: spacing.xs,
  },
  title: {
    ...text.screenTitle,
    marginBottom: spacing.xs,
  },
  subhead: {
    ...text.bodyMedium,
    marginBottom: spacing.lg,
  },
  intro: {
    ...text.body,
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  sectionTitle: {
    ...text.captionStrong,
    letterSpacing: 1,
    marginBottom: spacing.sm,
    marginLeft: spacing.base,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
  },
  rowIcon: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.base,
  },
  rowContent: { flex: 1 },
  rowTitle: {
    ...text.bodyMedium,
    marginBottom: 2,
  },
  rowSubtitle: { ...text.caption },
});
