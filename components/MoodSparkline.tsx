import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Polyline, Circle, Line } from "react-native-svg";

import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import {
  SPARKLINE_BUCKET_DAYS,
  type MonthRecap,
} from "@/lib/recapMonth";

export interface MoodSparklineProps {
  recap: MonthRecap;
}

export const SPARKLINE_HEIGHT = 80;
export const SPARKLINE_PADDING_X = 4;
export const SPARKLINE_PADDING_Y = 8;

/**
 * Mood mini-chart inside the range recap. Plots
 * `recap.displayMoodSparkline` as an SVG polyline + dot markers, with a
 * dashed midpoint baseline at rating 3. Days without a rating are
 * skipped from the line/dots but still consume their x-step slot, so
 * gaps stay temporally truthful instead of compressing the line. The
 * `1..5 → bottom..top` mapping pins rating 1 to the bottom of the
 * chart, rating 5 to the top, and rating 3 to the midpoint baseline.
 *
 * Extracted from MonthRecapView so tests can render it in isolation
 * without booting the full provider tree (auth / mood / memories /
 * subscription) MonthRecapView depends on.
 */
export function MoodSparkline({ recap }: MoodSparklineProps) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  // Use the down-sampled series so the year view (365 days) plots
  // ~52 weekly dots instead of 365 sub-pixel dots crammed into a
  // ~340 px sliver. The aggregator picks the right series for the
  // window length; nothing to decide here.
  const points = recap.displayMoodSparkline;
  const ratedPoints = points
    .map((p, idx) => ({ idx, rating: p.rating }))
    .filter((p): p is { idx: number; rating: number } => p.rating !== null);
  const isBucketed = points.length < recap.moodSparkline.length;

  const chartWidth = Math.max(0, width - SPARKLINE_PADDING_X * 2);
  const chartHeight = SPARKLINE_HEIGHT - SPARKLINE_PADDING_Y * 2;
  const stepX =
    points.length > 1 ? chartWidth / (points.length - 1) : chartWidth;

  const polyline = ratedPoints
    .map((p) => {
      const x = SPARKLINE_PADDING_X + stepX * p.idx;
      // 1..5 -> bottom..top
      const y =
        SPARKLINE_PADDING_Y + (1 - (p.rating - 1) / 4) * chartHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          marginBottom: 12,
        },
      ]}
    >
      <Text style={[styles.sectionLabel, { color: colors.primary }]}>
        MOOD OVER {recap.windowDays} DAYS
      </Text>
      <View
        style={styles.sparklineWrap}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        testID="mood-sparkline-wrap"
      >
        {width > 0 && (
          <Svg width={width} height={SPARKLINE_HEIGHT}>
            {/* Faint baseline at rating 3 (the midpoint) */}
            <Line
              x1={SPARKLINE_PADDING_X}
              x2={width - SPARKLINE_PADDING_X}
              y1={SPARKLINE_PADDING_Y + chartHeight / 2}
              y2={SPARKLINE_PADDING_Y + chartHeight / 2}
              stroke={colors.border}
              strokeWidth={1}
              strokeDasharray="3,4"
              testID="mood-sparkline-baseline"
            />
            {polyline.length > 0 && (
              <Polyline
                points={polyline}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                testID="mood-sparkline-polyline"
              />
            )}
            {ratedPoints.map((p) => {
              const x = SPARKLINE_PADDING_X + stepX * p.idx;
              const y =
                SPARKLINE_PADDING_Y +
                (1 - (p.rating - 1) / 4) * chartHeight;
              return (
                <Circle
                  key={p.idx}
                  cx={x}
                  cy={y}
                  r={2.5}
                  fill={colors.accent}
                  testID={`mood-sparkline-dot-${p.idx}`}
                />
              );
            })}
          </Svg>
        )}
      </View>
      <Text
        style={[styles.sparklineLabel, { color: colors.mutedForeground }]}
      >
        {recap.moodTrendLabel}
        {isBucketed
          ? ` · ${SPARKLINE_BUCKET_DAYS}-day buckets`
          : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lgCard,
  },
  sectionLabel: {
    // 800-weight one-off — Inter only ships up to 700 in the bundle, so
    // family stays pinned to Inter_700Bold.
    fontSize: 12,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  sparklineWrap: {
    width: "100%",
    height: SPARKLINE_HEIGHT,
    marginBottom: spacing.sm,
  },
  sparklineLabel: {
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    textAlign: "center",
  },
});
