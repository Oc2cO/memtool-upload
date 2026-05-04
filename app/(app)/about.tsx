/**
 * "Watch the MemTool story" — About screen.
 *
 * Plays the three brand voiceover segments (`seg-vo-01..03.mp4`) back
 * to back as a single coherent story. Captions are burned into each
 * MP4 at export time (see `assets/brand/captions/brand-seg{1..3}.ass`),
 * so we don't need a separate caption renderer here.
 *
 * Linked from Settings → "Our story".
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

const SEGMENTS = [
  require("@/assets/brand/seg-vo-01.mp4"),
  require("@/assets/brand/seg-vo-02.mp4"),
  require("@/assets/brand/seg-vo-03.mp4"),
] as const;

const SEGMENT_LABELS = ["Two sparks", "Organized chaos", "Meet MemTool"] as const;

export default function AboutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const advancedFor = useRef<number | null>(null);

  const source = finished ? null : SEGMENTS[index];

  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.muted = false;
    p.play();
  });

  // Advance to the next segment when the current one finishes.
  useEffect(() => {
    if (finished) return;
    advancedFor.current = null;
    const sub = player.addListener("playToEnd", () => {
      if (advancedFor.current === index) return;
      advancedFor.current = index;
      if (index < SEGMENTS.length - 1) {
        setIndex((i) => i + 1);
      } else {
        setFinished(true);
      }
    });
    return () => sub?.remove();
  }, [player, index, finished]);

  const handleBack = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    router.back();
  }, [router]);

  const handleReplay = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    advancedFor.current = null;
    setFinished(false);
    setIndex(0);
  }, []);

  const segmentDots = useMemo(
    () => SEGMENTS.map((_, i) => i),
    [],
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Our story
        </Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.videoWrap}>
        <View style={[styles.videoFrame, { borderColor: colors.border }]}>
          {finished ? (
            <View
              style={[
                styles.endCard,
                { backgroundColor: colors.card },
              ]}
            >
              <Ionicons
                name="sparkles-outline"
                size={36}
                color={colors.primary}
              />
              <Text style={[styles.endTitle, { color: colors.foreground }]}>
                That's the MemTool story.
              </Text>
              <Text
                style={[styles.endSubtitle, { color: colors.mutedForeground }]}
              >
                Two sparks, organized chaos, one shared memory.
              </Text>
              <Pressable
                onPress={handleReplay}
                style={({ pressed }) => [
                  styles.replayBtn,
                  { backgroundColor: colors.primary },
                  pressed && { opacity: 0.8 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Replay story"
                testID="about-replay"
              >
                <Ionicons
                  name="play"
                  size={16}
                  color={colors.background}
                />
                <Text
                  style={[styles.replayText, { color: colors.background }]}
                >
                  Watch again
                </Text>
              </Pressable>
            </View>
          ) : (
            <VideoView
              key={`seg-${index}`}
              player={player}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              nativeControls={false}
              testID={`about-video-${index}`}
            />
          )}
        </View>

        <View style={styles.dotsRow}>
          {segmentDots.map((i) => {
            const active = !finished && i === index;
            const watched = finished || i < index;
            return (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    width: active ? 24 : 8,
                    backgroundColor: active
                      ? colors.primary
                      : watched
                        ? colors.accent
                        : colors.border,
                  },
                ]}
              />
            );
          })}
        </View>
        <Text style={[styles.segmentLabel, { color: colors.mutedForeground }]}>
          {finished
            ? `${SEGMENTS.length} of ${SEGMENTS.length} • Complete`
            : `${index + 1} of ${SEGMENTS.length} • ${SEGMENT_LABELS[index]}`}
        </Text>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
          Captions are burned into each segment. Tap "Watch again" to replay.
        </Text>
      </View>
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
  videoWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    alignItems: "center",
  },
  videoFrame: {
    width: "100%",
    aspectRatio: 9 / 16,
    maxHeight: "80%",
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  endCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.base,
  },
  endTitle: {
    ...text.cardTitle,
    textAlign: "center",
  },
  endSubtitle: {
    ...text.caption,
    textAlign: "center",
    lineHeight: 20,
  },
  replayBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    marginTop: spacing.base,
  },
  replayText: { ...text.bodyMedium },
  dotsRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.base,
  },
  dot: { height: 8, borderRadius: 4 },
  segmentLabel: {
    ...text.caption,
    marginTop: spacing.xs,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  footerText: {
    ...text.caption,
    textAlign: "center",
  },
});
