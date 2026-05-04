import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";

export default function NotFoundScreen() {
  const colors = useColors();

  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          We couldn't find that screen.
        </Text>

        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: colors.primary }]}>
            Back to home
          </Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    // 20: deliberate one-off, between spacing.base (16) and spacing.lg (24).
    padding: 20,
  },
  title: {
    ...text.sectionTitle,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  link: {
    // 15: deliberate one-off, between spacing.md (12) and spacing.base (16).
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    ...text.helperRegular,
  },
});
