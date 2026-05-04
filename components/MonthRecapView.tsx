import React, { useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { LiftPress } from "@/components/alive/LiftPress";
import { SettleOnMount } from "@/components/alive/SettleOnMount";
import { CaptureHeatmap } from "@/components/CaptureHeatmap";
import { MoodSparkline } from "@/components/MoodSparkline";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useMood } from "@/context/MoodContext";
import { useMemories } from "@/context/MemoriesContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { ProUpsellCard } from "@/components/ProUpsellCard";
import { loadStoredPatterns } from "@/lib/aiEngineStorage";
import {
  aggregateRangeRecap,
  MONTH_RECAP_WINDOW_DAYS,
  type MonthRecap,
} from "@/lib/recapMonth";
import { buildSelfieStrip } from "@/lib/dailySelfie";
import type { PatternsEnvelope } from "@/lib/aiEngine";

interface MonthRecapViewProps {
  /** Window length in days. Defaults to MONTH_RECAP_WINDOW_DAYS (30).
   *  The Recap screen passes 7 for "Past 7 days", 90 for "Past 90
   *  days", and 365 for "Past 365 days". */
  windowDays?: number;
  /** Override "now" anchor passed through to `aggregateRangeRecap`.
   *  Used by the custom date-range view so the window ends on the
   *  user's chosen end date instead of today. Default is the current
   *  device clock — the existing preset tabs rely on that. */
  now?: Date;
  /** Optional override for the headline counter title and the cold-
   *  start copy. The preset tabs read "Past N days"; the custom-range
   *  view passes "Custom range" so the header reflects the user's
   *  intent rather than the raw window length (which can be any
   *  arbitrary number). */
  headerLabel?: string;
}

/**
 * Pick the friendly noun we use in cold-start copy and Pro upsell
 * cards. Centralised so the week / month / quarter / year wording
 * stays consistent across every place that says "your <noun>".
 */
function windowNoun(windowDays: number): "week" | "month" | "quarter" | "year" {
  if (windowDays <= 7) return "week";
  if (windowDays <= 30) return "month";
  if (windowDays <= 90) return "quarter";
  return "year";
}

/**
 * Range-recap surface ("Past N days"). Pure renderer of
 * `aggregateRangeRecap`. Reads the AI engine's stored patterns envelope
 * on mount (the only reason this isn't a stateless component) so it
 * can pick up `recurring_theme`. No network fetch — the envelope was
 * already persisted by `MemoriesContext.maintainAiEngine`.
 *
 * Pro gating mirrors the Today recap: free users see the counter,
 * theme strip, and people strip. The mood mini-chart and
 * "Mem noticed" recurring-theme card are Pro-only and are replaced
 * by a single ProUpsellCard for free users.
 */
export function MonthRecapView({
  windowDays = MONTH_RECAP_WINDOW_DAYS,
  now,
  headerLabel,
}: MonthRecapViewProps = {}) {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { history } = useMood();
  const { memories } = useMemories();
  const { status: subscriptionStatus } = useSubscription();
  const isPro = subscriptionStatus?.is_pro === true;

  const [patterns, setPatterns] = useState<PatternsEnvelope | null>(null);

  // Read the stored patterns envelope once per user. The envelope
  // itself is rebuilt by `MemoriesContext.maintainAiEngine` on the
  // refresh path, not by user clicks here, so a single read on
  // mount + a refresh whenever the user re-enters the screen is
  // enough — additional re-reads on every memory list mutation
  // would be wasted I/O. Free users still see something useful
  // because `recurring_theme` is the only field this provides; the
  // counter / themes / people are all computed fresh from
  // `memories` on every render.
  useEffect(() => {
    let cancelled = false;
    const email = user?.email;
    if (!email) {
      setPatterns(null);
      return;
    }
    loadStoredPatterns<PatternsEnvelope>(email)
      .then((env) => {
        if (!cancelled) setPatterns(env);
      })
      .catch(() => {
        if (!cancelled) setPatterns(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  const recap: MonthRecap = useMemo(
    () =>
      aggregateRangeRecap({
        memories,
        moodHistory: history,
        patterns,
        windowDays,
        now,
      }),
    [memories, history, patterns, windowDays, now],
  );

  // Photo strip (Task #372). Surface up to the 6 most-recent
  // photos attached to memories inside the same window the rest of
  // this view aggregates. Reads `photoUrl` / `photoThumbUrl` /
  // `photoTakenAt` directly off the memory list — `MemoriesContext`
  // has already merged them in by the time this view mounts. We
  // intentionally leave this off the cold-start branch so the
  // friendly nudge isn't crowded by a single thumbnail.
  // Daily selfie strip (Task #375). One cell per day in the
  // window, filled with that day's selfie thumb or a "missed"
  // placeholder so streak gaps are visible at a glance. Off the
  // cold-start branch for the same reason as the photo strip
  // above — a single thumbnail next to the friendly nudge would
  // crowd it. We cap the visible count for the long windows
  // (90 / 365 day tabs) so the strip stays scannable; the user
  // still sees the full series via the heatmap.
  const selfieStrip = useMemo(() => {
    if (recap.isColdStart) return [];
    const cells = buildSelfieStrip(memories, recap.windowStart, recap.windowEnd);
    // Newest first so today's selfie sits at the leading edge of
    // the strip, matching the rest of the recap surface (counter
    // reads "windowEnd", capture list is desc).
    return cells.slice().reverse();
  }, [memories, recap.isColdStart, recap.windowStart, recap.windowEnd]);
  const photoMemories = useMemo(() => {
    if (recap.isColdStart) return [];
    const start = recap.windowStart;
    const end = recap.windowEnd;
    const inWindow = memories.filter((m) => {
      if (!m.photoUrl && !m.photoThumbUrl) return false;
      if (typeof m.timestamp !== "string") return false;
      const day = m.timestamp.slice(0, 10);
      return day >= start && day <= end;
    });
    inWindow.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return inWindow.slice(0, 6);
  }, [memories, recap.isColdStart, recap.windowStart, recap.windowEnd]);

  const goToArchive = (params: Record<string, string>) => {
    // Navigation tap — raw selection feedback is the right shape.
    Haptics.selectionAsync().catch(() => {});
    // The (tabs) group is invisible in the typed route, so the
    // archive tab resolves to "/archive". We keep params untyped here
    // because the Archive screen reads them via useLocalSearchParams.
    router.push({
      pathname: "/archive" as never,
      params,
    });
  };

  if (recap.isColdStart) {
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.coldStartContent}>
          <Ionicons
            name="leaf-outline"
            size={36}
            color={colors.primary}
            style={styles.coldStartIcon}
          />
          <Text style={[styles.coldStartTitle, { color: colors.foreground }]}>
            {headerLabel
              ? `${headerLabel} is just getting started`
              : `Your ${windowNoun(windowDays)} is just getting started`}
          </Text>
          <Text
            style={[
              styles.coldStartBody,
              { color: colors.mutedForeground },
            ]}
          >
            {headerLabel
              ? `Capture a few more memories in this ${windowDays}-day range and Mem will start surfacing patterns here.`
              : `Capture a few more memories and Mem will start surfacing patterns from your past ${windowDays} days here.`}
          </Text>
          <Text
            style={[styles.coldStartCounter, { color: colors.primary }]}
          >
            {recap.totalCaptures}{" "}
            {recap.totalCaptures === 1 ? "memory" : "memories"} so far
          </Text>
        </View>
      </View>
    );
  }

  return (
    // Root the populated recap in SettleOnMount so the whole month
    // surface lands with the same Mercury ~3px settle the rest of
    // the alive screens use (login, capture confirmation, recap
    // milestone/nudge cards). One settle for the whole panel reads
    // as a single arrival rather than each card jittering.
    <SettleOnMount>
      {/* Headline counter */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            marginBottom: spacing.md,
          },
        ]}
      >
        <View style={styles.counterRow}>
          <Ionicons name="calendar" size={22} color={colors.primary} />
          <Text style={[styles.counterTitle, { color: colors.primary }]}>
            {headerLabel ?? `Past ${windowDays} days`}
          </Text>
        </View>
        <Text style={[styles.counterValue, { color: colors.foreground }]}>
          {recap.totalCaptures}{" "}
          {recap.totalCaptures === 1 ? "memory" : "memories"} across{" "}
          {recap.daysWithCaptures}{" "}
          {recap.daysWithCaptures === 1 ? "day" : "days"}
        </Text>
        <Text style={[styles.counterMeta, { color: colors.mutedForeground }]}>
          {recap.windowStart} → {recap.windowEnd}
        </Text>
      </View>

      {/* Capture-activity heatmap (Pro). Free users see a one-line
          upsell in its place — keeps the overview compact without
          losing the at-a-glance "which days were busy" feel. Cells
          deep-link to Archive filtered to the day (or the first day
          of the bucket on the bucketed long-window views). */}
      {isPro ? (
        <CaptureHeatmap
          counts={recap.dailyCaptureCounts}
          today={recap.windowEnd}
          windowDays={windowDays}
          onSelectDate={(date) => goToArchive({ date })}
        />
      ) : (
        <HeatmapUpsellLine
          windowDays={windowDays}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            router.push("/subscription" as never);
          }}
        />
      )}

      {/* Theme strip */}
      {recap.topTags.length > 0 && (
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              marginBottom: spacing.md,
            },
          ]}
        >
          <Text style={[styles.sectionLabel, { color: colors.primary }]}>
            TOP THEMES
          </Text>
          <View style={styles.chipRow}>
            {recap.topTags.map((t) => (
              <TouchableOpacity
                key={t.tag.toLowerCase()}
                onPress={() => goToArchive({ tag: t.tag })}
                style={[
                  styles.chip,
                  {
                    backgroundColor: colors.primary + "20",
                    borderColor: colors.primary,
                  },
                ]}
                accessibilityLabel={`Filter Archive by ${t.tag}`}
              >
                <Text style={[styles.chipText, { color: colors.primary }]}>
                  {t.tag}
                </Text>
                <Text
                  style={[styles.chipCount, { color: colors.primary }]}
                >
                  {t.count}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Daily selfies strip (Task #375). One cell per day across
          the window — present cells show the selfie thumb, missed
          cells render an empty placeholder so the user sees the
          gaps in their ritual. Tapping a present cell opens the
          archive for that day. */}
      {/* Render the strip whenever the user has *ever* used the
          ritual (i.e. there's at least one selfie anywhere in
          memories), even if the current window is all-missed —
          that's the whole point of the missed-day cells. We hide
          the strip only for users who have never taken a daily
          selfie so the recap doesn't get a permanent dead card. */}
      {memories.some((m) =>
        Array.isArray(m.tags) &&
        m.tags.some((t) => typeof t === "string" && t.toLowerCase() === "daily-selfie"),
      ) && (
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              marginBottom: spacing.md,
            },
          ]}
        >
          <Text style={[styles.sectionLabel, { color: colors.primary }]}>
            DAILY SELFIES
          </Text>
          <SelfieStripContainer scroll={windowDays > 30}>
            {selfieStrip.map((cell) => {
              if (cell.kind === "missed") {
                return (
                  <View
                    key={`miss-${cell.date}`}
                    style={[
                      styles.photoStripItem,
                      styles.selfieMissedCell,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.muted ?? colors.background,
                      },
                    ]}
                    accessibilityLabel={`No selfie on ${cell.date}`}
                  >
                    <Ionicons
                      name="ellipse-outline"
                      size={16}
                      color={colors.mutedForeground}
                    />
                  </View>
                );
              }
              const src = cell.memory.photoThumbUrl ?? cell.memory.photoUrl;
              return (
                <TouchableOpacity
                  key={`hit-${cell.date}`}
                  onPress={() => goToArchive({ date: cell.date })}
                  accessibilityLabel={`Open archive for ${cell.date}`}
                  style={[
                    styles.photoStripItem,
                    { borderColor: colors.primary },
                  ]}
                >
                  {src ? (
                    <Image
                      source={{ uri: src }}
                      style={styles.photoStripImage}
                      contentFit="cover"
                      transition={120}
                    />
                  ) : (
                    <View
                      style={[
                        styles.photoStripImage,
                        styles.selfieMissedCell,
                        { backgroundColor: colors.muted ?? colors.background },
                      ]}
                    >
                      <Ionicons
                        name="cloud-upload-outline"
                        size={16}
                        color={colors.mutedForeground}
                      />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </SelfieStripContainer>
        </View>
      )}

      {/* Photo strip (Task #372). Tapping a thumb deep-links to the
          Archive filtered to that single day so the user lands on
          the row they came in for. */}
      {photoMemories.length > 0 && (
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              marginBottom: spacing.md,
            },
          ]}
        >
          <Text style={[styles.sectionLabel, { color: colors.primary }]}>
            PHOTOS
          </Text>
          <View style={styles.photoStrip}>
            {photoMemories.map((m) => {
              const src = m.photoThumbUrl ?? m.photoUrl;
              if (!src) return null;
              const day = m.timestamp.slice(0, 10);
              return (
                <TouchableOpacity
                  key={m.id}
                  onPress={() => goToArchive({ date: day })}
                  accessibilityLabel={`Open archive for ${day}`}
                  style={[
                    styles.photoStripItem,
                    { borderColor: colors.border },
                  ]}
                >
                  <Image
                    source={{ uri: src }}
                    style={styles.photoStripImage}
                    contentFit="cover"
                    transition={120}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* People strip */}
      {recap.topPeople.length > 0 && (
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              marginBottom: spacing.md,
            },
          ]}
        >
          <Text style={[styles.sectionLabel, { color: colors.primary }]}>
            PEOPLE ON YOUR MIND
          </Text>
          <View style={styles.chipRow}>
            {recap.topPeople.map((p) => (
              <TouchableOpacity
                key={p.person.toLowerCase()}
                onPress={() => goToArchive({ person: p.person })}
                style={[
                  styles.chip,
                  {
                    backgroundColor: colors.accent + "22",
                    borderColor: colors.accent,
                  },
                ]}
                accessibilityLabel={`Filter Archive by ${p.person}`}
              >
                <Ionicons
                  name="person-outline"
                  size={14}
                  color={colors.accent}
                />
                <Text style={[styles.chipText, { color: colors.accent }]}>
                  {p.person}
                </Text>
                <Text style={[styles.chipCount, { color: colors.accent }]}>
                  {p.count}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Pro: mood mini-chart + Mem-noticed card. Free: single upsell. */}
      {isPro ? (
        <>
          <MoodSparkline recap={recap} />
          {recap.recurringTheme !== null && (
            <View
              style={[
                styles.suggestionCard,
                {
                  backgroundColor: colors.secondary,
                  borderColor: colors.primary,
                },
              ]}
            >
              <View style={styles.suggestionHeader}>
                <Ionicons
                  name="sparkles"
                  size={18}
                  color={colors.primary}
                />
                <Text
                  style={[styles.suggestionTitle, { color: colors.primary }]}
                >
                  Mem noticed…
                </Text>
              </View>
              <Text
                style={[styles.suggestionText, { color: colors.foreground }]}
              >
                {recap.recurringTheme}
              </Text>
            </View>
          )}
        </>
      ) : (
        <ProUpsellCard
          icon="sparkles-outline"
          title={`See your ${windowNoun(windowDays)}ly trends`}
          body={`Upgrade to MemTool Pro to unlock your ${windowDays}-day mood chart and the patterns Mem has noticed in your memories.`}
        />
      )}
    </SettleOnMount>
  );
}

interface SelfieStripContainerProps {
  /** When true, render the strip in a horizontally scrollable row
   *  (newest first). When false, fall back to the wrapping flex
   *  layout shared with the photo strip. The Recap screen flips
   *  this on for the 90- and 365-day tabs where a wrapped grid
   *  would dominate the card. */
  scroll: boolean;
  children: React.ReactNode;
}

/**
 * Wrapper around the daily-selfie cells. For the short windows
 * (7 / 30 day tabs) we keep the existing wrapping flex layout so
 * the strip renders inline. For longer windows we switch to a
 * horizontal ScrollView so the recap card stays compact and the
 * user can scrub through the full series — newest cells already
 * sit at the leading edge thanks to the reverse() in selfieStrip.
 */
function SelfieStripContainer({ scroll, children }: SelfieStripContainerProps) {
  if (!scroll) {
    return <View style={styles.photoStrip}>{children}</View>;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.selfieScrollContent}
    >
      {children}
    </ScrollView>
  );
}

interface HeatmapUpsellLineProps {
  windowDays: number;
  onPress: () => void;
}

/**
 * Free-tier counterpart to the heatmap. A single tappable line
 * that nudges toward the subscription screen — kept compact on
 * purpose so it doesn't compete with the existing Pro upsell card
 * at the bottom of the view (mirrors the mood-chart Pro gate).
 */
function HeatmapUpsellLine({ windowDays, onPress }: HeatmapUpsellLineProps) {
  const colors = useColors();
  return (
    <LiftPress
      onPress={onPress}
      style={[
        styles.heatmapUpsell,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Upgrade to MemTool Pro to unlock the memory activity heatmap"
    >
      <Ionicons name="grid-outline" size={16} color={colors.primary} />
      <Text
        style={[styles.heatmapUpsellText, { color: colors.foreground }]}
        numberOfLines={1}
      >
        See your {windowDays}-day memory heatmap with Pro
      </Text>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={colors.mutedForeground}
      />
    </LiftPress>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lgCard,
  },
  counterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  counterTitle: {
    ...text.helper,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  counterValue: {
    // 22: deliberate one-off, between text.sectionTitle (20) and
    // text.cardTitle (24). Keeps the headline counter punchy without
    // crowding the surrounding card.
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
  },
  counterMeta: {
    ...text.caption,
    marginTop: 6,
  },
  sectionLabel: {
    ...text.captionStrong,
    // 800: section labels intentionally request 800 so platforms with
    // synthetic boldening still emphasise them above adjacent
    // captionStrong copy. Inter_700Bold is the actual loaded family.
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    // 20: deliberate one-off — pill chip sits between radius.sm (12)
    // and radius.lg (24); matches the recap chips on the home screen.
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  chipCount: {
    // 11: deliberate one-off, sized down from text.caption (12) so the
    // tally never visually competes with the chip label.
    fontSize: 11,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    opacity: 0.7,
  },
  photoStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  photoStripItem: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  photoStripImage: {
    width: "100%",
    height: "100%",
  },
  selfieMissedCell: {
    alignItems: "center",
    justifyContent: "center",
  },
  selfieScrollContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    // Tiny trailing inset so the final cell doesn't sit flush against
    // the card's right padding when the user scrolls all the way to
    // the oldest day in the window.
    paddingRight: spacing.xs,
  },
  heatmapUpsell: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  heatmapUpsellText: {
    flex: 1,
    // 13: deliberate one-off, matches chipText.
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  suggestionCard: {
    padding: spacing.lgCard,
    // 20: deliberate one-off, matches the upsell card's softer feel.
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  suggestionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: spacing.sm,
  },
  suggestionTitle: {
    ...text.helper,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  suggestionText: {
    // 15: deliberate one-off, between text.helper (14) and text.body (16).
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  coldStartContent: {
    alignItems: "center",
    paddingVertical: spacing.base,
  },
  coldStartIcon: { marginBottom: spacing.md },
  coldStartTitle: {
    ...text.cardHeading,
    marginBottom: 6,
    textAlign: "center",
  },
  coldStartBody: {
    ...text.helperRegular,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: spacing.base,
  },
  coldStartCounter: {
    ...text.helper,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
