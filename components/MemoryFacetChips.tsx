import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import type { MemoryFacets } from "@/lib/memories";

/**
 * Lightweight tag-chip strip rendered on each Archive memory row when
 * the on-device FoundationModels bridge (Task #195) attached `facets`
 * to the memory. Surfaces the user-visible value of the local
 * extraction without any new server contract — older rows, rows
 * captured on non-Apple-Intelligence devices, and rows where the
 * model call failed simply omit `facets` and this component renders
 * nothing (degrades silently, the rest of the card looks identical
 * to before).
 *
 * Visual contract:
 *   - One small pill per tag (lowercase, single word, max ~5 from the
 *     extractor).
 *   - Wraps onto multiple lines so a long tag list never pushes the
 *     row's other affordances off the right edge.
 *   - Uses the same chip vocabulary already established by the
 *     foundation-models-spike screen (border + muted background +
 *     captionStrong text) so the look stays consistent if/when the
 *     spike screen is decommissioned.
 *
 * Why a separate component:
 *   - Keeps `archive.tsx` (already 1k+ lines) free of one more inline
 *     `View`/`StyleSheet` block, and gives the recap screen a
 *     drop-in for the same surface if it ever wants to render the
 *     same chips next to a memory preview.
 *   - Unit-testable in isolation — the empty-tag and missing-facets
 *     paths are pure render branches that don't need the full
 *     archive screen booted under jest.
 */
interface Props {
  facets: MemoryFacets | undefined;
}

export function MemoryFacetChips({ facets }: Props) {
  const colors = useColors();
  // Defensive against the three "no chips" inputs:
  //   - facets entirely absent (older row / non-AI device)
  //   - facets present but `tags` somehow not an array (cache shape drift)
  //   - tags array empty (model returned no topical hits)
  // Any of these returns null so the row chrome is byte-for-byte
  // identical to the pre-facets layout.
  if (!facets || !Array.isArray(facets.tags) || facets.tags.length === 0) {
    return null;
  }

  return (
    <View
      style={styles.row}
      accessibilityLabel={`Tags: ${facets.tags.join(", ")}`}
    >
      {facets.tags.map((tag) => (
        <View
          key={tag}
          style={[
            styles.chip,
            { borderColor: colors.border, backgroundColor: colors.muted },
          ]}
        >
          <Text
            style={[styles.chipText, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {tag}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginTop: spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: {
    ...text.captionStrong,
    letterSpacing: 0.2,
  },
});
