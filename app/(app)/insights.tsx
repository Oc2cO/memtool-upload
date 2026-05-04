// Full /insights surface — the "more from Mem" destination tapped
// from the Home MemNoticedCard. Renders the same on-device patterns
// envelope, broken out so every signal has a permanent home (themes,
// people, kinds, weekday-mood chart, mood trend, recurring theme,
// last refreshed at).
//
// Free vs Pro:
//  - Cold-start state is identical for everyone (we never gate the
//    "still getting to know you" copy on tier).
//  - Free users get the populated themes / people / mood-trend /
//    recurring-theme blocks plus a single ProUpsellCard.
//  - Pro users additionally get the weekday-mood SVG chart and the
//    90-day theme strip. Those are the "second-order" signals that
//    only feel useful once the user has lived with the app for
//    weeks, so they sit behind the upgrade.

import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Rect, Text as SvgText } from "react-native-svg";
import Animated from "react-native-reanimated";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { GradientBackground } from "@/components/alive/GradientBackground";
import { SettleOnMount } from "@/components/alive/SettleOnMount";
import { ProUpsellCard } from "@/components/ProUpsellCard";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { loadStoredPatterns } from "@/lib/aiEngineStorage";
import { fetchPatternsFromServer, type PatternsEnvelope } from "@/lib/aiEngine";
import { pickInsightsView } from "@/lib/insightsView";
import { useBreathingEnabled } from "@/lib/aliveUI";
import { cardEntering } from "@/lib/animationTokens";
import { formatRelative } from "@/lib/dates";

const WEEKDAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatMoodTrend(trend: string | null): string {
  if (trend === "improving") return "Trending upward this week";
  if (trend === "declining") return "Trending downward this week";
  if (trend === "steady") return "Fairly steady this week";
  return "Not enough mood data yet";
}

export default function InsightsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { status: subscriptionStatus } = useSubscription();
  const isPro = subscriptionStatus?.is_pro === true;
  const motionEnabled = useBreathingEnabled();

  const [patterns, setPatterns] = useState<PatternsEnvelope | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Tracks whether the most recent attempt to refresh the patterns
  // envelope from the server failed. Surfaced as a small "Couldn't
  // refresh — try again" pill on the cold-start view so users know
  // their first server pattern generation didn't go through, instead
  // of staring at the generic "still getting to know you" copy and
  // wondering if anything is happening.
  const [refreshError, setRefreshError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.email) {
      setPatterns(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const email = user.email;
    const env = await loadStoredPatterns<PatternsEnvelope>(email);
    setPatterns(env);
    setIsLoading(false);

    // If we have no envelope yet (truly cold) or the local copy is
    // still in cold-start mode, try to pull a fresh one from the
    // server so we can surface a real failure indicator instead of
    // silently leaving the user on the cold-start screen forever.
    const needsServerCheck = !env || env.data.cold_start;
    if (!needsServerCheck) {
      setRefreshError(false);
      return;
    }
    setIsRefreshing(true);
    try {
      const fresh = await fetchPatternsFromServer(email);
      if (fresh) setPatterns(fresh);
      setRefreshError(false);
    } catch {
      setRefreshError(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [user?.email]);

  const handleRetryRefresh = useCallback(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const isColdStart = !patterns || patterns.data.cold_start;
  const data = patterns?.data;
  const view = pickInsightsView({
    isLoading,
    hasPatterns: !!patterns,
    isColdStart,
    isPro,
  });

  // Weekday chart — only meaningful when at least two weekdays have
  // ratings; below that the chart looks like a single bar floating
  // alone, which reads as "broken" rather than "early".
  const weekdayBars = useMemo(() => {
    if (!data) return [];
    return WEEKDAY_ORDER.map((label) => {
      const v = data.weekday_mood[label];
      return { label, rating: typeof v === "number" ? v : null };
    });
  }, [data]);
  const weekdayHasData = weekdayBars.some((b) => b.rating !== null);
  const maxRating = Math.max(
    1,
    ...weekdayBars.map((b) => b.rating ?? 0),
  );
  const chartHeight = 140;
  const chartWidth = 300;
  const barWidth = 28;
  // Local name (`barSpacing`) avoids shadowing the imported design-token
  // `spacing` namespace.
  const barSpacing = (chartWidth - barWidth * WEEKDAY_ORDER.length) / 6;

  return (
    <SettleOnMount
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <GradientBackground style={StyleSheet.absoluteFill} />
      </View>

      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Insights
        </Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 100 },
        ]}
      >
        {view === "loading" ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : view === "cold_start" ? (
          <Animated.View
            entering={cardEntering(0, motionEnabled)}
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.coldHeader}>
              <Ionicons name="leaf-outline" size={28} color={colors.primary} />
            </View>
            <Text style={[styles.coldTitle, { color: colors.foreground }]}>
              Mem is still getting to know you
            </Text>
            <Text
              style={[styles.coldBody, { color: colors.mutedForeground }]}
            >
              Capture {patterns?.data.cold_start_min ?? 5} memories and
              your patterns will start showing up here — themes,
              people, weekday mood. Mem keeps a local copy in sync
              with the server so it paints instantly.
            </Text>
            {/* Refresh-failure pill: only shown when we attempted a
                server fetch on this cold-start view and it errored.
                Suppressed while a retry is in flight so the user
                gets clear "we're trying again" feedback instead of
                a stale error label. */}
            {refreshError && !isRefreshing && (
              <Pressable
                onPress={handleRetryRefresh}
                style={[
                  styles.refreshErrorPill,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.destructive ?? colors.primary,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Couldn't refresh insights, try again"
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={14}
                  color={colors.destructive ?? colors.primary}
                />
                <Text
                  style={[
                    styles.refreshErrorPillText,
                    { color: colors.destructive ?? colors.primary },
                  ]}
                >
                  Couldn't refresh — try again
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => router.push("/capture")}
              style={[
                styles.coldCta,
                { backgroundColor: colors.primary },
              ]}
              accessibilityLabel="Capture a memory"
            >
              <Text
                style={[
                  styles.coldCtaText,
                  { color: colors.primaryForeground },
                ]}
              >
                Capture a memory
              </Text>
            </Pressable>
          </Animated.View>
        ) : view === "locked" ? (
          <>
            <Animated.View
              entering={cardEntering(0, motionEnabled)}
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.coldHeader}>
                <Ionicons
                  name="lock-closed"
                  size={26}
                  color={colors.primary}
                />
              </View>
              <Text style={[styles.coldTitle, { color: colors.foreground }]}>
                Mem has noticed more
              </Text>
              <Text
                style={[styles.coldBody, { color: colors.mutedForeground }]}
              >
                Your top themes, the people on your mind, weekday
                mood, and the longer 90-day picture all live behind
                MemTool Pro. The "Mem noticed" card on Home keeps
                rotating one insight a day — upgrade to see the full
                picture.
              </Text>
            </Animated.View>
            <Animated.View entering={cardEntering(1, motionEnabled)}>
              <ProUpsellCard
                icon="analytics"
                title="Unlock the full Insights view"
                body="MemTool Pro shows your top themes, top people, recurring kinds, mood trend, weekday-mood chart, and the 90-day theme strip — everything Mem has learned about you."
              />
            </Animated.View>
          </>
        ) : (
          data && (
            <>
              <Animated.View
                entering={cardEntering(0, motionEnabled)}
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Text
                  style={[styles.sectionLabel, { color: colors.mutedForeground }]}
                >
                  THIS MONTH
                </Text>
                <Text style={[styles.headline, { color: colors.foreground }]}>
                  {data.memory_count} memories · {data.embedding_count}{" "}
                  understood by Mem
                </Text>
                <Text
                  style={[styles.metaText, { color: colors.mutedForeground }]}
                >
                  Last refreshed {formatRelative(patterns!.generated_at)}
                </Text>
              </Animated.View>

              {data.tags_30d.length > 0 && (
                <Animated.View
                  entering={cardEntering(1, motionEnabled)}
                  style={[
                    styles.card,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    TOP THEMES · LAST 30 DAYS
                  </Text>
                  <View style={styles.chipRow}>
                    {data.tags_30d.slice(0, 8).map((t) => (
                      <View
                        key={`30-${t.tag}`}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: colors.background,
                            borderColor: colors.primary,
                          },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: colors.primary }]}>
                          {t.tag}
                        </Text>
                        <Text
                          style={[styles.chipCount, { color: colors.primary }]}
                        >
                          {t.count}
                        </Text>
                      </View>
                    ))}
                  </View>
                </Animated.View>
              )}

              {data.top_people.length > 0 && (
                <Animated.View
                  entering={cardEntering(2, motionEnabled)}
                  style={[
                    styles.card,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    PEOPLE ON YOUR MIND
                  </Text>
                  <View style={styles.chipRow}>
                    {data.top_people.slice(0, 6).map((p) => (
                      <View
                        key={`p-${p.person}`}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: colors.background,
                            borderColor: colors.accent,
                          },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: colors.accent }]}>
                          {p.person}
                        </Text>
                        <Text
                          style={[styles.chipCount, { color: colors.accent }]}
                        >
                          {p.count}
                        </Text>
                      </View>
                    ))}
                  </View>
                </Animated.View>
              )}

              <Animated.View
                entering={cardEntering(3, motionEnabled)}
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  MOOD TREND
                </Text>
                <View style={styles.trendRow}>
                  <Ionicons
                    name={
                      data.mood_trend === "improving"
                        ? "trending-up"
                        : data.mood_trend === "declining"
                          ? "trending-down"
                          : "remove"
                    }
                    size={20}
                    color={
                      data.mood_trend === "improving"
                        ? colors.accent
                        : data.mood_trend === "declining"
                          ? colors.destructive
                          : colors.mutedForeground
                    }
                  />
                  <Text
                    style={[styles.trendText, { color: colors.foreground }]}
                  >
                    {formatMoodTrend(data.mood_trend)}
                  </Text>
                </View>
              </Animated.View>

              {data.recurring_kinds.length > 0 && (
                <Animated.View
                  entering={cardEntering(4, motionEnabled)}
                  style={[
                    styles.card,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    HOW YOU CAPTURE
                  </Text>
                  <View style={styles.chipRow}>
                    {data.recurring_kinds.slice(0, 6).map((k) => (
                      <View
                        key={`k-${k.kind}`}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: colors.foreground },
                          ]}
                        >
                          {k.kind}
                        </Text>
                        <Text
                          style={[
                            styles.chipCount,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {k.count}
                        </Text>
                      </View>
                    ))}
                  </View>
                </Animated.View>
              )}

              {data.recurring_theme && (
                <Animated.View
                  entering={cardEntering(5, motionEnabled)}
                  style={[
                    styles.card,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    RECURRING THEME
                  </Text>
                  <Text style={[styles.recurring, { color: colors.foreground }]}>
                    Mem keeps seeing{" "}
                    <Text
                      style={[styles.recurringHl, { color: colors.primary }]}
                    >
                      {data.recurring_theme}
                    </Text>{" "}
                    show up across your memories.
                  </Text>
                </Animated.View>
              )}

              {/* Reached only when isPro === true (gated above). */}
              <>
                <Animated.View
                  entering={cardEntering(6, motionEnabled)}
                  style={[
                    styles.card,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                    <Text
                      style={[
                        styles.sectionLabel,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      WEEKDAY MOOD
                    </Text>
                    {weekdayHasData ? (
                      <View style={styles.chartWrap}>
                        <Svg
                          width="100%"
                          height={chartHeight + 30}
                          viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`}
                        >
                          {weekdayBars.map((b, i) => {
                            const h = b.rating
                              ? (b.rating / maxRating) * chartHeight
                              : 0;
                            const x = i * (barWidth + barSpacing);
                            const y = chartHeight - h;
                            return (
                              <React.Fragment key={b.label}>
                                <Rect
                                  x={x}
                                  y={y}
                                  width={barWidth}
                                  height={Math.max(h, 2)}
                                  fill={
                                    b.rating ? colors.primary : colors.muted
                                  }
                                  rx={4}
                                />
                                <SvgText
                                  x={x + barWidth / 2}
                                  y={chartHeight + 20}
                                  fill={colors.mutedForeground}
                                  fontSize={11}
                                  textAnchor="middle"
                                >
                                  {b.label}
                                </SvgText>
                                {b.rating !== null && (
                                  <SvgText
                                    x={x + barWidth / 2}
                                    y={y - 6}
                                    fill={colors.foreground}
                                    fontSize={11}
                                    textAnchor="middle"
                                  >
                                    {b.rating.toFixed(1)}
                                  </SvgText>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </Svg>
                      </View>
                    ) : (
                      <Text
                        style={[
                          styles.metaText,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        Log a couple of moods this week and the chart
                        will fill in here.
                      </Text>
                    )}
                  </Animated.View>

                  {data.tags_90d.length > 0 && (
                    <Animated.View
                      entering={cardEntering(7, motionEnabled)}
                      style={[
                        styles.card,
                        { backgroundColor: colors.card, borderColor: colors.border },
                      ]}
                    >
                      <Text
                        style={[
                          styles.sectionLabel,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        90-DAY THEMES
                      </Text>
                      <View style={styles.chipRow}>
                        {data.tags_90d.slice(0, 12).map((t) => (
                          <View
                            key={`90-${t.tag}`}
                            style={[
                              styles.chip,
                              {
                                backgroundColor: colors.background,
                                borderColor: colors.border,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                { color: colors.foreground },
                              ]}
                            >
                              {t.tag}
                            </Text>
                            <Text
                              style={[
                                styles.chipCount,
                                { color: colors.mutedForeground },
                              ]}
                            >
                              {t.count}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </Animated.View>
                  )}
              </>
            </>
          )
        )}
      </ScrollView>
    </SettleOnMount>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: {
    ...text.sectionTitle,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  scrollContent: { paddingHorizontal: spacing.lgCard, paddingTop: spacing.sm },
  loadingWrap: { paddingVertical: 64, alignItems: "center" },
  card: {
    // 18: deliberate one-off, between spacing.base (16) and spacing.lgCard (20).
    padding: 18,
    // 18: deliberate one-off, between radius.md (16) and radius.lg (24).
    borderRadius: 18,
    borderWidth: 1,
    // 14: deliberate one-off, between spacing.md (12) and spacing.base (16).
    marginBottom: 14,
    // 10: deliberate one-off, between spacing.sm (8) and spacing.md (12).
    gap: 10,
  },
  sectionLabel: {
    // 11: deliberate one-off, sized down from text.caption (12) so the
    // tracked-out label stays visually quieter than card content.
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    letterSpacing: 1,
  },
  headline: {
    ...text.cardHeading,
    lineHeight: 24,
  },
  metaText: {
    ...text.caption,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    // 20: deliberate one-off — pill chip sits between radius.sm (12)
    // and radius.lg (24).
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  chipCount: {
    // 11: deliberate one-off, sized down from text.caption (12) so the
    // tally never visually competes with the chip label.
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    opacity: 0.7,
  },
  trendRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  trendText: {
    // 15: deliberate one-off, between text.helper (14) and text.body (16).
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  recurring: {
    // 15: deliberate one-off, between text.helper (14) and text.body (16).
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    lineHeight: 22,
  },
  recurringHl: { fontFamily: "Inter_700Bold", fontWeight: "700" },
  chartWrap: { width: "100%", alignItems: "center", marginTop: 4 },
  coldHeader: { alignItems: "center", marginBottom: 4 },
  coldTitle: {
    ...text.cardHeading,
    textAlign: "center",
  },
  coldBody: {
    ...text.helperRegular,
    lineHeight: 20,
    textAlign: "center",
  },
  coldCta: {
    marginTop: 6,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  coldCtaText: {
    ...text.helper,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
  },
  refreshErrorPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    // 999: deliberate one-off — fully-rounded pill geometry, intentionally
    // outside the radius scale.
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 4,
  },
  refreshErrorPillText: {
    ...text.captionStrong,
  },
});
