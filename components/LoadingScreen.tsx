import React from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { spacing } from "@/constants/spacing";
import { useColors } from "@/hooks/useColors";

const APP_BG = "#0a0a0f";
const APP_ACCENT = "#22d3ee";

export interface LoadingScreenProps {
  debug?: string;
}

export function LoadingScreen({ debug }: LoadingScreenProps = {}) {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: APP_BG,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ActivityIndicator size="large" color={APP_ACCENT} />
      <Text style={{ color: colors.mutedForeground, marginTop: spacing.base, fontSize: 16 }}>Loading…</Text>
      {debug ? (
        <Text style={{ color: "#666", marginTop: spacing.sm, fontSize: 10, paddingHorizontal: spacing.lg, textAlign: "center" }}>
          {debug}
        </Text>
      ) : null}
    </View>
  );
}
