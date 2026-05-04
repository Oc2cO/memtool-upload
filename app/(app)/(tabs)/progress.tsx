import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Rect, Text as SvgText } from "react-native-svg";

import { useColors } from "@/hooks/useColors";
import { useMemories } from "@/context/MemoriesContext";
import { useGameStats } from "@/context/GameStatsContext";
import { formatChartLabel } from "@/lib/dates";
import { EmptyState } from "@/components/EmptyState";
import { MemCharacter } from "@/components/MemCharacter";
import { MEM_STATES } from "@/lib/memStates";
import { useSkills } from "@/context/SkillsContext";
import { SKILLS, ownsBundle } from "@/lib/skillsBundle";

interface DayBucket {
  date: Date;
  label: string;
  count: number;
}

export default function ProgressScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { memories } = useMemories();
  const { stats } = useGameStats();
  const { owned } = useSkills();
  const skillsOwnedCount = SKILLS.filter(
    (s) => owned.has(s.entitlementKey) || owned.has("skills_bundle_1"),
  ).length;
  const showSkillsCard = true;
  const skillsCardLabel = ownsBundle(owned)
    ? "Bundle 1 unlocked · all 4 skills ready"
    : skillsOwnedCount > 0
      ? `${skillsOwnedCount} of ${SKILLS.length} skills unlocked`
      : "Try a brain mini-game · 4 to choose from";

  // Cold-start guard. Without this the screen would render four
  // zeroed stat tiles, an empty bar chart, and "-" rows for every
  // game best — visually it looks like a loading bug, and there's no
  // CTA toward what the user actually needs to do (capture a memory
  // or play a game). Once either source has any data we fall through
  // to the real layout below.
  const hasMemories = memories.length > 0;
  const hasGames =
    stats.memoryMatchGamesPlayed + stats.game24GamesPlayed > 0;
  const isEmpty = !hasMemories && !hasGames;

  const weeklyData = useMemo<DayBucket[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days: DayBucket[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push({
        date: d,
        label: formatChartLabel(d, "weekday"),
        count: 0,
      });
    }

    memories.forEach((m) => {
      const mDate = new Date(m.timestamp);
      mDate.setHours(0, 0, 0, 0);
      const day = days.find((d) => d.date.getTime() === mDate.getTime());
      if (day) {
        day.count += 1;
      }
    });

    return days;
  }, [memories]);

  const maxCount = Math.max(...weeklyData.map((d) => d.count), 1);
  const chartHeight = 150;
  const chartWidth = 300;
  const barWidth = 24;
  const spacing = (chartWidth - barWidth * 7) / 6;

  const currentStreak = Math.max(
    stats.game24CurrentStreak.easy,
    stats.game24CurrentStreak.medium,
    stats.game24CurrentStreak.hard,
  );
  const longestStreak = Math.max(
    stats.game24BestStreak.easy,
    stats.game24BestStreak.medium,
    stats.game24BestStreak.hard,
  );

  const formatBest = (best: { moves: number; timeSec: number | null } | null) => {
    if (!best) return "-";
    const t = best.timeSec != null ? ` · ${best.timeSec}s` : "";
    return `${best.moves} moves${t}`;
  };

  if (isEmpty) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
      >
        <View style={[styles.header, { backgroundColor: colors.background }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Progress
          </Text>
        </View>
        <EmptyState
          icon="trending-up"
          title="No progress to show yet"
          description="Capture a memory or play a quick game and your weekly chart, streaks, and best scores will start filling in here."
          action={{
            label: "Capture a memory",
            onPress: () => router.push("/capture"),
            accessibilityLabel: "Capture your first memory",
          }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Progress</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>
        {showSkillsCard ? (
          <View
            style={[styles.skillsCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.skillsCardHeader}>
              <Ionicons name="sparkles" size={20} color={colors.primary} />
              <Text style={[styles.skillsCardTitle, { color: colors.foreground }]}>
                Companion Skills
              </Text>
            </View>
            <Text style={[styles.skillsCardSubtitle, { color: colors.mutedForeground }]}>
              {skillsCardLabel}
            </Text>
            <Text
              accessibilityRole="link"
              onPress={() => router.push("/skills")}
              style={[styles.skillsCardCta, { color: colors.primary }]}
            >
              {ownsBundle(owned) || skillsOwnedCount > 0 ? "Open Skills →" : "Browse Skills →"}
            </Text>
          </View>
        ) : null}
        <View style={styles.statsGrid}>
          <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="journal" size={24} color={colors.primary} />
            <Text style={[styles.statValue, { color: colors.foreground }]}>{memories.length}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total Memories</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {currentStreak >= 3 ? (
              // Celebrating Mem (Task #340) for a streak that has
              // genuinely accrued. ≥3 is the wellness-app threshold —
              // small enough that real users hit it, big enough that
              // a one-day fluke doesn't trigger party energy. Below
              // that we keep the flame icon so a fresh streak still
              // reads as itself.
              <View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <MemCharacter size={32} expression={MEM_STATES.celebrating.expression} />
              </View>
            ) : (
              <Ionicons name="flame" size={24} color={colors.destructive} />
            )}
            <Text style={[styles.statValue, { color: colors.foreground }]}>{currentStreak}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Current 24 Streak</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="trophy" size={24} color="#f59e0b" />
            <Text style={[styles.statValue, { color: colors.foreground }]}>{longestStreak}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Longest 24 Streak</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="game-controller" size={24} color={colors.accent} />
            <Text style={[styles.statValue, { color: colors.foreground }]}>{stats.memoryMatchGamesPlayed + stats.game24GamesPlayed}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Games Played</Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Weekly Memories</Text>
        <View style={[styles.chartContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Svg width="100%" height={chartHeight + 30} viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`}>
            {weeklyData.map((d, i) => {
              const height = (d.count / maxCount) * chartHeight;
              const x = i * (barWidth + spacing);
              const y = chartHeight - height;
              return (
                <React.Fragment key={i}>
                  <Rect x={x} y={y} width={barWidth} height={height} fill={colors.primary} rx={4} />
                  <SvgText
                    x={x + barWidth / 2}
                    y={chartHeight + 20}
                    fill={colors.mutedForeground}
                    fontSize={12}
                    textAnchor="middle"
                  >
                    {d.label}
                  </SvgText>
                  {d.count > 0 && (
                    <SvgText
                      x={x + barWidth / 2}
                      y={y - 8}
                      fill={colors.foreground}
                      fontSize={12}
                      textAnchor="middle"
                    >
                      {String(d.count)}
                    </SvgText>
                  )}
                </React.Fragment>
              );
            })}
          </Svg>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Memory Match Bests</Text>
        <View style={[styles.bestScores, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.scoreRow}>
            <Text style={[styles.scoreLabel, { color: colors.foreground }]}>Easy (4 pairs)</Text>
            <Text style={[styles.scoreValue, { color: colors.accent }]}>
              {formatBest(stats.memoryMatchBestScore.easy)}
            </Text>
          </View>
          <View style={[styles.scoreRow, { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <Text style={[styles.scoreLabel, { color: colors.foreground }]}>Medium (8 pairs)</Text>
            <Text style={[styles.scoreValue, { color: colors.accent }]}>
              {formatBest(stats.memoryMatchBestScore.medium)}
            </Text>
          </View>
          <View style={[styles.scoreRow, { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <Text style={[styles.scoreLabel, { color: colors.foreground }]}>Hard (12 pairs)</Text>
            <Text style={[styles.scoreValue, { color: colors.accent }]}>
              {formatBest(stats.memoryMatchBestScore.hard)}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16 },
  title: { fontSize: 28, fontWeight: "700", fontFamily: "Inter_700Bold" },
  scrollContent: { paddingHorizontal: 24, paddingTop: 8 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginBottom: 32 },
  skillsCard: {
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginBottom: 24,
    gap: 6,
  },
  skillsCardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  skillsCardTitle: { fontSize: 16, fontWeight: "600" },
  skillsCardSubtitle: { fontSize: 13 },
  skillsCardCta: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  statBox: { width: "47%", padding: 16, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 24, fontWeight: "700", fontFamily: "Inter_700Bold", marginVertical: 8 },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
  sectionTitle: { fontSize: 20, fontWeight: "600", fontFamily: "Inter_600SemiBold", marginBottom: 16 },
  chartContainer: { padding: 24, borderRadius: 16, borderWidth: 1, alignItems: "center", marginBottom: 32 },
  bestScores: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  scoreRow: { flexDirection: "row", justifyContent: "space-between", padding: 16 },
  scoreLabel: { fontSize: 16, fontFamily: "Inter_500Medium" },
  scoreValue: { fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
