import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import type { useColors } from "@/hooks/useColors";
import type { MemDifficulty } from "@/lib/memOpponent";

type Colors = ReturnType<typeof useColors>;

const OPTIONS: { value: MemDifficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "normal", label: "Normal" },
  { value: "hard", label: "Hard" },
];

/**
 * Pre-match Easy / Normal / Hard toggle for Mem (Task #330). Shared
 * between the Memory Match and 24 Game pre-match screens so both
 * surfaces stay visually and behaviourally consistent.
 */
export function DifficultyToggle({
  value,
  onChange,
  colors,
}: {
  value: MemDifficulty;
  onChange: (next: MemDifficulty) => void;
  colors: Colors;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        Mem's difficulty
      </Text>
      <View
        style={[
          styles.row,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
        accessibilityRole="radiogroup"
      >
        {OPTIONS.map((opt) => {
          const selected = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${opt.label} difficulty`}
              style={[
                styles.option,
                selected && { backgroundColor: colors.primary },
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  {
                    color: selected
                      ? colors.primaryForeground
                      : colors.foreground,
                  },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    gap: spacing.xs,
  },
  label: {
    ...text.caption,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  row: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  option: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    minWidth: 72,
    alignItems: "center",
  },
  optionText: {
    ...text.body,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
