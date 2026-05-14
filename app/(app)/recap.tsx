import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Linking,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
} from "react-native-reanimated";
import * as Calendar from "expo-calendar";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useMood } from "@/context/MoodContext";
import { useProfile } from "@/context/ProfileContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { useMemories } from "@/context/MemoriesContext";
import { Image as ExpoImage } from "expo-image";
import {
  computeSelfieStreak,
  findSelfieForDay,
  selfieLateDayNudge,
  selfieStreakMilestone,
  selfieStreakMilestoneCopy,
} from "@/lib/dailySelfie";
import { getLocalDayKey } from "@/lib/captureLimits";
import { MemMomentCard } from "@/components/MemMomentCard";
import { BreatheModal } from "@/components/BreatheModal";
import {
  RecallMemorySheet,
  type RecallMemorySheetProps,
} from "@/components/RecallMemorySheet";
import {
  LOW_MOOD_THRESHOLD,
  hasShownMemMomentToday,
  markMemMomentShownToday,
  useMemMomentEnabled,
} from "@/lib/moodMoment";
import { fetchPositiveMemory } from "@/lib/recallMemory";
import { trackEvent } from "@/lib/analytics";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { apiGetRecap, type Recap } from "@/lib/recap";
import {
  fetchStreak,
  recapStreakLine,
  type StreakSnapshot,
} from "@/lib/streak";
import { maybeRequestReview } from "@/lib/reviewPrompt";
import { ProUpsellCard } from "@/components/ProUpsellCard";
import { MemCharacter } from "@/components/MemCharacter";
import { pickRecapState, MEM_STATES } from "@/lib/memStates";
import { MonthRecapView } from "@/components/MonthRecapView";
import {
  DateRangePickerModal,
  MAX_RANGE_DAYS,
} from "@/components/DateRangePickerModal";
import { GradientBackground } from "@/components/alive/GradientBackground";
import { SettleOnMount } from "@/components/alive/SettleOnMount";
import { useBreathingEnabled } from "@/lib/aliveUI";
import { cardEntering } from "@/lib/animationTokens";
import { formatDate } from "@/lib/dates";
import { useHaptics } from "@/lib/haptics";
import { useCognitiveAudio } from "@/lib/cognitiveAudio";

type RecapTab = "today" | "week" | "month" | "quarter" | "year" | "custom";
const RECAP_TAB_STORAGE_KEY = "recap_active_tab_v1";
// Persisted custom date range, sibling to RECAP_TAB_STORAGE_KEY. Stored
// as a JSON-encoded `{ startDate, endDate }` pair (both `YYYY-MM-DD`
// local). Kept under its own key so a future schema change to the
// custom range can ship without disturbing the active-tab key, and so
// users who only ever use the preset tabs never write to it.
const RECAP_CUSTOM_RANGE_STORAGE_KEY = "recap_custom_range_v1";
// Older builds persisted only "today" | "month"; later "week" was added,
// then "quarter" / "year" joined, and now "custom" too. Anything outside
// this set (corrupted value, future tab name we don't yet understand)
// falls back to the default. Forward-incompatible values from a
// downgrade are treated the same way — safer to land on Today than to
// crash on an unknown tab key.
const VALID_RECAP_TABS: ReadonlySet<RecapTab> = new Set([
  "today",
  "week",
  "month",
  "quarter",
  "year",
  "custom",
]);

interface CustomRange {
  startDate: string;
  endDate: string;
}

/** Round-trip check that a `YYYY-MM-DD` string is a real calendar
 *  date. The format regex alone happily accepts impossible values
 *  like `2026-13-40`; constructing a Date and re-stringifying it
 *  catches month / day overflow because JS silently rolls them into
 *  the next month. We ONLY accept strings that survive the round-
 *  trip unchanged. */
function isRealCalendarDate(s: string): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const built = new Date(y, mo - 1, d);
  return (
    built.getFullYear() === y &&
    built.getMonth() === mo - 1 &&
    built.getDate() === d
  );
}

/** Strict validator for the persisted custom-range payload. Rejects
 *  anything that isn't a real `YYYY-MM-DD` pair with start ≤ end so
 *  a corrupted or downgrade-poisoned value falls back cleanly to
 *  "no custom range" rather than crashing the date-range math. */
function parsePersistedRange(raw: string | null): CustomRange | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.startDate === "string" &&
      typeof parsed.endDate === "string" &&
      isRealCalendarDate(parsed.startDate) &&
      isRealCalendarDate(parsed.endDate) &&
      parsed.startDate <= parsed.endDate
    ) {
      return { startDate: parsed.startDate, endDate: parsed.endDate };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Inclusive day count between two YYYY-MM-DD local dates. */
function rangeWindowDays(range: CustomRange): number {
  const [ay, am, ad] = range.startDate.split("-").map(Number);
  const [by, bm, bd] = range.endDate.split("-").map(Number);
  const start = new Date(ay, am - 1, ad).getTime();
  const end = new Date(by, bm - 1, bd).getTime();
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}

/** Produce the Date that `aggregateRangeRecap` should treat as "now"
 *  for a given custom range — the END of the range at local midnight,
 *  so the rolling-window math anchors on the user's chosen end. */
function rangeNowAnchor(range: CustomRange): Date {
  const [y, m, d] = range.endDate.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Short, user-facing label for a custom range — e.g.
 *  "Apr 1 → Apr 15, 2026". Used for the headline counter on the
 *  Custom view and the picker re-edit button. */
function formatRangeLabel(range: CustomRange): string {
  return `${formatDate(range.startDate)} → ${formatDate(range.endDate)}`;
}

function Shimmer() {
  const colors = useColors();
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 1000 }),
        withTiming(0.3, { duration: 1000 }),
      ),
      -1,
      true,
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[styles.shimmerLine, style, { backgroundColor: colors.muted }]}
    />
  );
}

interface TomorrowEvent {
  title: string;
  isoDate: string;
}

export default function RecapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { history, todayLog, setRating } = useMood();
  const { profile } = useProfile();
  const { status: subscriptionStatus } = useSubscription();
  const { memories } = useMemories();
  // Today's daily selfie (Task #375) — surfaced prominently at the
  // top of the populated Today recap so the ritual reads as the
  // headline of the day, not buried in the Archive. Picks the
  // most-recent selfie tagged for the local day; absent when the
  // user hasn't taken one yet.
  const todayKey = getLocalDayKey();
  const todaysSelfie = findSelfieForDay(memories, todayKey);
  // Selfie streak (Task #392) — separate from the server-side caring
  // streak; specifically reinforces the daily-selfie ritual. Computed
  // client-side from the memories list so it stays consistent with
  // the recap strip and the capture entry button.
  const selfieStreak = computeSelfieStreak(memories, todayKey);
  const selfieMilestone = selfieStreakMilestone(selfieStreak);
  const selfieNudge = selfieLateDayNudge(selfieStreak, new Date().getHours());
  const motionEnabled = useBreathingEnabled();
  const haptics = useHaptics();
  useCognitiveAudio("recap");
  // "Smarter AI summaries" lives here — Pro users get the full
  // themes / mood_trend / suggestion block, free users get the basic
  // summary with a single upsell card in place of the extras. Pro
  // status is read from useSubscription (Task #22's source of truth).
  const isPro = subscriptionStatus?.is_pro === true;

  const [recap, setRecap] = useState<Recap | null>(null);
  // Caring streak surface (Task #369). Fetched alongside the recap so
  // the streak section can render in the same arrival as the daily
  // summary, instead of popping in late and shifting the layout. The
  // fetch is cold-start safe — a fallback (no token / network blip)
  // returns a zeroed snapshot for which `recapStreakLine` returns
  // null, so the section just doesn't render rather than blocking.
  const [streak, setStreak] = useState<StreakSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tomorrowEvents, setTomorrowEvents] = useState<TomorrowEvent[]>([]);
  // Track calendar permission so we can offer a "Connect calendar"
  // inline action when the user has denied access — without it the
  // tomorrow's-events strip is silently empty and the user has no
  // hint that calendar integration even exists. "unknown" is the
  // initial state before we've attempted a permission read; we don't
  // render the connect button in that state to avoid flashing it on
  // every cold load.
  const [calendarPermission, setCalendarPermission] = useState<
    "unknown" | "granted" | "denied"
  >("unknown");
  // Persisted active tab (Today vs Past 30 days). Default to "today" so
  // the very first paint matches the historical UX; once we've read the
  // stored value (if any) we swap. We don't gate the initial render on
  // the AsyncStorage read because the today fetch should kick off
  // immediately either way.
  const [activeTab, setActiveTab] = useState<RecapTab>("today");
  // Persisted custom range. Lives alongside `activeTab` so reopening
  // Recap on the Custom tab paints the previously-chosen range
  // immediately (no flash through the cold-start-style empty picker).
  // Null until the user has confirmed their first range — when null
  // and the active tab is "custom", we render a centered "Choose
  // dates" prompt instead of guessing.
  const [customRange, setCustomRange] = useState<CustomRange | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      AsyncStorage.getItem(RECAP_TAB_STORAGE_KEY),
      AsyncStorage.getItem(RECAP_CUSTOM_RANGE_STORAGE_KEY),
    ])
      .then(([rawTab, rawRange]) => {
        if (cancelled) return;
        if (rawTab !== null && VALID_RECAP_TABS.has(rawTab as RecapTab)) {
          setActiveTab(rawTab as RecapTab);
        }
        const parsed = parsePersistedRange(rawRange);
        if (parsed !== null) setCustomRange(parsed);
      })
      .catch(() => {
        /* AsyncStorage failure just keeps the defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const handleSelectTab = useCallback(
    (tab: RecapTab) => {
      setActiveTab(tab);
      // Switching window/tab is a soft "pull back to a different
      // view" — closer to undo than to capture, so we use the undo
      // signature for that calmer texture.
      haptics.play("undo");
      AsyncStorage.setItem(RECAP_TAB_STORAGE_KEY, tab).catch((err) => {
        if (__DEV__) console.warn("[recap] persist tab failed", err);
      });
      // When the user lands on the Custom tab without an existing
      // range, open the picker right away so they aren't staring at
      // an empty surface wondering what to do next. If a range
      // already exists we just switch to it — the inline "Edit
      // range" button under the tab bar handles re-edits.
      if (tab === "custom" && customRange === null) {
        setPickerVisible(true);
      }
    },
    [customRange, haptics],
  );

  const handleConfirmRange = useCallback((range: CustomRange) => {
    setCustomRange(range);
    setPickerVisible(false);
    AsyncStorage.setItem(
      RECAP_CUSTOM_RANGE_STORAGE_KEY,
      JSON.stringify(range),
    ).catch((err) => {
      if (__DEV__) console.warn("[recap] persist custom range failed", err);
    });
  }, []);

  // Auto-scroll the horizontal tab bar so the active tab is fully
  // visible. With five windows the active tab can sit off-screen on
  // narrow phones (especially when restoring "year" or "quarter" from
  // AsyncStorage), which left users unsure which window they were
  // viewing. We track each tab's measured x/width plus the scroller's
  // viewport and content widths in refs so that a single attempt
  // function can run from three call sites: the activeTab effect, a
  // tab segment's onLayout (which is when we first learn its position),
  // and the scroller's onLayout/onContentSizeChange (which is when we
  // learn the viewport/content size). The first successful scroll is
  // non-animated so the screen lands on the right offset; subsequent
  // tab changes animate.
  const tabScrollRef = useRef<ScrollView>(null);
  const tabLayoutsRef = useRef<
    Partial<Record<RecapTab, { x: number; width: number }>>
  >({});
  const tabScrollViewWidthRef = useRef<number>(0);
  const tabScrollContentWidthRef = useRef<number>(0);
  const initialTabScrollDoneRef = useRef<boolean>(false);

  const attemptScrollActiveTabIntoView = useCallback(() => {
    const layout = tabLayoutsRef.current[activeTab];
    const viewportWidth = tabScrollViewWidthRef.current;
    const contentWidth = tabScrollContentWidthRef.current;
    const node = tabScrollRef.current;
    if (!layout || !node || viewportWidth <= 0 || contentWidth <= 0) return;
    // Wide layout: every tab already fits. Don't touch the scroller so
    // the behaviour is unchanged on devices where all tabs are visible.
    if (contentWidth <= viewportWidth) return;
    const maxScroll = contentWidth - viewportWidth;
    // Center the active tab in the viewport when there's room on both
    // sides, otherwise clamp to the scrollable bounds.
    const ideal = layout.x + layout.width / 2 - viewportWidth / 2;
    const targetX = Math.max(0, Math.min(maxScroll, ideal));
    const animated = initialTabScrollDoneRef.current;
    node.scrollTo({ x: targetX, animated });
    initialTabScrollDoneRef.current = true;
  }, [activeTab]);

  useEffect(() => {
    attemptScrollActiveTabIntoView();
  }, [attemptScrollActiveTabIntoView]);

  const handleTabSegmentLayout = useCallback(
    (key: RecapTab, e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      tabLayoutsRef.current[key] = { x, width };
      if (key === activeTab) attemptScrollActiveTabIntoView();
    },
    [activeTab, attemptScrollActiveTabIntoView],
  );

  const handleTabScrollViewLayout = useCallback(
    (e: LayoutChangeEvent) => {
      tabScrollViewWidthRef.current = e.nativeEvent.layout.width;
      attemptScrollActiveTabIntoView();
    },
    [attemptScrollActiveTabIntoView],
  );

  const handleTabScrollContentSizeChange = useCallback(
    (w: number) => {
      tabScrollContentWidthRef.current = w;
      attemptScrollActiveTabIntoView();
    },
    [attemptScrollActiveTabIntoView],
  );

  const fetchTomorrowEvents = useCallback(async () => {
    try {
      // Read the current permission first so we can distinguish a
      // first-run "undetermined" (where prompting the user is fine)
      // from a previously-denied state (where we should show the
      // inline reconnect button instead of silently leaving the strip
      // empty).
      const initial = await Calendar.getCalendarPermissionsAsync();
      let status = initial.status;
      if (status === "undetermined" && initial.canAskAgain) {
        const req = await Calendar.requestCalendarPermissionsAsync();
        status = req.status;
      }
      if (status !== "granted") {
        setCalendarPermission("denied");
        setTomorrowEvents([]);
        return;
      }
      setCalendarPermission("granted");
      const start = new Date();
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);

      const calendars = await Calendar.getCalendarsAsync(
        Calendar.EntityTypes.EVENT,
      );
      const calendarIds = calendars
        .filter((c) => c.allowsModifications)
        .map((c) => c.id);
      if (calendarIds.length === 0) {
        setTomorrowEvents([]);
        return;
      }
      const events = await Calendar.getEventsAsync(calendarIds, start, end);
      setTomorrowEvents(
        events.map((e) => ({
          title: e.title,
          isoDate:
            typeof e.startDate === "string"
              ? e.startDate
              : new Date(e.startDate).toISOString(),
        })),
      );
    } catch {
      setTomorrowEvents([]);
    }
  }, []);

  // Single fetcher used by mount-effect, header refresh button, and the
  // error-state retry button (Architecture rule #4). Preserves the last
  // successful `recap` across refetches so a transient blip on a manual
  // refresh doesn't blank the screen (rule #3).
  const loadRecap = useCallback(async () => {
    // No haptic on the request itself — only on arrival, so users
    // don't get a buzz every time they pull-to-refresh.
    setIsLoading(true);
    setError(null);
    try {
      const [data, , streakResp] = await Promise.all([
        apiGetRecap(),
        fetchTomorrowEvents(),
        fetchStreak(),
      ]);
      setRecap(data);
      // Only update on a server-confirmed snapshot. On a fallback we
      // keep whatever we had (matches the home tab's defense-in-depth
      // pattern in (tabs)/index.tsx — never overwrite a real streak
      // with the zeroed default just because the network blipped).
      if (streakResp.source === "server") {
        setStreak(streakResp.streak);
      }
      if (__DEV__) {
        console.log("[recap] loaded", {
          date: data.date,
          capture_count: data.capture_count,
          cached: data.cached,
        });
      }
      // The "your day is summarised" arrival cue: a shimmer with three
      // rising taps. See assets/haptics/day-recap-ready.ahap.
      haptics.play("day-recap-ready");
      // Engagement-gated review prompt: only after a user has loaded
      // a recap that contains actual captures (not the empty-state
      // recap). All other gates (account age ≥ 7d, asked-once,
      // SDK-availability) live inside `maybeRequestReview` so this
      // call site stays a one-liner. Apple guidelines forbid offering
      // any reward for the prompt — we're only here because the user
      // already engaged successfully.
      if (data.capture_count > 0) {
        maybeRequestReview(user?.email).catch((err) => {
          if (__DEV__) console.warn("[recap] maybeRequestReview failed", err);
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't load your recap";
      setError(message);
      // MemTool's "error" signature — two firm thumps — so the user
      // hears MemTool refusing rather than the generic iOS warning.
      haptics.play("error");
      console.warn("[recap] load failed", err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchTomorrowEvents, user?.email, haptics]);

  useEffect(() => {
    loadRecap();
  }, [loadRecap]);

  // Pull-to-refresh handler. Guards against double-fetch when a load is
  // already in flight (e.g. the header refresh button was just tapped),
  // so the gesture is a no-op until the current request settles.
  const handlePullRefresh = useCallback(() => {
    if (isLoading) return;
    loadRecap();
  }, [isLoading, loadRecap]);

  // Show the native pull-to-refresh spinner only after the first successful
  // load — during the initial fetch the in-card shimmer is the loading UI.
  const isPullRefreshing = isLoading && recap !== null;

  // MemMomentCard surfaces inline above today's recap whenever the
  // user logged a low stress (≤3) reading today and we haven't
  // already presented the card today (Task #336). Tracked per-user
  // via `memMomentDayKey` AsyncStorage so the dedup survives screen
  // dismissal but resets at midnight.
  const [memMomentVisible, setMemMomentVisible] = useState(false);
  // Task #346 opt-out: when off, the recap surface skips the
  // MemMomentCard entirely (no day-key consumed, no card rendered).
  const memMomentEnabled = useMemMomentEnabled();
  const [breatheOpen, setBreatheOpen] = useState(false);
  const [recallOpen, setRecallOpen] = useState(false);
  const [recallContent, setRecallContent] =
    useState<RecallMemorySheetProps["memoryContent"]>(null);
  const [recallTimestamp, setRecallTimestamp] =
    useState<RecallMemorySheetProps["memoryTimestamp"]>(null);
  useEffect(() => {
    let cancelled = false;
    const email = user?.email;
    const stress = todayLog?.stress;
    // Only consume the per-day suppression key once the user is
    // actually on the Today tab where the card can render. Marking
    // earlier (e.g. when they opened recap on Past 7 days) would
    // burn the day's chance to ever surface the card. Gating on
    // `activeTab === "today"` keeps the card reachable when the
    // user later switches back to Today.
    if (
      !email ||
      stress === undefined ||
      stress > LOW_MOOD_THRESHOLD ||
      activeTab !== "today" ||
      !memMomentEnabled
    ) {
      return () => {
        cancelled = true;
      };
    }
    hasShownMemMomentToday(email)
      .then((shown) => {
        if (cancelled || shown) return;
        markMemMomentShownToday(email).catch(() => {});
        trackEvent("mood_low_logged", { source: "recap", stress });
        setMemMomentVisible(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.email, todayLog?.stress, activeTab, memMomentEnabled]);

  const handleMemBreathe = () => {
    trackEvent("mood_action_breathe", { source: "recap" });
    setBreatheOpen(true);
  };
  const handleMemRecall = async () => {
    trackEvent("mood_action_recall", { source: "recap" });
    setRecallContent(null);
    setRecallTimestamp(null);
    setRecallOpen(true);
    try {
      const res = await fetchPositiveMemory();
      setRecallContent(res.memory?.content ?? null);
      setRecallTimestamp(res.memory?.timestamp ?? null);
    } catch {
      setRecallContent(null);
      setRecallTimestamp(null);
    }
  };
  const handleMemSit = () => {
    trackEvent("mood_action_sit", { source: "recap" });
    // Per the spec, "just sit with me" should still return the user
    // home after the brief presence beat, matching the wellness
    // flow's behavior so the action feels like a complete intervention
    // rather than a stuck card.
    setTimeout(() => {
      setMemMomentVisible(false);
      router.replace("/");
    }, 2000);
  };
  const handleMemSkip = () => {
    trackEvent("mood_action_skip", { source: "recap" });
    setMemMomentVisible(false);
  };

  const handleRate = (rating: number) => {
    setRating(rating);
    // Rating the day is a small completion — same "capture" texture
    // so the user learns the same shape means "MemTool just recorded
    // something I said".
    haptics.play("capture");
  };

  const handleGoCapture = () => {
    // The CTA tap that takes you into the capture flow gets the soft
    // "undo"-style tap, leaving the louder "capture" haptic for the
    // actual save. Two haptics on one journey would feel busy.
    haptics.play("undo");
    router.push("/capture");
  };

  // Render precedence (rule #3): isLoading -> error&&!recap -> empty -> populated.
  // When a refresh FAILS but we have a previously-loaded recap, we keep the
  // recap visible and surface the error as an inline banner above it instead
  // of blanking the screen.
  const showInitialLoading = isLoading && !recap;
  const showError = !isLoading && error !== null && recap === null;
  const showEmpty = recap !== null && recap.capture_count === 0;
  const showPopulated = recap !== null && recap.capture_count > 0;
  const showRefreshErrorBanner =
    !isLoading && error !== null && recap !== null;

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
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Daily Recap
        </Text>
        <Pressable
          onPress={loadRecap}
          style={styles.refreshButton}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="refresh" size={24} color={colors.foreground} />
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={handlePullRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Five tabs no longer fit comfortably in a single row at
            the smaller font size — we let them wrap onto a second
            line and scroll the segmented control horizontally
            inside its own slim track so the rest of the screen
            doesn't shift around. */}
        <ScrollView
          ref={tabScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBarScrollContent}
          onLayout={handleTabScrollViewLayout}
          onContentSizeChange={handleTabScrollContentSizeChange}
        >
          <View
            style={[
              styles.tabBar,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {(
              [
                { key: "today", label: "Today" },
                { key: "week", label: "Past 7 days" },
                { key: "month", label: "Past 30 days" },
                { key: "quarter", label: "Past 90 days" },
                { key: "year", label: "Past 365 days" },
                { key: "custom", label: "Custom" },
              ] as { key: RecapTab; label: string }[]
            ).map((t) => {
              const isActive = activeTab === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => handleSelectTab(t.key)}
                  onLayout={(e) => handleTabSegmentLayout(t.key, e)}
                  style={[
                    styles.tabSegment,
                    isActive && { backgroundColor: colors.primary },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`${t.label} recap`}
                >
                  <Text
                    style={[
                      styles.tabSegmentText,
                      {
                        color: isActive
                          ? colors.primaryForeground
                          : colors.foreground,
                      },
                    ]}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {activeTab === "custom" ? (
          <CustomRangePane
            range={customRange}
            onOpenPicker={() => setPickerVisible(true)}
          />
        ) : activeTab === "year" ? (
          <MonthRecapView windowDays={365} />
        ) : activeTab === "quarter" ? (
          <MonthRecapView windowDays={90} />
        ) : activeTab === "month" ? (
          <MonthRecapView windowDays={30} />
        ) : activeTab === "week" ? (
          <MonthRecapView windowDays={7} />
        ) : (
          <>
        <Animated.View
          entering={cardEntering(0, motionEnabled)}
          style={[
            styles.todayChapterCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text
            style={[styles.todayChapterEyebrow, { color: colors.primary }]}
          >
            TODAY'S CHAPTER
          </Text>
          <Text style={[styles.todayChapterTitle, { color: colors.foreground }]}>
            A small page from right now
          </Text>
          <Text
            style={[
              styles.todayChapterBody,
              { color: colors.mutedForeground },
            ]}
          >
            Your recap gathers today's memories into the beginning of a living
            journal.
          </Text>
        </Animated.View>

        {showRefreshErrorBanner && (
          <Animated.View
            entering={cardEntering(0, motionEnabled)}
            style={[
              styles.refreshErrorBanner,
              {
                backgroundColor: colors.card,
                borderColor: colors.destructive ?? colors.primary,
              },
            ]}
          >
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={colors.destructive ?? colors.primary}
            />
            <Text
              style={[
                styles.refreshErrorText,
                { color: colors.foreground },
              ]}
              numberOfLines={2}
            >
              Couldn't refresh: {error}
            </Text>
            <TouchableOpacity
              onPress={loadRecap}
              hitSlop={8}
              style={styles.refreshErrorRetry}
            >
              <Text
                style={[
                  styles.refreshErrorRetryText,
                  { color: colors.primary },
                ]}
              >
                Try again
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {showInitialLoading && (
          <Animated.View
            entering={cardEntering(0, motionEnabled)}
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.loadingContainer}>
              <Ionicons
                name="sparkles"
                size={32}
                color={colors.primary}
                style={styles.sparkleIcon}
              />
              <Text
                style={[styles.loadingTitle, { color: colors.foreground }]}
              >
                Analyzing your day...
              </Text>
              <View style={styles.shimmerContainer}>
                <Shimmer />
                <Shimmer />
                <Shimmer />
              </View>
            </View>
          </Animated.View>
        )}

        {showError && (
          <Animated.View
            entering={cardEntering(0, motionEnabled)}
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                marginBottom: 20,
              },
            ]}
          >
            <View style={styles.resultHeader}>
              <Ionicons
                name="alert-circle"
                size={24}
                color={colors.destructive ?? colors.primary}
              />
              <Text
                style={[
                  styles.resultTitle,
                  { color: colors.destructive ?? colors.primary },
                ]}
              >
                Couldn't load your recap
              </Text>
            </View>
            <Text style={[styles.recapText, { color: colors.foreground }]}>
              {error}
            </Text>
            <TouchableOpacity
              onPress={loadRecap}
              style={[
                styles.retryButton,
                {
                  backgroundColor: colors.primary,
                },
              ]}
            >
              <Text
                style={[
                  styles.retryButtonText,
                  { color: colors.primaryForeground },
                ]}
              >
                Try again
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {activeTab === "today" && memMomentVisible && (
          <Animated.View
            entering={cardEntering(0, motionEnabled)}
            style={{ marginBottom: 12 }}
          >
            <MemMomentCard
              profile={profile}
              displayName={user?.display_name}
              onBreathe={handleMemBreathe}
              onRecall={handleMemRecall}
              onSit={handleMemSit}
              onSkip={handleMemSkip}
            />
          </Animated.View>
        )}

        {showEmpty && (
          <Animated.View
            entering={cardEntering(0, motionEnabled)}
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                marginBottom: 20,
              },
            ]}
          >
            <View style={styles.emptyContent}>
              <Ionicons
                name="journal-outline"
                size={40}
                color={colors.primary}
                style={styles.emptyIcon}
              />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No memories yet today
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                Capture a memory to start building today's recap.
              </Text>
              <TouchableOpacity
                onPress={handleGoCapture}
                style={[
                  styles.captureButton,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={18}
                  color={colors.primaryForeground}
                />
                <Text
                  style={[
                    styles.captureButtonText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  Capture a memory
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {showPopulated && recap && (
          <>
            {todaysSelfie && (todaysSelfie.photoThumbUrl || todaysSelfie.photoUrl) && (
              <Animated.View
                entering={cardEntering(0, motionEnabled)}
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.primary,
                    marginBottom: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  },
                ]}
                accessibilityLabel="Today's daily selfie"
              >
                {/* Inner SettleOnMount adds the Mercury ~3px settle
                    on top of cardEntering's slide-in so the milestone
                    moment lands with the same weighted arrival the
                    rest of the alive surfaces use. The two animations
                    compose: cardEntering runs as a one-shot layout
                    transition, SettleOnMount runs an animated
                    translateY style that takes over once the entry
                    completes. */}
                <SettleOnMount style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <ExpoImage
                    source={{ uri: todaysSelfie.photoThumbUrl ?? todaysSelfie.photoUrl }}
                    style={{ width: 72, height: 72, borderRadius: 12 }}
                    contentFit="cover"
                    transition={150}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.resultTitle, { color: colors.primary, marginBottom: 2 }]}>
                      {selfieMilestone !== null
                        ? selfieStreakMilestoneCopy(selfieMilestone).title
                        : selfieStreak.current >= 1
                        ? `Day ${selfieStreak.current} of your selfie streak.`
                        : "Today's selfie"}
                    </Text>
                    <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                      {selfieMilestone !== null
                        ? selfieStreakMilestoneCopy(selfieMilestone).body
                        : `Captured ${formatDate(todaysSelfie.timestamp)}`}
                    </Text>
                  </View>
                </SettleOnMount>
              </Animated.View>
            )}
            {!todaysSelfie && selfieNudge !== null && (
              <Animated.View
                entering={cardEntering(0, motionEnabled)}
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    marginBottom: 12,
                  },
                ]}
                accessibilityLabel="Daily selfie streak reminder"
              >
                {/* Same compose-with-cardEntering pattern as the
                    milestone card above — SettleOnMount lets the
                    nudge body land with the alive ~3px settle. */}
                <SettleOnMount>
                  <Text style={[styles.resultTitle, { color: colors.primary, marginBottom: 2 }]}>
                    {`Day ${selfieStreak.current} of your selfie streak.`}
                  </Text>
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    {selfieNudge ?? "Today's selfie is still waiting — keep the run going whenever you're ready."}
                  </Text>
                </SettleOnMount>
              </Animated.View>
            )}
            <Animated.View
              entering={cardEntering(0, motionEnabled)}
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  marginBottom: 12,
                },
              ]}
            >
              <View style={styles.resultHeader}>
                <View
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <MemCharacter
                    size={48}
                    expression={
                      MEM_STATES[
                        pickRecapState({
                          hasThemes: recap.themes.length > 0,
                          hasMoodTrend: recap.mood_trend !== null,
                        })
                      ].expression
                    }
                  />
                </View>
                <Text style={[styles.resultTitle, { color: colors.primary }]}>
                  Your Daily Insight
                </Text>
              </View>
              <Text style={[styles.recapText, { color: colors.foreground }]}>
                {recap.summary}
              </Text>
              {isPro && recap.mood_trend !== null && (
                <View style={styles.moodTrendRow}>
                  <Ionicons
                    name="trending-up-outline"
                    size={16}
                    color={colors.accent}
                  />
                  <Text
                    style={[styles.moodTrendText, { color: colors.accent }]}
                  >
                    {recap.mood_trend}
                  </Text>
                </View>
              )}
              <Text
                style={[styles.metaText, { color: colors.mutedForeground }]}
              >
                {formatDate(recap.date)} · {recap.capture_count}{" "}
                {recap.capture_count === 1 ? "memory" : "memories"}
              </Text>
            </Animated.View>

            {/* Smarter AI extras (themes / mood / suggestion) are
                Pro-only. Free users see one upsell card in place of
                all three so the screen stays calm — Pro users see
                each block conditionally as before. */}
            {isPro ? (
              <>
                {recap.themes.length > 0 && (
                  <Animated.View
                    entering={cardEntering(1, motionEnabled)}
                    style={styles.themesRow}
                  >
                    {recap.themes.map((theme, idx) => (
                      <View
                        key={`${theme}-${idx}`}
                        style={[
                          styles.themeChip,
                          {
                            backgroundColor: colors.primary + "20",
                            borderColor: colors.primary,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.themeChipText,
                            { color: colors.primary },
                          ]}
                        >
                          {theme}
                        </Text>
                      </View>
                    ))}
                  </Animated.View>
                )}

                {recap.suggestion !== null && (
                  <Animated.View
                    entering={cardEntering(2, motionEnabled)}
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
                        name="bulb-outline"
                        size={18}
                        color={colors.primary}
                      />
                      <Text
                        style={[
                          styles.suggestionTitle,
                          { color: colors.primary },
                        ]}
                      >
                        Suggestion
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.suggestionText,
                        { color: colors.foreground },
                      ]}
                    >
                      {recap.suggestion}
                    </Text>
                  </Animated.View>
                )}
              </>
            ) : (
              <Animated.View entering={cardEntering(1, motionEnabled)}>
                <ProUpsellCard
                  icon="sparkles-outline"
                  title="Smarter AI summaries"
                  body="Upgrade to MemTool Pro to unlock daily themes, mood trends, and personalized suggestions tailored to your memories."
                />
              </Animated.View>
            )}
          </>
        )}

        {/* Caring streak section (Task #369). Same gentle mechanic
            as the home flame chip — milestone-aware copy when one
            has just crossed, otherwise a warm "you showed up X of
            7 days" line. Render-gated by `recapStreakLine` so a
            zero-streak (cold start, brand-new user, fallback
            snapshot) doesn't surface an empty card. Lives between
            the daily insight and tomorrow's events so the eye
            naturally lands on it after the summary. */}
        {!showInitialLoading && streak !== null && (() => {
          const line = recapStreakLine(streak);
          if (!line) return null;
          return (
            <Animated.View
              entering={cardEntering(2, motionEnabled)}
              style={[
                styles.groupCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              accessibilityLabel={`${line.title} ${line.body}`}
            >
              <Text style={[styles.groupTitle, { color: colors.primary }]}>
                STREAK
              </Text>
              <View style={styles.groupItem}>
                <Ionicons name="flame" size={16} color={colors.primary} />
                <Text
                  style={[styles.groupItemText, { color: colors.foreground }]}
                >
                  {line.title}
                </Text>
              </View>
              <Text
                style={[
                  styles.calendarConnectBody,
                  { color: colors.mutedForeground, marginBottom: 0, marginTop: 4 },
                ]}
              >
                {line.body}
              </Text>
            </Animated.View>
          );
        })()}

        {!showInitialLoading && tomorrowEvents.length > 0 && (
          <Animated.View
            entering={cardEntering(3, motionEnabled)}
            style={[
              styles.groupCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.groupTitle, { color: colors.primary }]}>
              TOMORROW'S EVENTS
            </Text>
            {tomorrowEvents.map((event, idx) => (
              <View key={idx} style={styles.groupItem}>
                <Ionicons
                  name="calendar-outline"
                  size={16}
                  color={colors.primary}
                />
                <Text
                  style={[styles.groupItemText, { color: colors.foreground }]}
                >
                  {event.title}
                </Text>
              </View>
            ))}
          </Animated.View>
        )}

        {/* Calendar permission denied: replace the silent empty
            tomorrow-events strip with an explicit affordance so the
            user discovers the integration exists and can re-enable
            it from Settings. We only render once we've actually
            attempted a permission read (calendarPermission !==
            "unknown") and only when there are no events to show. */}
        {!showInitialLoading &&
          calendarPermission === "denied" &&
          tomorrowEvents.length === 0 && (
            <Animated.View
              entering={cardEntering(3, motionEnabled)}
              style={[
                styles.groupCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.groupTitle, { color: colors.primary }]}>
                TOMORROW'S EVENTS
              </Text>
              <Text
                style={[
                  styles.calendarConnectBody,
                  { color: colors.mutedForeground },
                ]}
              >
                Connect your calendar to see what's on tomorrow.
              </Text>
              <TouchableOpacity
                onPress={() => {
                  haptics.play("capture");
                  Linking.openSettings().catch(() => {});
                }}
                style={[
                  styles.calendarConnectButton,
                  { backgroundColor: colors.primary },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Connect calendar to see tomorrow's events"
              >
                <Ionicons
                  name="calendar-outline"
                  size={16}
                  color={colors.primaryForeground}
                />
                <Text
                  style={[
                    styles.calendarConnectButtonText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  Connect calendar
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}

        {!showInitialLoading && (
          <Animated.View
            entering={cardEntering(4, motionEnabled)}
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                marginTop: 20,
              },
            ]}
          >
            <Text
              style={[
                styles.resultTitle,
                {
                  color: colors.foreground,
                  textAlign: "center",
                  marginBottom: 16,
                },
              ]}
            >
              Rate Your Day
            </Text>
            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => handleRate(star)}>
                  <Ionicons
                    name={
                      star <= (todayLog?.rating || 0) ? "star" : "star-outline"
                    }
                    size={40}
                    color={colors.primary}
                  />
                </TouchableOpacity>
              ))}
            </View>
            {history.length > 0 && (
              <View
                style={{
                  height: 60,
                  flexDirection: "row",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  marginTop: 24,
                }}
              >
                {history
                  .slice(0, 7)
                  .reverse()
                  .map((log, i) => (
                    <View
                      key={i}
                      style={{
                        width: 20,
                        height: (log.rating / 5) * 40,
                        backgroundColor: colors.primary,
                        marginHorizontal: 4,
                        borderRadius: 2,
                      }}
                    />
                  ))}
              </View>
            )}
          </Animated.View>
        )}
          </>
        )}
      </ScrollView>
      <DateRangePickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onConfirm={handleConfirmRange}
        initialRange={customRange}
      />
      <BreatheModal
        visible={breatheOpen}
        onClose={() => {
          // Closing the breathing sheet completes the intervention,
          // so we send the user home — matching the wellness flow
          // and the spec's "return to home after action" behavior.
          setBreatheOpen(false);
          setMemMomentVisible(false);
          router.replace("/");
        }}
      />
      <RecallMemorySheet
        visible={recallOpen}
        memoryContent={recallContent}
        memoryTimestamp={recallTimestamp}
        onClose={() => {
          setRecallOpen(false);
          setMemMomentVisible(false);
          router.replace("/");
        }}
        onTalkToMem={() => {
          setRecallOpen(false);
          setMemMomentVisible(false);
          router.replace("/ai-guide");
        }}
      />
    </SettleOnMount>
  );
}

interface CustomRangePaneProps {
  range: CustomRange | null;
  onOpenPicker: () => void;
}

/**
 * Renderer for the "Custom" tab. When the user has not yet picked a
 * range we show an inline prompt that re-opens the picker — same
 * `onOpenPicker` the tab-tap handler uses, so a user can land here,
 * dismiss the picker by accident, and recover with one more tap.
 *
 * Once a range is set, we render the same `MonthRecapView` the preset
 * tabs use, but with `now` anchored to the END of the chosen range
 * and `headerLabel` overridden to "Custom range" so the headline
 * reads naturally even for arbitrary day counts (the preset wording
 * "Past 23 days" would imply a rolling window ending today, which is
 * exactly what we don't want here). The user can re-open the picker
 * via a small "Edit range" button below the heatmap so they don't
 * have to leave the tab to adjust.
 */
function CustomRangePane({ range, onOpenPicker }: CustomRangePaneProps) {
  const colors = useColors();

  if (range === null) {
    return (
      <View
        style={[
          styles.customEmptyCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Ionicons
          name="calendar-outline"
          size={32}
          color={colors.primary}
          style={styles.customEmptyIcon}
        />
        <Text
          style={[styles.customEmptyTitle, { color: colors.foreground }]}
        >
          Pick any date range
        </Text>
        <Text
          style={[
            styles.customEmptyBody,
            { color: colors.mutedForeground },
          ]}
        >
          Compare last December, the trip in March, or any other
          window — Mem will recap just those days.
        </Text>
        <TouchableOpacity
          onPress={onOpenPicker}
          style={[
            styles.customEmptyButton,
            { backgroundColor: colors.primary },
          ]}
          accessibilityLabel="Choose dates"
        >
          <Ionicons
            name="calendar"
            size={16}
            color={colors.primaryForeground}
          />
          <Text
            style={[
              styles.customEmptyButtonText,
              { color: colors.primaryForeground },
            ]}
          >
            Choose dates
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const windowDays = rangeWindowDays(range);
  const safeWindowDays = Math.min(windowDays, MAX_RANGE_DAYS);
  const now = rangeNowAnchor(range);
  return (
    <View>
      <TouchableOpacity
        onPress={onOpenPicker}
        style={[
          styles.editRangeButton,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
        accessibilityLabel="Edit selected date range"
      >
        <Ionicons
          name="calendar-outline"
          size={16}
          color={colors.primary}
        />
        <Text
          style={[styles.editRangeText, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {formatRangeLabel(range)}
        </Text>
        <Text
          style={[styles.editRangeHint, { color: colors.mutedForeground }]}
        >
          Edit
        </Text>
      </TouchableOpacity>
      <MonthRecapView
        windowDays={safeWindowDays}
        now={now}
        headerLabel="Custom range"
      />
    </View>
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
  refreshButton: { padding: spacing.sm },
  title: { ...text.sectionTitle },
  scrollContent: { padding: spacing.lg, paddingBottom: 100 },
  // The horizontal scroller around the tab bar lets all five tab
  // labels stay on a single line on small devices — content padding
  // matches the screen padding so the bar visually aligns with the
  // cards below it.
  tabBarScrollContent: {
    paddingBottom: spacing.base,
  },
  tabBar: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.xs,
  },
  tabSegment: {
    // No `flex: 1` here — the tab bar lives inside a horizontal
    // scroller now, so segments must size to their label content
    // rather than dividing the screen evenly.
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
  },
  tabSegmentText: {
    // Reduced from 14 → 13 so the labels (Today / Past 7 days /
    // Past 30 days / Past 90 days / Past 365 days) stay compact on
    // the smallest supported devices.
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  todayChapterCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  todayChapterEyebrow: {
    fontSize: 12,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    marginBottom: spacing.xs,
  },
  todayChapterTitle: {
    ...text.cardHeading,
    marginBottom: 6,
  },
  todayChapterBody: {
    ...text.helperRegular,
    lineHeight: 20,
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    paddingVertical: spacing.xl,
  },
  sparkleIcon: { marginBottom: spacing.base },
  loadingTitle: {
    ...text.cardLabel,
    marginBottom: spacing.xl,
  },
  shimmerContainer: { width: "100%", gap: spacing.base },
  shimmerLine: { height: 16, borderRadius: spacing.sm, width: "100%" },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.base,
  },
  resultTitle: { ...text.cardHeading },
  recapText: { ...text.body, lineHeight: 28 },
  moodTrendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
  },
  moodTrendText: {
    ...text.helper,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  metaText: {
    ...text.caption,
    marginTop: spacing.md,
  },
  themesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  themeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  themeChipText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  suggestionCard: {
    padding: spacing.lgCard,
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
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    fontWeight: "400",
    lineHeight: 22,
  },
  retryButton: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.base,
    paddingVertical: 10,
    borderRadius: radius.sm,
    marginTop: spacing.base,
  },
  retryButtonText: {
    ...text.helper,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  emptyContent: {
    alignItems: "center",
    paddingVertical: spacing.base,
  },
  emptyIcon: { marginBottom: spacing.md },
  emptyTitle: {
    ...text.cardHeading,
    marginBottom: 6,
    textAlign: "center",
  },
  emptySubtitle: {
    ...text.helperRegular,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 20,
  },
  captureButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lgCard,
    paddingVertical: spacing.md,
    borderRadius: 14,
  },
  captureButtonText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  groupCard: {
    padding: spacing.lgCard,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: "800",
    marginBottom: spacing.md,
    letterSpacing: 1,
  },
  groupItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  groupItemText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    fontWeight: "400",
  },
  ratingRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
  },
  refreshErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  refreshErrorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    fontWeight: "400",
  },
  refreshErrorRetry: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  refreshErrorRetryText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  customEmptyCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    alignItems: "center",
  },
  customEmptyIcon: { marginBottom: spacing.md },
  customEmptyTitle: {
    ...text.cardHeading,
    textAlign: "center",
    marginBottom: 6,
  },
  customEmptyBody: {
    ...text.helperRegular,
    textAlign: "center",
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  customEmptyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lgCard,
    paddingVertical: spacing.md,
    borderRadius: 14,
  },
  customEmptyButtonText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  editRangeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  editRangeText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  editRangeHint: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
  },
  calendarConnectBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    fontWeight: "400",
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  calendarConnectButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: 10,
    borderRadius: 12,
  },
  calendarConnectButtonText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
