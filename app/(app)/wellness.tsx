import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated from "react-native-reanimated";
import Slider from "@react-native-community/slider";

import { useColors } from "@/hooks/useColors";
import { useMood } from "@/context/MoodContext";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { useHaptics } from "@/lib/haptics";
import { useCognitiveAudio } from "@/lib/cognitiveAudio";
import { GradientButton } from "@/components/GradientButton";
import { SettleOnMount } from "@/components/alive/SettleOnMount";
import { Toast } from "@/components/Toast";
import { MemMomentCard } from "@/components/MemMomentCard";
import { BreatheModal } from "@/components/BreatheModal";
import {
  RecallMemorySheet,
  type RecallMemorySheetProps,
} from "@/components/RecallMemorySheet";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useBreathingEnabled } from "@/lib/aliveUI";
import { cardEntering } from "@/lib/animationTokens";
import { formatChartLabel } from "@/lib/dates";
import { trackEvent } from "@/lib/analytics";
import {
  LOW_MOOD_THRESHOLD,
  hasShownMemMomentToday,
  markMemMomentShownToday,
  useMemMomentEnabled,
} from "@/lib/moodMoment";
import { fetchPositiveMemory } from "@/lib/recallMemory";
import { grantStreakFreeze } from "@/lib/streak";

export default function WellnessScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { history, todayLog, setStress } = useMood();
  const { user } = useAuth();
  const { profile } = useProfile();
  const motionEnabled = useBreathingEnabled();
  const haptics = useHaptics();
  useCognitiveAudio("sleep");
  // Task #346 opt-out: when the user has flipped the Settings toggle
  // off, skip the MemMomentCard branch entirely and behave like the
  // pre-Task #336 wellness flow (pop back after save).
  const memMomentEnabled = useMemMomentEnabled();

  const [stress, setLocalStress] = useState(todayLog?.stress || 3);
  const [saveError, setSaveError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // After a successful low-mood save, this flips on and replaces the
  // post-save back-out with the MemMomentCard surface (Task #336).
  // Cleared when the user picks any of the four exit affordances
  // (breathe / recall / sit / skip) so the screen doesn't get stuck
  // on the card after they're done.
  const [showMemMoment, setShowMemMoment] = useState(false);
  const [breatheOpen, setBreatheOpen] = useState(false);
  const [recallOpen, setRecallOpen] = useState(false);
  const [recallContent, setRecallContent] =
    useState<RecallMemorySheetProps["memoryContent"]>(null);
  const [recallTimestamp, setRecallTimestamp] =
    useState<RecallMemorySheetProps["memoryTimestamp"]>(null);

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(false);
    try {
      await setStress(stress);
      haptics.play("capture");
      // Earn-a-freeze loop (Task #368). Best-effort: a granted
      // freeze is a perk, never a precondition. The server handles
      // the once-per-day rate limit and the stockpile cap, so a
      // user who's already at the cap or has already earned today
      // gets a quiet no-op (we don't surface either as an error —
      // the wellness check-in already succeeded). Pro users still
      // benefit (capped at maxFreezeStockpile).
      void grantStreakFreeze("wellness_checkin").catch(() => {
        // Silently swallow — the wellness save already succeeded
        // and the streak chip will reflect any granted freeze on
        // the home screen's next refresh.
      });
      // Branch: low mood → present MemMomentCard inline (once per
      // calendar day, per `memMomentDayKey`). Otherwise behave like
      // before and pop back to the previous screen.
      const email = user?.email;
      const isLow = stress <= LOW_MOOD_THRESHOLD;
      const alreadyShown = email
        ? await hasShownMemMomentToday(email)
        : false;
      if (isLow && email && !alreadyShown && memMomentEnabled) {
        await markMemMomentShownToday(email);
        trackEvent("mood_low_logged", { source: "wellness", stress });
        setShowMemMoment(true);
      } else {
        router.back();
      }
    } catch (err) {
      console.warn("[wellness] setStress failed", err);
      haptics.play("error");
      setSaveError(true);
      setTimeout(() => setSaveError(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRecall = async () => {
    trackEvent("mood_action_recall", { source: "wellness" });
    setRecallContent(null);
    setRecallTimestamp(null);
    setRecallOpen(true);
    try {
      const res = await fetchPositiveMemory();
      setRecallContent(res.memory?.content ?? null);
      setRecallTimestamp(res.memory?.timestamp ?? null);
    } catch (err) {
      console.warn("[wellness] recall fetch failed", err);
      setRecallContent(null);
      setRecallTimestamp(null);
    }
  };

  const handleBreathe = () => {
    trackEvent("mood_action_breathe", { source: "wellness" });
    setBreatheOpen(true);
  };

  const handleSit = () => {
    trackEvent("mood_action_sit", { source: "wellness" });
    // Brief presence beat so the user isn't kicked back instantly —
    // matches the spec's "2s presence animation" intent without
    // pulling in another animation surface.
    setTimeout(() => {
      setShowMemMoment(false);
      router.back();
    }, 2000);
  };

  const handleSkip = () => {
    trackEvent("mood_action_skip", { source: "wellness" });
    setShowMemMoment(false);
    router.back();
  };

  const closeBreathe = () => {
    setBreatheOpen(false);
    setShowMemMoment(false);
    router.back();
  };

  const closeRecall = () => {
    setRecallOpen(false);
    setShowMemMoment(false);
    router.back();
  };

  const last7Days = history.slice(0, 7).reverse();
  const maxRating = 5;
  const chartHeight = 100;
  const barWidth = 30;
  const gap = 10;

  return (
    <SettleOnMount style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Toast
        message="Couldn't save — try again"
        icon="alert-circle"
        iconColor={colors.destructive ?? colors.primary}
        visible={saveError}
      />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="close" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Wellness Logger</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {showMemMoment && (
          <Animated.View
            entering={cardEntering(0, motionEnabled)}
            style={{ marginBottom: spacing.lg }}
          >
            <MemMomentCard
              profile={profile}
              displayName={user?.display_name}
              onBreathe={handleBreathe}
              onRecall={handleRecall}
              onSit={handleSit}
              onSkip={handleSkip}
            />
          </Animated.View>
        )}

        <Animated.View
          entering={cardEntering(0, motionEnabled)}
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Daily Stress Level</Text>
          <Text style={[styles.stressValue, { color: colors.primary }]}>{stress}</Text>
          
          <View style={styles.sliderContainer}>
            <Text style={{ color: colors.mutedForeground }}>Low</Text>
            <Slider
              style={{ flex: 1, marginHorizontal: 10, height: 40 }}
              minimumValue={1}
              maximumValue={5}
              step={1}
              value={stress}
              onValueChange={(val) => {
                const next = Math.round(val);
                if (next !== stress) {
                  setLocalStress(next);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
              }}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.primary}
              accessibilityLabel="Stress level"
            />
            <Text style={{ color: colors.mutedForeground }}>High</Text>
          </View>
          
          <GradientButton title="Save Stress Level" onPress={handleSave} style={{ marginTop: spacing.lg }} />
        </Animated.View>

        <Animated.View
          entering={cardEntering(1, motionEnabled)}
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: spacing.lg }]}
        >
          <Text style={[styles.cardTitle, { color: colors.foreground, marginBottom: spacing.base }]}>Mood History (Last 7 Days)</Text>
          
          {last7Days.length === 0 ? (
            <View style={{ height: chartHeight, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[text.helperRegular, { color: colors.mutedForeground }]}>
                Log your first stress level to start the chart.
              </Text>
            </View>
          ) : (
            <View style={{ height: chartHeight, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' }}>
              {last7Days.map((log, i) => (
                <View key={i} style={{ alignItems: 'center', marginHorizontal: 5 }}>
                  <View 
                    style={{ 
                      width: barWidth, 
                      height: (log.rating / maxRating) * chartHeight, 
                      backgroundColor: colors.primary,
                      borderRadius: 4
                    }} 
                  />
                  <Text style={[text.tiny, { color: colors.mutedForeground, marginTop: 4 }]}>
                    {formatChartLabel(log.date, "monthDay")}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Animated.View>

      </ScrollView>

      <BreatheModal visible={breatheOpen} onClose={closeBreathe} />
      <RecallMemorySheet
        visible={recallOpen}
        memoryContent={recallContent}
        memoryTimestamp={recallTimestamp}
        onClose={closeRecall}
        onTalkToMem={() => {
          setRecallOpen(false);
          setShowMemMoment(false);
          router.replace("/ai-guide");
        }}
      />
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
    paddingBottom: spacing.base,
  },
  backButton: { padding: spacing.sm },
  title: {
    ...text.sectionTitle,
  },
  scrollContent: { padding: spacing.lg },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  cardTitle: {
    ...text.cardLabel,
    marginBottom: spacing.sm,
  },
  stressValue: {
    // 48: deliberate one-off, hero numeric only used here. Larger
    // than text.brand (42) to keep the focal stress digit visually
    // dominant inside the card.
    fontSize: 48,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    textAlign: 'center',
    marginVertical: spacing.base,
  },
  sliderContainer: { flexDirection: 'row', alignItems: 'center' },
});
