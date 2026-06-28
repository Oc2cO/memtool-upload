import React, { useCallback, useEffect, useState } from "react";
import { Alert, View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";

import { AliveButton } from "@/components/alive/AliveButton";
import { ScalePress } from "@/components/alive/ScalePress";
import { BreatheCard } from "@/components/alive/BreatheCard";
import { GradientBackground } from "@/components/alive/GradientBackground";
import { AmbientBlobs } from "@/components/alive/AmbientBlobs";
import { FrostBackground } from "@/components/alive/FrostBackground";
import { SettleOnMount } from "@/components/alive/SettleOnMount";
import { MemNoticedCard } from "@/components/MemNoticedCard";
import { StreakIndicator } from "@/components/StreakIndicator";
import { StreakRecoveryCard } from "@/components/StreakRecoveryCard";
import { StreakMilestoneOverlay } from "@/components/StreakMilestoneOverlay";
import {
  emitStreakDeltaEvents,
  fetchStreak,
  pendingMilestone,
  type StreakConfig,
  type StreakSnapshot,
} from "@/lib/streak";
import { PRO_MONTHLY_FREEZES } from "@/lib/subscription";
import { MemorySyncStatus, type SyncStatus } from "@/components/MemorySyncStatus";
import { BrandHero } from "@/components/BrandHero";
import { HomeAtriumVisualLayer } from "@/components/home/HomeAtriumVisualLayer";
import { useColors } from "@/hooks/useColors";
import { useMemories } from "@/context/MemoriesContext";
import { useGameStats } from "@/context/GameStatsContext";
import { useAuth } from "@/context/AuthContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { useTips } from "@/context/TipsContext";
import { getIllustrationQuotaState } from "@/lib/captureLimits";
import { useHaptics } from "@/lib/haptics";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  memory: "bulb",
  wellness: "heart",
  productivity: "rocket",
  motivation: "sparkles",
};

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const {
    todayMemories,
    memories,
    illustrationsUsedToday,
    illustrationsLimit,
  } = useMemories();
  // Last 3 captures across the full library, newest-first. Surfaced
  // here so the user has at-a-glance proof their captures landed.
  // Each row carries a MemorySyncStatus indicator (synced / pending /
  // failed) — the same indicator Archive uses, so the visual language
  // is consistent across surfaces.
  const recentCaptures = memories.slice(0, 3);
  const syncStatusFor = (m: (typeof memories)[number]): SyncStatus => {
    if (m.syncFailed) return "failed";
    if (m.pendingSync) return "pending";
    return "synced";
  };
  const { stats } = useGameStats();

  // Caring streak (Task #342). Server-authoritative state — we
  // re-pull whenever the user lands on the home tab and whenever
  // the captured-today count changes (a fresh capture is the only
  // local event that can move the streak forward without a server
  // round-trip we initiated). The fetch is cold-start safe: no
  // token = empty snapshot, so the chip never crashes a logged-out
  // render.
  const [streak, setStreak] = useState<StreakSnapshot | null>(null);
  const [streakConfig, setStreakConfig] = useState<StreakConfig | null>(null);
  const [celebratedMilestone, setCelebratedMilestone] = useState<number | null>(
    null,
  );
  const refreshStreak = useCallback(async () => {
    const r = await fetchStreak();
    // Defense-in-depth client diff. Authoritative analytics are
    // emitted server-side from the capture mutation path; this
    // diff catches any state visible to the client that the
    // server logs missed (e.g. background refill on read). On a
    // fallback (network/auth failure), KEEP the prior snapshot
    // so we don't render a false zeroed streak AND don't fire
    // a false `streak_broken` event.
    if (r.source === "fallback") {
      setStreakConfig((prev) => prev ?? r.config);
      return;
    }
    setStreak((prev) => {
      emitStreakDeltaEvents(prev, r.streak);
      return r.streak;
    });
    setStreakConfig(r.config);
    const next = pendingMilestone(r.streak, r.config);
    if (next !== null) setCelebratedMilestone(next);
  }, []);
  useEffect(() => {
    void refreshStreak();
  }, [refreshStreak, todayMemories.length]);
  const { status: subscriptionStatus } = useSubscription();
  const { todayTip, todayFact, favorites, toggleFavorite } = useTips();
  const haptics = useHaptics();

  const isPro = subscriptionStatus?.is_pro === true;

  // Illustration quota hint. All math + wording (including
  // pluralization and the upsell sentence) lives in
  // `getIllustrationQuotaState` so the home hint, the Archive row
  // footer, and the Capture confirmation card stay in lockstep.
  // `quota.visible` is false for Pro users (limit === null), so the
  // row is hidden entirely instead of advertising a cap they don't
  // have. At 0 left the row flips to `quota.upsellLabel` and routes
  // to /subscription so the home screen doubles as a Pro discovery
  // surface.
  const illustrationQuota = getIllustrationQuotaState(
    illustrationsUsedToday,
    illustrationsLimit,
    isPro,
  );

  const handleNavigate = (route: string) => {
    Haptics.selectionAsync();
    router.push(route as any);
  };

  const handleCapture = () => {
    // The full "capture" verb fires later when the memory actually
    // saves; here we anticipate it with the same shape so the home
    // screen feels physically connected to the capture flow.
    haptics.play("capture");
    router.push("/capture");
  };

  /**
   * Snowflake-badge tap (Task #368). Opens a calm Alert that gives
   * the user TWO concrete paths to extra freezes:
   *   - "Earn one" → wellness check-in (the documented earn loop;
   *     server grants at most one per local day, so a Pro user at
   *     the cap won't get a second from this surface)
   *   - "Upgrade to Pro" → /subscription (Pro entitlement raises the
   *     monthly allowance to PRO_MONTHLY_FREEZES)
   *
   * The third button is "Not now" — no destructive default, no
   * auto-dismiss to a paywall. Pro users still see the same alert
   * (they can still earn the bonus freeze on top of their monthly
   * allowance) but the Pro CTA copy flips to "Manage" so the
   * upsell never gets shown to a paying user.
   */
  const handleFreezePress = () => {
    haptics.play("undo");
    const isProUser = subscriptionStatus?.is_pro === true;
    const allowance = streakConfig?.monthlyFreezeAllowance ?? 1;
    const remaining = streak?.freezesAvailable ?? 0;
    const stockpile = streakConfig?.maxFreezeStockpile ?? 5;
    const title =
      remaining > 0
        ? `${remaining} freeze${remaining === 1 ? "" : "s"} ready`
        : "Need a freeze?";
    const proLine = isProUser
      ? `You're on Pro — ${allowance} freezes refill each month.`
      : `Pro tops you up to ${PRO_MONTHLY_FREEZES} freezes a month.`;
    const body = `Freezes protect your streak on a missed day. You can stockpile up to ${stockpile}.\n\n${proLine}`;
    Alert.alert(title, body, [
      {
        text: "Earn one (wellness)",
        onPress: () => {
          router.push("/wellness");
        },
      },
      {
        text: isProUser ? "Manage Pro" : "Upgrade to Pro",
        onPress: () => {
          router.push("/subscription");
        },
      },
      { text: "Not now", style: "cancel" },
    ]);
  };

  const handleLogCall = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/log-call");
  };

  const isFav = favorites.includes(todayTip.id);

  // Drives the frosted-glass intensity on the in-flow header. Updated
  // off the JS thread by `useAnimatedScrollHandler` so the BlurView
  // ramp stays smooth even while the rest of the screen is busy.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const atriumDoorways: {
    title: string;
    subtitle: string;
    route: string;
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
    badgeColor: string;
    gradient: [string, string];
    accessibilityLabel: string;
  }[] = [
    {
      title: "MeMChat",
      subtitle: "Talk with Memora",
      route: "/ai-guide",
      icon: "chatbubble-ellipses",
      iconColor: colors.accent,
      badgeColor: "rgba(0, 229, 255, 0.14)",
      gradient: ["rgba(0, 229, 255, 0.18)", "rgba(21, 16, 42, 0.88)"],
      accessibilityLabel: "MeMChat, talk with Memora",
    },
    {
      title: "Daily Chapter",
      subtitle: "Review today",
      route: "/recap",
      icon: "today",
      iconColor: "#f472b6",
      badgeColor: "rgba(244, 114, 182, 0.14)",
      gradient: ["rgba(244, 114, 182, 0.17)", "rgba(21, 16, 42, 0.88)"],
      accessibilityLabel: "Daily Chapter, review today",
    },
    {
      title: "Memory Book",
      subtitle: "Browse archive",
      route: "/archive",
      icon: "book",
      iconColor: "#ffb74d",
      badgeColor: "rgba(255, 183, 77, 0.14)",
      gradient: ["rgba(255, 183, 77, 0.16)", "rgba(21, 16, 42, 0.88)"],
      accessibilityLabel: "Memory Book, browse archive",
    },
  ];

  return (
    <SettleOnMount style={[styles.container, { backgroundColor: colors.background }]}>
      {/* V1 doorway tuning: +120 bottom for safe-area + tab-bar breathing room */}
      <Animated.ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        <View style={styles.header}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <GradientBackground style={StyleSheet.absoluteFill} />
            <AmbientBlobs />
            <FrostBackground scrollY={scrollY} />
          </View>
          <View style={styles.greetingRow}>
            {/*
              Memora + Sagous photo greeting. The 72px Memora portrait
              anchors the warmth (sage-green calm wife) with Sagous
              peeking behind her right shoulder (sunshine-gold spark
              husband). Replaces the tiny 56px vector MemCharacter so
              the home tab opens with the actual brand characters
              instead of a flat avatar. Decorative — wrapped in a
              non-interactive view so it never blocks the greeting
              text or the capture button below. The home-state pick
              still drives MEM_STATES (kept around for future use in
              other surfaces) but the photo is static here on purpose:
              a stable greeting feels less twitchy than a vector that
              re-poses every render.
            */}
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.greetingCharStack}
            >
              <View style={styles.greetingAuraOuter} />
              <View style={styles.greetingAuraInner} />
              <BrandHero variant="sagous-head" size={48} style={styles.greetingSagous} decorative />
              <BrandHero variant="memora-head" size={72} style={styles.greetingMemora} decorative />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
                {todayMemories.length > 0 ? "Glad you’re back," : "Hey there,"}
              </Text>
              <Text style={[styles.name, { color: colors.foreground }]}>
                {user?.email?.split("@")[0] || "Explorer"}
              </Text>
            </View>
          </View>
        </View>

        <AliveButton
          onPress={handleCapture}
          style={[
            styles.captureContainer,
            { shadowColor: colors.primaryAction },
          ]}
          glowColor={colors.primaryAction}
          glowIntensity={1}
          rippleColor="rgba(255, 255, 255, 0.42)"
          fillColor={colors.primaryAction}
          pressedFillColor={colors.primaryActionPressed}
          colorDurationMs={200}
          glowInDurationMs={300}
          glowOutDurationMs={300}
          // Tiny squish on press, then a Reanimated 4 spring bounces
          // back through SPRINGS.lift inside AliveButton. Pairs with
          // the "capture" AHAP so the button feels physical, not flat.
          pressScale={0.97}
          screenKey="home"
          accessibilityLabel="Quick Capture"
        >
          <View style={styles.captureGradient}>
            <View style={styles.captureIconBgActive}>
              <Ionicons name="add" size={32} color="#ffffff" />
            </View>
            <Text style={[styles.captureTitle, { color: "#ffffff" }]}>
              Quick Capture
            </Text>
            <Text
              style={[
                styles.captureSubtitle,
                { color: "rgba(255, 255, 255, 0.78)" },
              ]}
            >
              Capture a fleeting memory
            </Text>
          </View>
        </AliveButton>

        {illustrationQuota.visible && (
          <ScalePress
            onPress={
              illustrationQuota.atLimit
                ? () => handleNavigate("/subscription")
                : undefined
            }
            disabled={!illustrationQuota.atLimit}
            style={[
              styles.illustrationQuotaRow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
            accessibilityLabel={
              illustrationQuota.atLimit
                ? illustrationQuota.upsellLabel
                : illustrationQuota.label
            }
          >
            <Ionicons
              name={illustrationQuota.atLimit ? "lock-closed" : "sparkles"}
              size={16}
              color={
                illustrationQuota.atLimit ? colors.mutedForeground : colors.primary
              }
            />
            <Text
              style={[
                styles.illustrationQuotaText,
                {
                  color: illustrationQuota.atLimit
                    ? colors.mutedForeground
                    : colors.foreground,
                },
              ]}
            >
              {illustrationQuota.atLimit
                ? illustrationQuota.upsellLabel
                : illustrationQuota.label}
            </Text>
            {illustrationQuota.atLimit && (
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.mutedForeground}
              />
            )}
          </ScalePress>
        )}

        <BreatheCard index={0} style={styles.atriumSection}>
          <LinearGradient
            colors={["rgba(155, 122, 232, 0.18)", "rgba(0, 229, 255, 0.10)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.atriumShell, { borderColor: colors.border }]}
          >
            <HomeAtriumVisualLayer />
            <View style={styles.atriumHeader}>
              <View style={styles.atriumHeaderCopy}>
                <Text style={[styles.atriumEyebrow, { color: colors.mutedForeground }]}>
                  Memory Atrium
                </Text>
                <Text style={[styles.atriumTitle, { color: colors.foreground }]}>
                  Choose a doorway
                </Text>
              </View>
              <View style={[styles.atriumCompanionOrb, { borderColor: colors.border }]}>
                <Ionicons name="sparkles" size={20} color={colors.primary} />
              </View>
            </View>
            <Text style={[styles.atriumSubtitle, { color: colors.mutedForeground }]}>
              Memora and Sagous are making room for your living memory world.
            </Text>

            <View style={styles.atriumGrid}>
              {atriumDoorways.map((doorway) => (
                <ScalePress
                  key={doorway.route}
                  onPress={() => handleNavigate(doorway.route)}
                  style={styles.atriumDoor}
                  accessibilityLabel={doorway.accessibilityLabel}
                >
                  <LinearGradient
                    colors={doorway.gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.atriumDoorSurface, { borderColor: colors.border }]}
                  >
                    <View style={[styles.atriumIconBadge, { backgroundColor: doorway.badgeColor }]}>
                      <Ionicons name={doorway.icon} size={20} color={doorway.iconColor} />
                    </View>
                    <View style={styles.atriumDoorCopy}>
                      <Text numberOfLines={1} style={[styles.atriumDoorTitle, { color: colors.foreground }]}>
                        {doorway.title}
                      </Text>
                      <Text numberOfLines={1} style={[styles.atriumDoorSubtitle, { color: colors.mutedForeground }]}>
                        {doorway.subtitle}
                      </Text>
                    </View>
                  </LinearGradient>
                </ScalePress>
              ))}

              <View style={[styles.gameRoomDoor, { borderColor: colors.border }]}>
                <View style={styles.gameRoomHeader}>
                  <View style={[styles.atriumIconBadge, { backgroundColor: "rgba(155, 122, 232, 0.16)" }]}>
                    <Ionicons name="game-controller" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.atriumDoorCopy}>
                    <Text numberOfLines={1} style={[styles.atriumDoorTitle, { color: colors.foreground }]}>
                      Game Room
                    </Text>
                    <Text numberOfLines={1} style={[styles.atriumDoorSubtitle, { color: colors.mutedForeground }]}>
                      Train your mind
                    </Text>
                  </View>
                </View>
                <View style={styles.gameRoomActions}>
                  <ScalePress
                    onPress={() => handleNavigate("/memory-match")}
                    style={[styles.gameRoomAction, { backgroundColor: colors.card, borderColor: colors.border }]}
                    accessibilityLabel="Memory Match"
                  >
                    <Ionicons name="apps" size={16} color={colors.primary} />
                    <Text numberOfLines={1} style={[styles.gameRoomActionText, { color: colors.foreground }]}>
                      Memory Match
                    </Text>
                  </ScalePress>
                  <ScalePress
                    onPress={() => handleNavigate("/game-24")}
                    style={[styles.gameRoomAction, { backgroundColor: colors.card, borderColor: colors.border }]}
                    accessibilityLabel="24 Game"
                  >
                    <Ionicons name="calculator" size={16} color={colors.accent} />
                    <Text numberOfLines={1} style={[styles.gameRoomActionText, { color: colors.foreground }]}>
                      24 Game
                    </Text>
                  </ScalePress>
                </View>
              </View>
            </View>
          </LinearGradient>
        </BreatheCard>

        <View style={styles.quickActions}>
          <ScalePress
            onPress={handleLogCall}
            style={[
              styles.quickAction,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            accessibilityLabel="Log a Call"
          >
            <Ionicons name="call" size={20} color={colors.accent} />
            <Text style={[styles.quickActionText, { color: colors.foreground }]}>Log a Call</Text>
          </ScalePress>
          <ScalePress
            onPress={() => handleNavigate("/wellness")}
            style={[
              styles.quickAction,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            accessibilityLabel="Wellness"
          >
            <Ionicons name="pulse" size={20} color="#f472b6" />
            <Text style={[styles.quickActionText, { color: colors.foreground }]}>Wellness</Text>
          </ScalePress>
        </View>

        {streak !== null && streak.pendingRecoveryFor !== null && (
          <View style={styles.streakRecoverySlot}>
            <StreakRecoveryCard
              streak={streak}
              onRecovered={(next) => {
                setStreak(next);
                const m = pendingMilestone(next, streakConfig ?? undefined);
                if (m !== null) setCelebratedMilestone(m);
              }}
              onDismissed={() =>
                setStreak((cur) =>
                  cur ? { ...cur, pendingRecoveryFor: null } : cur,
                )
              }
            />
          </View>
        )}

        <View style={styles.statsRow}>
          <View
            style={[
              styles.statCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.statHeader}>
              <Ionicons name="flame" size={20} color={colors.primaryAction} />
              <Text style={[styles.statTitle, { color: colors.mutedForeground }]}>
                Capture streak
              </Text>
            </View>
            {streak !== null ? (
              <View style={styles.streakChipRow}>
                <StreakIndicator
                  streak={streak}
                  onPress={() => {
                    void refreshStreak();
                  }}
                  onFreezePress={() => handleFreezePress()}
                />
                {streak.longest > streak.current && streak.longest > 0 && (
                  <Text
                    style={[
                      styles.streakBest,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    best {streak.longest}
                  </Text>
                )}
              </View>
            ) : (
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                —
              </Text>
            )}
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.statHeader}>
              <Ionicons name="today" size={20} color={colors.accent} />
              <Text style={[styles.statTitle, { color: colors.mutedForeground }]}>Today</Text>
            </View>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{todayMemories.length}</Text>
          </View>
        </View>

        <StreakMilestoneOverlay
          milestone={celebratedMilestone}
          onDismiss={() => setCelebratedMilestone(null)}
        />

        <BreatheCard index={0} style={styles.boostCard}>
        <ScalePress
          onPress={() => handleNavigate("/tip-archive")}
          style={styles.boostCardInner}
          accessibilityLabel={`Daily Boost: ${todayTip.text}`}
        >
          <LinearGradient
            colors={["rgba(155, 122, 232, 0.20)", "rgba(0, 229, 255, 0.14)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.boostGradient, { borderColor: colors.border }]}
          >
            <View style={styles.boostHeader}>
              <View style={styles.boostHeaderLeft}>
                <Ionicons
                  name={CATEGORY_ICON[todayTip.category] || "bulb"}
                  size={18}
                  color={colors.primary}
                />
                <Text style={[styles.boostLabel, { color: colors.mutedForeground }]}>
                  Daily Boost · {todayTip.category}
                </Text>
              </View>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  Haptics.selectionAsync();
                  toggleFavorite(todayTip.id);
                }}
                hitSlop={10}
              >
                <Ionicons
                  name={isFav ? "heart" : "heart-outline"}
                  size={20}
                  color={isFav ? "#f472b6" : colors.mutedForeground}
                />
              </Pressable>
            </View>
            <Text style={[styles.boostText, { color: colors.foreground }]}>{todayTip.text}</Text>
          </LinearGradient>
        </ScalePress>
        </BreatheCard>

        <BreatheCard index={1}>
          <View style={[styles.factCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.boostHeaderLeft}>
              <Ionicons name="school" size={16} color={colors.accent} />
              <Text style={[styles.boostLabel, { color: colors.mutedForeground }]}>Did You Know?</Text>
            </View>
            <Text style={[styles.factText, { color: colors.foreground }]}>{todayFact.text}</Text>
          </View>
        </BreatheCard>

        <MemNoticedCard />

        {recentCaptures.length > 0 && (
          <View style={styles.recentSection}>
            <View style={styles.recentHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Recent memories
              </Text>
              <Pressable
                onPress={() => handleNavigate("/archive")}
                hitSlop={10}
                accessibilityLabel="View all memories"
              >
                <Text style={[styles.recentLink, { color: colors.accent }]}>
                  View all
                </Text>
              </Pressable>
            </View>
            {recentCaptures.map((m) => (
              <ScalePress
                key={m.id}
                onPress={() => handleNavigate("/archive")}
                style={[
                  styles.recentRow,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
                accessibilityLabel={`Memory: ${m.content}`}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.recentText, { color: colors.foreground }]}
                >
                  {m.content}
                </Text>
                <MemorySyncStatus status={syncStatusFor(m)} />
              </ScalePress>
            ))}
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Train Your Mind</Text>

        <View style={styles.grid}>
          <ScalePress
            onPress={() => handleNavigate("/memory-match")}
            style={styles.navCard}
            accessibilityLabel="Memory Match"
          >
            <LinearGradient
              colors={["rgba(155, 122, 232, 0.18)", "rgba(21, 16, 42, 0.96)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.navCardSurface, { borderColor: colors.border }]}
            >
              <View style={styles.navCardTop}>
                <View style={[styles.navIconBadge, { backgroundColor: "rgba(155, 122, 232, 0.18)" }]}>
                  <Ionicons name="apps" size={22} color={colors.primary} />
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </View>
              <View>
                <Text numberOfLines={1} style={[styles.navCardTitle, { color: colors.foreground }]}>Memory Match</Text>
                <Text numberOfLines={1} style={[styles.navCardSubtitle, { color: colors.mutedForeground }]}>Train recall</Text>
              </View>
            </LinearGradient>
          </ScalePress>

          <ScalePress
            onPress={() => handleNavigate("/game-24")}
            style={styles.navCard}
            accessibilityLabel="24 Game"
          >
            <LinearGradient
              colors={["rgba(0, 229, 255, 0.16)", "rgba(21, 16, 42, 0.96)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.navCardSurface, { borderColor: colors.border }]}
            >
              <View style={styles.navCardTop}>
                <View style={[styles.navIconBadge, { backgroundColor: "rgba(0, 229, 255, 0.14)" }]}>
                  <Ionicons name="calculator" size={22} color={colors.accent} />
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </View>
              <View>
                <Text numberOfLines={1} style={[styles.navCardTitle, { color: colors.foreground }]}>24 Game</Text>
                <Text numberOfLines={1} style={[styles.navCardSubtitle, { color: colors.mutedForeground }]}>Mental math</Text>
              </View>
            </LinearGradient>
          </ScalePress>

          <ScalePress
            onPress={() => handleNavigate("/recap")}
            style={styles.navCard}
            accessibilityLabel="Daily Recap"
          >
            <LinearGradient
              colors={["rgba(244, 114, 182, 0.16)", "rgba(21, 16, 42, 0.96)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.navCardSurface, { borderColor: colors.border }]}
            >
              <View style={styles.navCardTop}>
                <View style={[styles.navIconBadge, { backgroundColor: "rgba(244, 114, 182, 0.14)" }]}>
                  <Ionicons name="sparkles" size={22} color="#f472b6" />
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </View>
              <View>
                <Text numberOfLines={1} style={[styles.navCardTitle, { color: colors.foreground }]}>Daily Recap</Text>
                <Text numberOfLines={1} style={[styles.navCardSubtitle, { color: colors.mutedForeground }]}>Daily summary</Text>
              </View>
            </LinearGradient>
          </ScalePress>

          <ScalePress
            onPress={() => handleNavigate("/tip-archive")}
            style={styles.navCard}
            accessibilityLabel="Boost Archive"
          >
            <LinearGradient
              colors={["rgba(255, 183, 77, 0.15)", "rgba(21, 16, 42, 0.96)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.navCardSurface, { borderColor: colors.border }]}
            >
              <View style={styles.navCardTop}>
                <View style={[styles.navIconBadge, { backgroundColor: "rgba(255, 183, 77, 0.14)" }]}>
                  <Ionicons name="library" size={22} color={colors.primary} />
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </View>
              <View>
                <Text numberOfLines={1} style={[styles.navCardTitle, { color: colors.foreground }]}>Boost Archive</Text>
                <Text numberOfLines={1} style={[styles.navCardSubtitle, { color: colors.mutedForeground }]}>Saved boosts</Text>
              </View>
            </LinearGradient>
          </ScalePress>
        </View>
      </Animated.ScrollView>
    </SettleOnMount>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg },
  header: {
    marginBottom: spacing.xlTight,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  greeting: { ...text.bodyMedium },
  name: { ...text.screenTitle, fontSize: 32 },
  greetingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  // Memora-front, Sagous-peeking layered stack. Total width is just
  // the Memora avatar (72) — Sagous overlaps from the bottom-right so
  // the duo reads as one unit and doesn't push the greeting text off
  // the row on narrow phones.
  greetingCharStack: {
    width: 78,
    height: 76,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  greetingAuraOuter: {
    position: "absolute",
    width: 78,
    height: 76,
    borderRadius: 39,
    backgroundColor: "rgba(0, 229, 255, 0.12)",
  },
  greetingAuraInner: {
    position: "absolute",
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "rgba(255, 183, 77, 0.12)",
  },
  greetingMemora: {
    width: 72,
    height: 72,
    borderRadius: 36,
    zIndex: 2,
  },
  greetingSagous: {
    position: "absolute",
    right: -8,
    bottom: -4,
    width: 48,
    height: 48,
    borderRadius: 24,
    zIndex: 1,
  },
  captureContainer: {
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: spacing.base,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  captureGradient: { padding: spacing.lg },
  captureIconBg: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: "rgba(10, 6, 18, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.base,
  },
  captureIconBgActive: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.base,
  },
  captureTitle: {
    ...text.cardTitle,
    marginBottom: spacing.xs,
  },
  captureSubtitle: {
    ...text.helper,
    color: "rgba(10, 6, 18, 0.7)",
  },
  captureHint: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    marginTop: -spacing.xs,
    marginBottom: spacing.base,
    textAlign: "center",
  },
  illustrationQuotaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  illustrationQuotaText: {
    flex: 1,
    ...text.helper,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  atriumSection: { marginBottom: spacing.lg },
  atriumShell: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    overflow: "hidden",
  },
  atriumHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  atriumHeaderCopy: { flex: 1 },
  atriumEyebrow: {
    ...text.caption,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  atriumTitle: {
    ...text.cardTitle,
  },
  atriumCompanionOrb: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  atriumSubtitle: {
    ...text.helperRegular,
    lineHeight: 20,
    marginTop: spacing.xs,
    marginBottom: spacing.base,
  },
  atriumGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing.sm,
  },
  atriumDoor: {
    width: "48.5%",
    borderRadius: radius.md,
  },
  atriumDoorSurface: {
    minHeight: 118,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    justifyContent: "space-between",
  },
  atriumIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  atriumDoorCopy: { flex: 1, justifyContent: "flex-end" },
  atriumDoorTitle: {
    ...text.bodyMedium,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    marginTop: spacing.sm,
  },
  atriumDoorSubtitle: {
    ...text.caption,
    lineHeight: 16,
    marginTop: 2,
  },
  gameRoomDoor: {
    width: "100%",
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    backgroundColor: "rgba(21, 16, 42, 0.82)",
  },
  gameRoomHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  gameRoomActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  gameRoomAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  gameRoomActionText: {
    ...text.caption,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  quickActions: { flexDirection: "row", gap: spacing.md, marginBottom: 20 },
  quickAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  quickActionText: {
    ...text.helper,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  streakRecoverySlot: { marginBottom: spacing.base },
  streakChipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  streakBest: { fontSize: 12, fontWeight: "500" },
  statsRow: { flexDirection: "row", gap: spacing.base, marginBottom: 20 },
  statCard: {
    flex: 1,
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  statHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  statTitle: { ...text.helper },
  statValue: { ...text.screenTitle },
  boostCard: { marginBottom: spacing.md },
  boostCardInner: { borderRadius: radius.md, overflow: "hidden" },
  boostGradient: {
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  boostHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  boostHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  boostLabel: {
    ...text.caption,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  boostText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    lineHeight: 22,
  },
  factCard: {
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  factText: { ...text.helperRegular, lineHeight: 20 },
  sectionTitle: {
    ...text.sectionTitle,
    marginBottom: spacing.base,
  },
  recentSection: { marginBottom: spacing.sm },
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recentLink: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    marginBottom: spacing.base,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  recentText: {
    flex: 1,
    ...text.helper,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing.base,
  },
  navCard: {
    width: "48.25%",
    borderRadius: radius.md,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 4,
  },
  navCardSurface: {
    minHeight: 116,
    paddingHorizontal: spacing.base,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "space-between",
  },
  navCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  navIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  navCardTitle: {
    ...text.bodyMedium,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  navCardSubtitle: {
    ...text.caption,
    lineHeight: 16,
  },
});
