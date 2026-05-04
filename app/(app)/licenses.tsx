/**
 * Open-Source Licenses screen.
 *
 * Lists the major third-party dependencies MemTool ships with, along
 * with their license type and upstream URLs. Tapping any row opens the
 * project page in the in-app browser so curious users can read the full
 * license text.
 *
 * The list is curated from the project's pnpm workspace lockfile. It
 * covers only runtime dependencies (packages that ship in the app
 * bundle), not dev-only tooling. See `scripts/audit-prelaunch.ts` for
 * the full dependency graph.
 */
import React from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

interface License {
  name: string;
  version?: string;
  license: string;
  url: string;
}

const LICENSES: License[] = [
  {
    name: "React Native",
    license: "MIT",
    url: "https://github.com/facebook/react-native",
  },
  {
    name: "React",
    license: "MIT",
    url: "https://github.com/facebook/react",
  },
  {
    name: "Expo",
    license: "MIT",
    url: "https://github.com/expo/expo",
  },
  {
    name: "expo-router",
    license: "MIT",
    url: "https://github.com/expo/expo/tree/main/packages/expo-router",
  },
  {
    name: "expo-notifications",
    license: "MIT",
    url: "https://github.com/expo/expo/tree/main/packages/expo-notifications",
  },
  {
    name: "expo-haptics",
    license: "MIT",
    url: "https://github.com/expo/expo/tree/main/packages/expo-haptics",
  },
  {
    name: "expo-speech",
    license: "MIT",
    url: "https://github.com/expo/expo/tree/main/packages/expo-speech",
  },
  {
    name: "expo-store-review",
    license: "MIT",
    url: "https://github.com/expo/expo/tree/main/packages/expo-store-review",
  },
  {
    name: "expo-constants",
    license: "MIT",
    url: "https://github.com/expo/expo/tree/main/packages/expo-constants",
  },
  {
    name: "expo-linear-gradient",
    license: "MIT",
    url: "https://github.com/expo/expo/tree/main/packages/expo-linear-gradient",
  },
  {
    name: "expo-web-browser",
    license: "MIT",
    url: "https://github.com/expo/expo/tree/main/packages/expo-web-browser",
  },
  {
    name: "expo-file-system",
    license: "MIT",
    url: "https://github.com/expo/expo/tree/main/packages/expo-file-system",
  },
  {
    name: "expo-image-picker",
    license: "MIT",
    url: "https://github.com/expo/expo/tree/main/packages/expo-image-picker",
  },
  {
    name: "expo-audio",
    license: "MIT",
    url: "https://github.com/expo/expo/tree/main/packages/expo-audio",
  },
  {
    name: "@react-native-async-storage/async-storage",
    license: "MIT",
    url: "https://github.com/react-native-async-storage/async-storage",
  },
  {
    name: "react-native-reanimated",
    license: "MIT",
    url: "https://github.com/software-mansion/react-native-reanimated",
  },
  {
    name: "react-native-gesture-handler",
    license: "MIT",
    url: "https://github.com/software-mansion/react-native-gesture-handler",
  },
  {
    name: "react-native-safe-area-context",
    license: "MIT",
    url: "https://github.com/th3rdwave/react-native-safe-area-context",
  },
  {
    name: "react-native-screens",
    license: "MIT",
    url: "https://github.com/software-mansion/react-native-screens",
  },
  {
    name: "react-native-keyboard-controller",
    license: "MIT",
    url: "https://github.com/kirillzyusko/react-native-keyboard-controller",
  },
  {
    name: "react-native-svg",
    license: "MIT",
    url: "https://github.com/software-mansion/react-native-svg",
  },
  {
    name: "@tanstack/react-query",
    license: "MIT",
    url: "https://github.com/TanStack/query",
  },
  {
    name: "@expo-google-fonts/inter",
    license: "OFL-1.1",
    url: "https://github.com/expo/google-fonts",
  },
  {
    name: "@expo/vector-icons",
    license: "MIT",
    url: "https://github.com/expo/vector-icons",
  },
  {
    name: "react-native-purchases (RevenueCat)",
    license: "MIT",
    url: "https://github.com/RevenueCat/react-native-purchases",
  },
  {
    name: "zod",
    license: "MIT",
    url: "https://github.com/colinhacks/zod",
  },
  {
    name: "drizzle-orm",
    license: "Apache-2.0",
    url: "https://github.com/drizzle-team/drizzle-orm",
  },
  {
    name: "express",
    license: "MIT",
    url: "https://github.com/expressjs/express",
  },
];

async function openUrl(url: string) {
  try {
    if (Platform.OS === "web") {
      await Linking.openURL(url);
    } else {
      await WebBrowser.openBrowserAsync(url);
    }
  } catch {
    try {
      await Linking.openURL(url);
    } catch {
      // ignore
    }
  }
}

export default function LicensesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border },
        ]}
      >
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            router.back();
          }}
          style={({ pressed }) => [
            styles.backBtn,
            pressed && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Open-Source Licenses
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 40 },
        ]}
      >
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          MemTool is built on the shoulders of these open-source projects.
          Tap any entry to view its full license.
        </Text>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {LICENSES.map((pkg, idx) => (
            <React.Fragment key={pkg.name}>
              {idx > 0 && (
                <View
                  style={[styles.separator, { backgroundColor: colors.border }]}
                />
              )}
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  void openUrl(pkg.url);
                }}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="link"
                accessibilityLabel={`${pkg.name}, ${pkg.license} license`}
                testID={`license-row-${pkg.name}`}
              >
                <View style={styles.rowContent}>
                  <Text style={[styles.pkgName, { color: colors.foreground }]}>
                    {pkg.name}
                  </Text>
                  <Text
                    style={[styles.pkgLicense, { color: colors.mutedForeground }]}
                  >
                    {pkg.license}
                  </Text>
                </View>
                <Ionicons
                  name="open-outline"
                  size={16}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </React.Fragment>
          ))}
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
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
  },
  backBtn: { width: 32 },
  title: { ...text.cardTitle, textAlign: "center", flex: 1 },
  scroll: { padding: spacing.lg },
  intro: {
    ...text.caption,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
  },
  rowContent: { flex: 1 },
  pkgName: { ...text.bodyMedium, marginBottom: 2 },
  pkgLicense: { ...text.caption },
  separator: { height: 1, marginLeft: spacing.base },
});
