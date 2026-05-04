import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";

import { useColors } from "@/hooks/useColors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import {
  LEVELS_PER_GAME,
  LEVEL_CHAPTERS,
  MAX_STARS_PER_GAME,
  highestUnlockedLevel,
  levelLockState,
  nextMilestone,
  totalStarsEarned,
  versusLevelLockState,
  type LevelChapter,
  type LevelLockState,
  type LevelProgress,
  type LevelProgressMap,
} from "@/lib/gameLevels";
import type { VersusRecord } from "@/lib/gameStats";

interface LevelLadderProps {
  progress: LevelProgressMap;
  isPro: boolean;
  onSelect: (level: number, lockState: LevelLockState) => void;
  onVersusSelect?: (level: number, versusLock: LevelLockState) => void;
  /**
   * Versus history per level (Task #329). Drives the W-L badge on
   * unlocked tiles and is forwarded to `onVersusInfo` so the screen
   * can open a stats popover.
   */
  versusProgress?: Record<number, VersusRecord>;
  onVersusInfo?: (level: number, record: VersusRecord | null) => void;
}

/**
 * Themed ladder of all 30 levels, grouped into chapter sections.
 *
 * Each chapter renders a banner + a serpentine column of tiles
 * connected by a soft path. The currently-unlocked tile pulses to
 * draw the eye. The header summarizes total stars earned and the
 * next milestone reward.
 */
export function LevelLadder({
  progress,
  isPro,
  onSelect,
  onVersusSelect,
  versusProgress,
  onVersusInfo,
}: LevelLadderProps) {
  const colors = useColors();
  const unlocked = highestUnlockedLevel(progress);
  const totalStars = totalStarsEarned(progress);
  const next = nextMilestone(progress);
  const completionPct = Math.round((totalStars / MAX_STARS_PER_GAME) * 100);

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.headerCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.headerRow}>
          <Ionicons name="star" size={20} color={colors.accent} />
          <Text style={[styles.headerStars, { color: colors.foreground }]}>
            {totalStars}
            <Text style={[styles.headerStarsTotal, { color: colors.mutedForeground }]}>
              {" "}
              / {MAX_STARS_PER_GAME} stars
            </Text>
          </Text>
        </View>
        <View
          style={[styles.progressTrack, { backgroundColor: colors.muted }]}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`${totalStars} of ${MAX_STARS_PER_GAME} stars earned`}
        >
          <View
            style={[
              styles.progressFill,
              {
                width: `${completionPct}%`,
                backgroundColor: colors.accent,
              },
            ]}
          />
        </View>
        {next ? (
          <View style={styles.milestoneRow}>
            <Text style={styles.milestoneGlyph}>{next.glyph}</Text>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.milestoneTitle, { color: colors.foreground }]}
              >
                Next: {next.title}
              </Text>
              <Text
                style={[styles.milestoneHint, { color: colors.mutedForeground }]}
                numberOfLines={2}
              >
                Clear level {next.level} — {next.description}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.milestoneRow}>
            <Text style={styles.milestoneGlyph}>🏆</Text>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.milestoneTitle, { color: colors.foreground }]}
              >
                All milestones cleared
              </Text>
              <Text
                style={[styles.milestoneHint, { color: colors.mutedForeground }]}
              >
                Chase 3-star runs to top up your stars.
              </Text>
            </View>
          </View>
        )}
      </View>

      {LEVEL_CHAPTERS.map((chapter) => (
        <ChapterSection
          key={chapter.id}
          chapter={chapter}
          progress={progress}
          isPro={isPro}
          unlocked={unlocked}
          onSelect={onSelect}
          onVersusSelect={onVersusSelect}
          versusProgress={versusProgress}
          onVersusInfo={onVersusInfo}
        />
      ))}
    </View>
  );
}

function ChapterSection({
  chapter,
  progress,
  isPro,
  unlocked,
  onSelect,
  onVersusSelect,
  versusProgress,
  onVersusInfo,
}: {
  chapter: LevelChapter;
  progress: LevelProgressMap;
  isPro: boolean;
  unlocked: number;
  onSelect: (level: number, lockState: LevelLockState) => void;
  onVersusSelect?: (level: number, versusLock: LevelLockState) => void;
  versusProgress?: Record<number, VersusRecord>;
  onVersusInfo?: (level: number, record: VersusRecord | null) => void;
}) {
  const colors = useColors();
  const levels: number[] = [];
  for (let n = chapter.startLevel; n <= chapter.endLevel; n++) levels.push(n);
  const cleared = levels.filter((n) => !!progress[n]).length;

  return (
    <View
      style={[
        styles.chapter,
        {
          backgroundColor: chapter.background,
          borderColor: chapter.accent + "55",
        },
      ]}
    >
      <View style={styles.chapterBanner}>
        <Text style={styles.chapterGlyph}>{chapter.glyph}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.chapterTitle, { color: colors.foreground }]}>
            {chapter.title}
          </Text>
          <Text
            style={[styles.chapterSubtitle, { color: colors.mutedForeground }]}
          >
            {chapter.subtitle} · {cleared}/{levels.length} cleared
          </Text>
        </View>
      </View>

      <View style={styles.ladder}>
        {levels.map((lvl, i) => {
          const lockState = levelLockState(lvl, progress, isPro);
          const isCurrent = lvl === unlocked && lockState === "unlocked";
          // Serpentine: alternate left / center / right within the
          // chapter so the path zig-zags rather than being a flat
          // column. The connector line is rendered behind the tile.
          const offset = i % 2 === 0 ? -36 : 36;
          return (
            <View key={lvl} style={styles.ladderRow}>
              {i > 0 && (
                <View
                  style={[
                    styles.connector,
                    { backgroundColor: chapter.accent + "66" },
                  ]}
                />
              )}
              <View style={{ transform: [{ translateX: offset }] }}>
                <LevelTile
                  level={lvl}
                  lockState={lockState}
                  versusLock={versusLevelLockState(lvl, progress, isPro)}
                  progress={progress[lvl]}
                  versusRecord={versusProgress?.[lvl]}
                  isCurrent={isCurrent}
                  accent={chapter.accent}
                  onPress={() => onSelect(lvl, lockState)}
                  onLongPress={
                    onVersusSelect
                      ? () =>
                          onVersusSelect(
                            lvl,
                            versusLevelLockState(lvl, progress, isPro),
                          )
                      : undefined
                  }
                  onVersusInfo={
                    onVersusInfo
                      ? () =>
                          onVersusInfo(lvl, versusProgress?.[lvl] ?? null)
                      : undefined
                  }
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function LevelTile({
  level,
  lockState,
  versusLock,
  progress,
  versusRecord,
  isCurrent,
  accent,
  onPress,
  onLongPress,
  onVersusInfo,
}: {
  level: number;
  lockState: LevelLockState;
  versusLock?: LevelLockState;
  progress?: LevelProgress;
  versusRecord?: VersusRecord;
  isCurrent: boolean;
  accent: string;
  onPress: () => void;
  onLongPress?: () => void;
  onVersusInfo?: () => void;
}) {
  const colors = useColors();
  const cleared = !!progress;
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (isCurrent) {
      pulse.value = withRepeat(
        withTiming(1.08, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [isCurrent, pulse]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const accessibilityLabel =
    lockState === "pro-locked"
      ? `Level ${level}, Pro locked`
      : lockState === "locked"
        ? `Level ${level}, locked`
        : cleared
          ? `Level ${level}, ${progress?.stars} stars`
          : `Level ${level}, unlocked`;

  // Versus history badge (Task #329) is only meaningful once the level
  // has been cleared (versus mode unlocks at solo-cleared per
  // versusLevelLockState). currentStreak ≥ 2 turns the badge into a
  // small flame to celebrate an active win streak.
  const versusUnlocked = versusLock === "unlocked";
  const wins = versusRecord?.wins ?? 0;
  const losses = versusRecord?.losses ?? 0;
  const draws = versusRecord?.draws ?? 0;
  const totalMatches = wins + losses + draws;
  const currentStreak = versusRecord?.currentStreak ?? 0;
  const showVersusBadge = versusUnlocked && totalMatches > 0;
  const showInfoButton = versusUnlocked && !!onVersusInfo;
  const versusBadgeLabel = showVersusBadge
    ? `Versus record level ${level}: ${wins} wins, ${losses} losses, ${draws} draws${currentStreak >= 2 ? `, current streak ${currentStreak}` : ""}`
    : undefined;

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={
          onLongPress && versusLock !== "locked"
            ? "Long press to challenge Mem"
            : undefined
        }
        style={[
          tileStyles.tile,
          {
            backgroundColor: colors.card,
            borderColor: isCurrent ? accent : colors.border,
            borderWidth: isCurrent ? 2 : 1,
            opacity: lockState === "locked" ? 0.55 : 1,
            shadowColor: isCurrent ? accent : "#000",
            shadowOpacity: isCurrent ? 0.4 : 0.15,
          },
        ]}
      >
        <Text style={[tileStyles.num, { color: colors.foreground }]}>{level}</Text>
        {lockState === "pro-locked" ? (
          <Ionicons name="lock-closed" size={14} color={colors.accent} />
        ) : lockState === "locked" ? (
          <Ionicons name="lock-closed" size={14} color={colors.mutedForeground} />
        ) : cleared ? (
          <View style={tileStyles.starsRow}>
            {[1, 2, 3].map((i) => (
              <Ionicons
                key={i}
                name={i <= (progress?.stars ?? 0) ? "star" : "star-outline"}
                size={10}
                color={colors.accent}
              />
            ))}
          </View>
        ) : (
          <Ionicons name="play" size={12} color={accent} />
        )}
      </Pressable>
      {showVersusBadge ? (
        <View
          style={[
            tileStyles.versusBadge,
            {
              backgroundColor: colors.muted,
              borderColor: colors.border,
            },
          ]}
          accessible
          accessibilityLabel={versusBadgeLabel}
        >
          <Text
            style={[tileStyles.versusBadgeText, { color: colors.foreground }]}
          >
            {wins}-{losses}
            {draws > 0 ? `-${draws}` : ""}
          </Text>
          {currentStreak >= 2 ? (
            <Ionicons name="flame" size={10} color={colors.accent} />
          ) : null}
        </View>
      ) : null}
      {showInfoButton ? (
        <Pressable
          onPress={onVersusInfo}
          accessibilityRole="button"
          accessibilityLabel={`Versus stats for level ${level}`}
          hitSlop={6}
          style={[
            tileStyles.infoBtn,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons
            name="information-circle-outline"
            size={14}
            color={colors.mutedForeground}
          />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const tileStyles = StyleSheet.create({
  tile: {
    width: 76,
    height: 76,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 3,
  },
  num: { ...text.cardLabel, marginBottom: 4 },
  starsRow: { flexDirection: "row", gap: 1 },
  versusBadge: {
    position: "absolute",
    top: -8,
    right: -10,
    minWidth: 26,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  versusBadgeText: {
    ...text.caption,
    fontSize: 10,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  infoBtn: {
    position: "absolute",
    bottom: -10,
    right: -10,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

const styles = StyleSheet.create({
  root: { padding: spacing.lg, paddingBottom: 40 },
  headerCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.base,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerStars: {
    ...text.cardHeading,
  },
  headerStarsTotal: {
    ...text.body,
    fontWeight: "400",
    fontFamily: "Inter_400Regular",
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  milestoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  milestoneGlyph: { fontSize: 28 },
  milestoneTitle: {
    ...text.bodySemibold,
  },
  milestoneHint: {
    ...text.helperRegular,
  },
  chapter: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    marginBottom: spacing.lg,
  },
  chapterBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.base,
  },
  chapterGlyph: { fontSize: 32 },
  chapterTitle: {
    ...text.cardHeading,
  },
  chapterSubtitle: {
    ...text.caption,
    marginTop: 2,
  },
  ladder: {
    alignItems: "center",
  },
  ladderRow: {
    alignItems: "center",
    justifyContent: "center",
  },
  connector: {
    width: 3,
    height: 18,
    borderRadius: 2,
    marginVertical: 2,
  },
});
