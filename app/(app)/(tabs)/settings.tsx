import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Switch, Pressable, TextInput, ActivityIndicator, Linking, Modal, Platform, Alert, ScrollView, type LayoutChangeEvent } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";

import { FrostBackground } from "@/components/alive/FrostBackground";
import { fetchAllMemoriesForExport } from "@/lib/memories";
import { handleExportError } from "@/lib/exportErrorHandler";
import {
  CACHED_COPY_SHARE_TITLE,
  DEFAULT_EXPORT_SHARE_TITLE,
  confirmCachedCopyExport,
} from "@/lib/exportCachePrompt";
import { buildJsonExport, buildCsvExport } from "@/lib/memoriesExport";
import { writeAndShare } from "@/lib/exportShare";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import {
  setApiBaseUrl,
  getApiBaseUrl,
  syncToCloud,
  getPendingSyncCount,
} from "@/lib/api";
import { ProUpsellCard } from "@/components/ProUpsellCard";
import { DevToolsLauncher } from "@/components/DevToolsLauncher";
import { MemCharacter } from "@/components/MemCharacter";
import {
  getPrivacyPolicyUrl,
  getTermsOfServiceUrl,
  openLegalUrl,
} from "@/lib/legal";
import {
  type NotificationCategory,
  NOTIFICATION_CATEGORIES,
  cancelCategory,
  formatReminderTime,
  getAllCategoryPreferences,
  getCategoryTime,
  getNotificationPermissionStatus,
  hasSeenNotificationPrePrompt,
  markNotificationPrePromptSeen,
  type ReminderTime,
  requestNotificationPermission,
  scheduleCategory,
  setCategoryEnabled,
  setCategoryTime,
  type NotificationPermissionStatus,
} from "@/lib/notifications";
import { getCurrentVersion, getCurrentBuildNumber } from "@/lib/forceUpdate";
import {
  useHaptics,
  useHapticMutePrefs,
  useHapticsMasterEnabled,
  HAPTIC_NAMES,
} from "@/lib/haptics";
import type { HapticName } from "@/lib/haptics";
import {
  COGNITIVE_AUDIO_CONTEXTS,
  COGNITIVE_AUDIO_LABELS,
  BINAURAL_HZ,
  applyLiveMasterVolume,
  hasBundledBed,
  markHeadphonesHintShown,
  shouldShowHeadphonesHint,
  useCognitiveAudioPrefs,
} from "@/lib/cognitiveAudio";
import { useProfile } from "@/context/ProfileContext";
import { type UserProfile } from "@/lib/profile";
import { API_URL_MAX_LENGTH, validateApiUrl } from "@/lib/inputLimits";
import {
  loadEmbeddings,
  loadDailyCap,
  loadPatternsMeta,
  clearAiEngineCache,
  EMBEDDING_DAILY_CAP,
} from "@/lib/aiEngineStorage";
import {
  dismissCoreHapticsHint,
  shouldShowCoreHapticsHint,
} from "@/lib/coreHapticsHint";
import { getAvailability } from "@/modules/expo-core-haptics";
import {
  setMemCaptionsEnabled,
  setMemVoiceId,
  useMemCaptionsEnabled,
  useMemVoiceId,
} from "@/lib/memVoicePrefs";
import { useDeveloperOptionsEnabled } from "@/lib/developerOptions";
import { captureSentryError, isSentryEnabled } from "@/lib/sentry";
import {
  setMemMomentEnabled,
  useMemMomentEnabled,
} from "@/lib/moodMoment";
import {
  getCuratedMemVoices,
  isInstalledVoice,
  type CuratedMemVoice,
} from "@/lib/memVoiceCatalog";

// Friendly label + one-line description for each MemTool haptic
// signature, surfaced in the "Try a haptic" demo so users can tap to
// feel each one. Order matches HAPTIC_NAMES so the rows are presented
// in the same sequence they appear in `lib/haptics/patterns.ts` (the
// canonical .ahap files), which is also the order they're documented
// in Task #226 / Task #231.
const HAPTIC_DEMO_LABELS: Record<HapticName, { title: string; subtitle: string }> = {
  capture: {
    title: "Capture",
    subtitle: "The 'caught it' tap when a memory is saved.",
  },
  "link-formed": {
    title: "Link formed",
    subtitle: "Two memories bonding into a pair.",
  },
  "streak-extended": {
    title: "Streak extended",
    subtitle: "Crescendo when a streak day is added.",
  },
  "day-recap-ready": {
    title: "Day recap ready",
    subtitle: "Your day is summarised — gentle three-tap chime.",
  },
  error: {
    title: "Error",
    subtitle: "Two firm thumps — MemTool saying no.",
  },
  undo: {
    title: "Undo",
    subtitle: "A soft tap pulling back.",
  },
};

const API_URL_STORAGE_KEY = "memtool:apiBaseUrl";

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, deleteAccount } = useAuth();
  const {
    soundEnabled,
    toggleSound,
    memMuted,
    toggleMemMuted,
    highContrast,
    toggleHighContrast,
  } = useSettings();
  const { status: subscriptionStatus } = useSubscription();
  const isPro = subscriptionStatus?.is_pro === true;
  const haptics = useHaptics();
  // "Mem captions" accessibility opt-in (Task #293). Default off.
  // Persisted per-user; the AI Guide screen reads the same hook so
  // a flip here lights up the caption strip immediately even if
  // the user is on a different tab while toggling.
  const memCaptionsUserId = user?.id ?? user?.email ?? "";
  const memCaptionsEnabled = useMemCaptionsEnabled(memCaptionsUserId);
  // Task #346 — global opt-out for the low-mood MemMomentCard. The
  // hook hydrates from AsyncStorage on mount; the Switch row below
  // writes back via `setMemMomentEnabled`. Wellness and Recap read
  // the same hook so a flip here propagates without a reload.
  const memMomentEnabled = useMemMomentEnabled();
  const handleToggleMemCaptions = (nextEnabled: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    if (!memCaptionsUserId) return;
    void setMemCaptionsEnabled(memCaptionsUserId, nextEnabled);
  };
  // Per-signature mute state (Task #243). The Settings card is the
  // only place that needs to *render* mute state; the playback layer
  // in `useHaptic` reads the same module-scope cache directly so
  // every other call site stays oblivious.
  const { isMuted: isHapticMuted, setMuted: setHapticMuted } =
    useHapticMutePrefs();
  // Master "Haptics" switch (Task #252). Split out from the legacy
  // "Sound Effects" switch — see the Preferences card below — so
  // users can silence haptics app-wide without silencing audio.
  // Composes with the per-signature mutes above: either one set to
  // off skips a pattern at the playback layer in `useHaptic`.
  const {
    enabled: hapticsMasterEnabled,
    setEnabled: setHapticsMasterEnabled,
  } = useHapticsMasterEnabled();

  // Cognitive sound layer preferences (Task #341). Master switch
  // defaults to OFF (the layer is opt-in); the binaural sub-layer
  // is gated behind a second toggle so users who want pure ambient
  // never get a tone they didn't ask for. Volume drags update live
  // playback via `applyLiveMasterVolume` so the user can hear the
  // change as they adjust.
  const {
    prefs: cognitiveAudioPrefs,
    setEnabled: setCognitiveAudioEnabled,
    setBinauralEnabled: setBinauralEnabledPref,
    setMasterVolume: setCognitiveAudioMasterVolume,
  } = useCognitiveAudioPrefs();

  // Headphones-recommended hint gating (Task #341). The hint
  // surfaces only the first time binaural is enabled WITHOUT
  // headphones connected. `headphonesHintShown` is set true only
  // when the hint has actually been displayed and then dismissed —
  // either by tapping "Got it" or by toggling binaural off while
  // the hint is visible. We deliberately do NOT mark shown when
  // the user enables binaural with headphones already connected,
  // so a user who later unplugs and re-enables binaural still gets
  // a one-time nudge. If detection isn't available we err on the
  // side of showing the hint once.
  const [headphonesHintVisible, setHeadphonesHintVisible] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!cognitiveAudioPrefs.enabled) {
      setHeadphonesHintVisible(false);
      return () => {
        cancelled = true;
      };
    }
    if (!cognitiveAudioPrefs.binauralEnabled) {
      // Binaural turned off WHILE the hint was visible — treat as
      // dismiss so we don't re-nag the next time binaural turns on.
      if (headphonesHintVisible && !cognitiveAudioPrefs.headphonesHintShown) {
        void markHeadphonesHintShown();
      }
      setHeadphonesHintVisible(false);
      return () => {
        cancelled = true;
      };
    }
    if (cognitiveAudioPrefs.headphonesHintShown) {
      setHeadphonesHintVisible(false);
      return () => {
        cancelled = true;
      };
    }
    void shouldShowHeadphonesHint().then((shouldShow) => {
      if (cancelled) return;
      if (shouldShow) {
        setHeadphonesHintVisible(true);
      }
      // Headphones already connected → don't show, don't mark
      // shown. The next time binaural is freshly enabled (e.g.
      // after the user unplugs) we'll re-evaluate.
    });
    return () => {
      cancelled = true;
    };
  }, [
    cognitiveAudioPrefs.enabled,
    cognitiveAudioPrefs.binauralEnabled,
    cognitiveAudioPrefs.headphonesHintShown,
    headphonesHintVisible,
  ]);
  const dismissHeadphonesHint = useCallback(() => {
    setHeadphonesHintVisible(false);
    void markHeadphonesHintShown();
  }, []);

  // Persisted "Developer options" toggle (Task #317). Off by default
  // in production, on in `__DEV__` so the team's own workflow is
  // unchanged. Gates the Cloud API URL controls below — flipping it
  // off does NOT wipe a previously saved URL; the saved value
  // reappears the next time the toggle is enabled.
  const {
    enabled: developerOptionsEnabled,
    setEnabled: setDeveloperOptionsEnabledPref,
  } = useDeveloperOptionsEnabled();

  const [apiUrlInput, setApiUrlInput] = useState("");
  const [savedApiUrl, setSavedApiUrl] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [urlSaved, setUrlSaved] = useState(false);
  // Round 3 added inline validation for the Cloud API URL: a typo
  // like "yes" or a `javascript:` URL used to be silently written
  // to AsyncStorage and then failed on every subsequent request
  // with an opaque error. We now refuse to save anything that isn't
  // an http(s) URL and surface the reason in this state slot.
  const [urlError, setUrlError] = useState<string | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  // True only while a *retry* attempt of fetchAllMemoriesForExport is
  // in flight (i.e. after the user tapped "Try again" on the
  // cached-copy prompt and before that follow-up fetch resolves).
  // Drives the "Retrying network…" sub-label on the export row so a
  // slow follow-up fetch doesn't look identical to the pre-retry
  // exporting state — see Task #136.
  const [isRetrying, setIsRetrying] = useState(false);
  const exportAbortRef = useRef<AbortController | null>(null);

  // Mem AI engine status — read directly from AsyncStorage on every
  // focus so a patterns rebuild that happened while the user was on
  // another tab shows up as soon as they come back here. The card is
  // a status reflector, not a controller; the only mutation is the
  // "Clear local cache" action below.
  const [aiVectorCount, setAiVectorCount] = useState<number>(0);
  const [aiCapUsed, setAiCapUsed] = useState<number>(0);

  // One-time "richer haptics" hint (Task #226). Only ever flips to
  // true on iPhones where the local Core Haptics module is actually
  // playing the .ahap files; Android, web, and JS-fallback iPhones
  // never see it. Dismissal persists in AsyncStorage so the hint
  // never reappears on the same install.
  const [showCoreHapticsHint, setShowCoreHapticsHint] = useState(false);

  // Which playback path the "Try a haptic" demo (Task #231) is going
  // to use right now. `getAvailability()` is hardware-static for the
  // lifetime of the install (same call the Core Haptics hint uses), so
  // we read it once on mount and label the demo accordingly:
  //   - "native"   → iPhone where CHHapticEngine plays the .ahap files
  //   - "fallback" → everyone else (Android, web, Expo Go, JS-only iPhone)
  // The demo is shown to *both* paths on purpose — fallback users
  // should still feel the approximation — but they need to know which
  // one they're getting so the experience matches what's documented.
  const [hapticPlaybackPath, setHapticPlaybackPath] = useState<
    "native" | "fallback"
  >("fallback");

  // Curated voice catalog (Task #292) — resolved once on mount via
  // `Speech.getAvailableVoicesAsync()` and trimmed to the 3-5 voices
  // we actually want to expose. Empty until hydration completes; the
  // picker section short-circuits while empty so we don't render an
  // "empty list" flash. The "System default" entry is always first
  // (`id: null`) so even devices with no extra voices installed get
  // a working selector.
  const [curatedVoices, setCuratedVoices] = useState<CuratedMemVoice[]>([]);
  // Per-user storage key for the voice id — must mirror the key
  // `ai-guide.tsx` uses to read it (`user?.id ?? user?.email`),
  // otherwise Settings would write to one slot and the chat screen
  // would read from another. `User.id` is optional in `lib/auth.ts`;
  // when absent we fall back to email so existing email-only
  // installs still get a stable, per-user key.
  const voicePrefsUserId = user?.id ?? user?.email ?? "";
  // The currently-saved selection (`null` = system default). Feeds
  // into `useMemSpeech` over in `ai-guide.tsx` via the same hook.
  const selectedVoiceId = useMemVoiceId(voicePrefsUserId);
  // Saved-id-to-display reconciliation. If the persisted id isn't
  // present in the catalog we resolved on this device (e.g. the
  // user picked "Warm" on iOS and then opened MemTool on Android),
  // collapse to `null` so the "System default" row gets the
  // checkmark instead of orphaning the selection state. The actual
  // speech path is independently safe — `ai-guide.tsx` does the
  // same coercion before handing the id to `useMemSpeech`.
  const effectiveSelectedVoiceId = isInstalledVoice(
    selectedVoiceId ?? null,
    curatedVoices,
  )
    ? (selectedVoiceId ?? null)
    : null;

  // Drives the frosted-glass intensity on the sticky Settings header
  // (Task #96). Updated off the JS thread via `useAnimatedScrollHandler`
  // so the BlurView ramp stays smooth even while the settings list is
  // fast-scrolling. The header is absolutely positioned so the
  // sections scroll *behind* the frost (mirrors Archive); the live
  // header height is measured via onLayout and added to the scroll
  // contentContainer's top padding so the profile section isn't
  // initially obscured.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  const [headerHeight, setHeaderHeight] = useState(0);
  const onHeaderLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    setHeaderHeight((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  };

  // ─── Version display + developer easter egg (Task #300) ───────────
  // Tapping the version row 7 times reveals a hidden dev-info panel.
  // The count resets after the panel shows so the user can trigger it
  // again. `appVersion` and `buildNumber` are read from expo-constants
  // once and never change during a session.
  const appVersion = getCurrentVersion();
  const buildNumber = getCurrentBuildNumber();
  const [versionTapCount, setVersionTapCount] = useState(0);
  const [showDevPanel, setShowDevPanel] = useState(false);

  const handleVersionTap = () => {
    Haptics.selectionAsync().catch(() => {});
    const next = versionTapCount + 1;
    if (next >= 7) {
      setShowDevPanel(true);
      setVersionTapCount(0);
      // Use the named haptic verb instead of raw notificationAsync
      // so the master haptics gate and per-signature mute are respected.
      haptics.play("capture");
    } else {
      setVersionTapCount(next);
    }
  };

  // ─── Notification permission + category state (Task #300) ─────────
  // Loaded on every focus so the row reflects the true OS state even
  // if the user changed permissions in iOS Settings while the app was
  // backgrounded. `notifLoaded` gates the section so we don't flash
  // "undetermined" before the read resolves.
  const [notifPermStatus, setNotifPermStatus] =
    useState<NotificationPermissionStatus>("undetermined");
  const [notifCategories, setNotifCategories] = useState<
    Record<NotificationCategory, boolean>
  >({ daily_recap_reminder: true, capture_streak_nudge: true });
  const [notifTimes, setNotifTimes] = useState<
    Record<NotificationCategory, ReminderTime>
  >({
    daily_recap_reminder: { hour: 20, minute: 0 },
    capture_streak_nudge: { hour: 19, minute: 0 },
  });
  const [notifLoaded, setNotifLoaded] = useState(false);
  // When non-null, the time-picker modal is open for this category.
  // Populated on tap of the chosen-time row; cleared on confirm/cancel.
  const [timePickerCategory, setTimePickerCategory] =
    useState<NotificationCategory | null>(null);

  // Schedule (idempotently) every enabled category against its current
  // chosen time. Used both right after the user grants OS permission
  // and on every focus hydration so users who land on Settings with
  // enabled toggles + permission already granted always have live
  // schedules — without requiring them to manually re-toggle.
  const reconcileSchedules = async (
    cats: Record<NotificationCategory, boolean>,
    times: Record<NotificationCategory, ReminderTime>,
  ) => {
    await Promise.all(
      NOTIFICATION_CATEGORIES.map((c) =>
        cats[c.id] ? scheduleCategory(c.id, times[c.id]) : cancelCategory(c.id),
      ),
    );
  };

  const handleNotifPermToggle = async (nextEnabled: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    if (nextEnabled) {
      const onGranted = async (status: NotificationPermissionStatus) => {
        setNotifPermStatus(status);
        // Newly granted permission — schedule every category the
        // user already has enabled so the toggles take effect
        // immediately, without requiring a manual re-toggle.
        if (status === "granted") {
          await reconcileSchedules(notifCategories, notifTimes);
        }
      };
      const seen = await hasSeenNotificationPrePrompt();
      if (!seen) {
        await markNotificationPrePromptSeen();
        Alert.alert(
          "Stay in the loop",
          "MemTool can nudge you when your daily recap is ready and remind you to keep your memory streak alive. You control which ones in Settings.",
          [
            { text: "Not now", style: "cancel" },
            {
              text: "Enable notifications",
              onPress: async () => {
                const status = await requestNotificationPermission();
                await onGranted(status);
              },
            },
          ],
        );
      } else {
        const status = await requestNotificationPermission();
        await onGranted(status);
      }
    } else {
      // Can't revoke OS permission programmatically — guide to Settings.
      Alert.alert(
        "Turn off notifications",
        "To disable MemTool notifications, tap Open Settings and turn them off from there.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Settings",
            onPress: () => { Linking.openSettings().catch(() => {}); },
          },
        ],
      );
    }
  };

  const handleToggleNotifCategory = async (
    category: NotificationCategory,
    enabled: boolean,
  ) => {
    Haptics.selectionAsync().catch(() => {});
    await setCategoryEnabled(category, enabled);
    setNotifCategories((prev) => ({ ...prev, [category]: enabled }));
    // Wire toggles to the actual OS-level scheduler. Toggling on
    // schedules a daily local notification at the user's chosen
    // (or default) time; toggling off cancels it. Both are no-ops
    // if expo-notifications is unavailable in this environment.
    if (enabled) {
      await scheduleCategory(category, notifTimes[category]);
    } else {
      await cancelCategory(category);
    }
  };

  const handlePickTime = async (
    category: NotificationCategory,
    time: ReminderTime,
  ) => {
    Haptics.selectionAsync().catch(() => {});
    setNotifTimes((prev) => ({ ...prev, [category]: time }));
    setTimePickerCategory(null);
    await setCategoryTime(category, time);
    // Reschedule only if the category is currently enabled —
    // otherwise just persist the preference for next time the
    // user flips the toggle on.
    if (notifCategories[category]) {
      await scheduleCategory(category, time);
    }
  };

  const [aiLastBuilt, setAiLastBuilt] = useState<string>("");
  const [aiClearing, setAiClearing] = useState(false);
  const [aiCleared, setAiCleared] = useState(false);

  const refreshAiStatus = React.useCallback(async () => {
    if (!user?.email) {
      setAiVectorCount(0);
      setAiCapUsed(0);
      setAiLastBuilt("");
      return;
    }
    try {
      const [vectors, cap, meta] = await Promise.all([
        loadEmbeddings(user.email),
        loadDailyCap(user.email),
        loadPatternsMeta(user.email),
      ]);
      setAiVectorCount(Object.keys(vectors).length);
      setAiCapUsed(cap.used);
      setAiLastBuilt(meta.last_built_at);
    } catch {
      // best-effort — engine status is informational only
    }
  }, [user?.email]);

  const handleClearAiCache = async () => {
    if (!user?.email || aiClearing) return;
    Haptics.selectionAsync().catch(() => {});
    setAiClearing(true);
    try {
      await clearAiEngineCache(user.email);
      setAiCleared(true);
      await refreshAiStatus();
      setTimeout(() => setAiCleared(false), 2000);
    } finally {
      setAiClearing(false);
    }
  };

  const formatAiLastBuilt = (iso: string): string => {
    if (!iso) return "Not built yet";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "Not built yet";
    const delta = Date.now() - t;
    const min = Math.round(delta / 60_000);
    if (min < 1) return "Rebuilt just now";
    if (min < 60) return `Rebuilt ${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `Rebuilt ${hr}h ago`;
    const day = Math.round(hr / 24);
    return `Rebuilt ${day}d ago`;
  };

  const {
    profile: rawProfile,
    isLoading: profileLoading,
    refresh: refreshProfile,
    clear: clearProfile,
  } = useProfile();
  const profile: UserProfile | null =
    rawProfile && rawProfile.created === true ? rawProfile : null;
  const [isDeletingProfile, setIsDeletingProfile] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // Tracks whether the most recent refreshPending() call failed so we
  // can show a small "Couldn't refresh" hint on the sync row instead
  // of silently resetting the badge to 0 (which lied to the user
  // about whether anything was still pending). On success we clear
  // the hint and fall back to the real count.
  const [pendingRefreshError, setPendingRefreshError] = useState(false);

  const refreshPending = async () => {
    try {
      const count = await getPendingSyncCount();
      setPendingCount(count);
      setPendingRefreshError(false);
    } catch {
      // Keep the previous pendingCount visible so the badge doesn't
      // flicker to 0 on a transient AsyncStorage hiccup; surface the
      // failure as an inline hint so users know we don't fully trust
      // the number right now.
      setPendingRefreshError(true);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(API_URL_STORAGE_KEY);
        if (stored) {
          setApiUrlInput(stored);
          setSavedApiUrl(stored);
          setApiBaseUrl(stored);
        } else {
          const current = getApiBaseUrl();
          if (current) setApiUrlInput(current);
        }
      } catch {
        // ignore
      }
      await refreshPending();
    })();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      refreshPending();
    }, []),
  );

  useFocusEffect(
    React.useCallback(() => {
      void refreshProfile();
    }, [refreshProfile]),
  );

  useFocusEffect(
    React.useCallback(() => {
      void refreshAiStatus();
    }, [refreshAiStatus]),
  );

  // Refresh notification permission state on every focus so the row
  // reflects reality even after the user toggles permission in iOS
  // Settings while the app was backgrounded.
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      void (async () => {
        const [status, cats, recapTime, streakTime] = await Promise.all([
          getNotificationPermissionStatus(),
          getAllCategoryPreferences(),
          getCategoryTime("daily_recap_reminder"),
          getCategoryTime("capture_streak_nudge"),
        ]);
        if (cancelled) return;
        const times = {
          daily_recap_reminder: recapTime,
          capture_streak_nudge: streakTime,
        };
        setNotifPermStatus(status);
        setNotifCategories(cats);
        setNotifTimes(times);
        setNotifLoaded(true);
        // Focus reconciliation (Task #328): if the OS permission is
        // granted, make sure the categories the user already has
        // enabled are actually scheduled. This covers the common
        // case of an existing user upgrading into the scheduling
        // feature with permission already granted and toggles still
        // on from before — they should get reminders without having
        // to flip a switch. `scheduleCategory` cancels its prior id
        // before re-scheduling, so this is idempotent.
        if (status === "granted") {
          await reconcileSchedules(cats, times);
        }
      })();
      return () => { cancelled = true; };
    }, []),
  );

  // Evaluate the Core Haptics hint exactly once on mount. We don't
  // need a focus effect — `getAvailability()` is hardware-static for
  // the lifetime of the install, and once the user dismisses the
  // card we never want to re-evaluate (even if AsyncStorage was
  // wiped) within the same session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const should = await shouldShowCoreHapticsHint();
      if (!cancelled) setShowCoreHapticsHint(should);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Same hardware-static check the hint uses, evaluated once on mount
  // for the "Try a haptic" demo's playback-path label. We deliberately
  // do NOT play any haptic from this effect — playback is gated on an
  // explicit user tap in the demo rows below.
  useEffect(() => {
    setHapticPlaybackPath(getAvailability().available ? "native" : "fallback");
  }, []);

  // Hydrate the curated voice catalog (Task #292). Runs once on mount
  // — the underlying `Speech.getAvailableVoicesAsync()` is a
  // hardware-static enumeration of voices installed on the device, so
  // re-running it on focus would just churn the same list. Wrapped in
  // a cancel guard so we don't `setState` after unmount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await getCuratedMemVoices();
        if (!cancelled) {
          setCuratedVoices(list);
        }
      } catch {
        // Voice enumeration is best-effort. If it throws (e.g. on a
        // platform without TTS), the picker section just stays
        // hidden. Mem visual replies still work without a TTS voice.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stop any in-flight preview when the screen unmounts so a long
  // utterance doesn't keep talking after the user navigates away.
  useEffect(() => {
    return () => {
      Speech.stop().catch(() => {});
    };
  }, []);

  const handleSelectVoice = (voice: CuratedMemVoice) => {
    // Confirmation tick — picker rows are a control surface, same
    // reasoning as the haptic enable/disable toggles above. Skipped
    // by design when haptics are muted via the global gate.
    Haptics.selectionAsync().catch(() => {});

    // Persist FIRST (fire-and-forget) so the next render of
    // `ai-guide.tsx` immediately picks up the change via
    // `useMemVoiceId`. The hook publishes the new id synchronously
    // to its in-memory cache before the AsyncStorage write resolves.
    void setMemVoiceId(voicePrefsUserId, voice.id);

    // Stop any prior preview so back-to-back row taps don't queue
    // up multiple "Hi — I'm Mem." utterances on top of each other.
    Speech.stop().catch(() => {});
    if (voice.id == null || voice.id.trim().length === 0) return;

    Speech.speak("Hi — I'm Mem.", {
      // Launch safety: preview only a concrete curated voice id.
      voice: voice.id,
      // Match the AI Guide cadence so the preview is a faithful
      // sample of what the user will actually hear from Mem.
      rate: 0.94,
      pitch: 1.0,
    });
  };

  const handlePlayHapticDemo = (name: HapticName) => {
    // Intentionally no leading `Haptics.selectionAsync()` here —
    // this row's whole purpose is to let users feel the signature in
    // isolation and compare patterns side-by-side. A tap-confirmation
    // tick stacked on top of the signature would smear the first
    // event and defeat the "oh, that's what they mean" moment.
    //
    // `ignoreMute: true` is critical (Task #243): the demo must
    // still play a disabled signature when the user explicitly taps
    // it, so they can re-evaluate the pattern before deciding to
    // turn it back on. The mute gate only applies to feature code
    // calling `play()` from elsewhere in the app.
    haptics.play(name, { ignoreMute: true });
  };

  const handleToggleHapticMute = (name: HapticName, nextEnabled: boolean) => {
    // The Switch's `value` mirrors "enabled" (on means "I want to
    // feel this"), so muted = !nextEnabled. A confirmation selection
    // tick is OK here — toggles are a control surface, not a
    // listening surface, and the tick is the standard iOS feedback
    // for a Switch flip.
    Haptics.selectionAsync().catch(() => {});
    void setHapticMuted(name, !nextEnabled);
  };

  const handleToggleHapticsMaster = (nextEnabled: boolean) => {
    // Fire the confirmation tick BEFORE flipping the master so the
    // user still feels the toggle's own tap-confirmation when
    // they're switching haptics off — otherwise the gate we're
    // about to install would silently swallow the very tick that
    // confirms their action. (Going from off → on doesn't have
    // this problem, but doing it both ways keeps the toggle
    // behaviour symmetric.)
    Haptics.selectionAsync().catch(() => {});
    void setHapticsMasterEnabled(nextEnabled);
  };

  const handleDismissCoreHapticsHint = () => {
    Haptics.selectionAsync().catch(() => {});
    setShowCoreHapticsHint(false);
    void dismissCoreHapticsHint();
  };

  const handleRedoIntro = () => {
    Haptics.selectionAsync();
    router.push({ pathname: "/onboarding-chat", params: { from: "settings" } });
  };

  const handleWatchIntroVideo = () => {
    Haptics.selectionAsync();
    // Cast: the typed-routes registry is regenerated by Expo on the
    // next dev-server boot; the route file already exists at
    // `app/(app)/intro-video.tsx`.
    router.push("/intro-video" as never);
  };

  const performDeleteProfile = async () => {
    if (!user?.email || isDeletingProfile) return;
    setIsDeletingProfile(true);
    try {
      await clearProfile();
      haptics.play("capture");
    } catch {
      haptics.play("error");
      Alert.alert("Couldn't delete", "We couldn't reach the server. Try again in a moment.");
    } finally {
      setIsDeletingProfile(false);
    }
  };

  const handleDeleteProfile = () => {
    Haptics.selectionAsync();
    Alert.alert(
      "Delete profile?",
      "Mem will start learning from scratch — this can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void performDeleteProfile();
          },
        },
      ],
    );
  };

  const handleLogout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await logout();
    // Don't navigate imperatively — once `user` flips to null the
    // (app) auth guard will redirect to /login declaratively.
  };

  const performDeleteAccount = async () => {
    if (isDeletingAccount) return;
    setIsDeletingAccount(true);
    try {
      await deleteAccount();
      // deleteAccount calls apiLogout internally — once `user` flips
      // to null the auth guard will redirect to /login declaratively.
      haptics.play("capture");
    } catch {
      haptics.play("error");
      Alert.alert(
        "Couldn't delete account",
        "We couldn't reach the server. Please try again or contact support.",
      );
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleDeleteAccount = () => {
    Haptics.selectionAsync();
    Alert.alert(
      "Delete account?",
      "This permanently deletes all your MemTool data — memories, profile, and settings. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => {
            void performDeleteAccount();
          },
        },
      ],
    );
  };

  const handleEditProfile = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push("/(app)/edit-profile");
  };

  const handleSaveUrl = async () => {
    Haptics.selectionAsync();
    const trimmed = apiUrlInput.trim();
    // Empty input means "clear the override and go back to local-only"
    // — that's a valid action, no validation needed.
    if (!trimmed) {
      // Clear the in-memory override FIRST so the user gets the
      // expected "stop talking to the cloud" behaviour even if the
      // AsyncStorage write fails (rare, but possible when the device
      // is out of free space). The persisted value stays out of sync
      // for this session, but next launch will rehydrate from whatever
      // AsyncStorage actually has, which is the conservative choice.
      setApiBaseUrl(null);
      setSavedApiUrl(null);
      setUrlError(null);
      try {
        await AsyncStorage.removeItem(API_URL_STORAGE_KEY);
      } catch {
        // ignore — already cleared in memory above
      }
      setUrlSaved(true);
      setTimeout(() => setUrlSaved(false), 1500);
      return;
    }
    // Non-empty input must pass the http(s) URL validator before we
    // persist it; refusing here is much friendlier than letting every
    // subsequent fetch fail with an opaque parse error.
    const result = validateApiUrl(trimmed);
    if (!result.ok) {
      setUrlError(result.reason);
      // Validation refusal — reuse the "error" verb so a bad URL feels
      // the same as any other "MemTool says no" moment.
      haptics.play("error");
      return;
    }
    setUrlError(null);
    try {
      await AsyncStorage.setItem(API_URL_STORAGE_KEY, result.url);
      setApiBaseUrl(result.url);
      setSavedApiUrl(result.url);
      setUrlSaved(true);
      setTimeout(() => setUrlSaved(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleSyncNow = async () => {
    if (isSyncing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncToCloud();
      if (result.skipped) {
        setSyncResult("Set a Cloud API URL first");
      } else if (result.synced === 0) {
        setSyncResult("Nothing to sync");
      } else {
        const remaining = result.remaining ?? 0;
        setSyncResult(
          remaining > 0
            ? `${result.synced} item${result.synced === 1 ? "" : "s"} synced · ${remaining} pending`
            : `${result.synced} item${result.synced === 1 ? "" : "s"} synced`,
        );
      }
    } catch {
      setSyncResult("Sync failed");
    } finally {
      setIsSyncing(false);
      await refreshPending();
    }
  };

  const initials = user?.email?.substring(0, 2).toUpperCase() || "ME";

  useEffect(() => {
    return () => {
      exportAbortRef.current?.abort();
    };
  }, []);

  const performExport = async (format: "json" | "csv") => {
    if (!user?.email) return;
    setIsExporting(true);
    setExportProgress(0);
    setExportError(null);
    setIsRetrying(false);
    // One controller is shared across every retry attempt so the
    // existing user-cancel contract still holds: an in-flight Cancel
    // (the unmount cleanup or a future cancel button) aborts whichever
    // attempt is currently fetching, not just the first one.
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      let memories: Awaited<ReturnType<typeof fetchAllMemoriesForExport>>["memories"] = [];
      let usedCache = false;
      // Tracks whether the *next* iteration of the loop is a retry
      // attempt (i.e. the previous iteration ended in outcome ===
      // "retry"). The first attempt is intentionally not flagged as
      // "retrying" — that label only makes sense after the user has
      // explicitly tapped "Try again". Re-flipped to true at the
      // bottom of the retry branch and back to false the instant the
      // follow-up fetch resolves, so the indicator never lingers
      // across the cached-copy alert or the share sheet (Task #136).
      let isRetryAttempt = false;
      // Distinct from `isRetryAttempt`: that flag is cleared the
      // moment the follow-up fetch resolves (so the "Retrying
      // network…" indicator doesn't bleed under a re-popped alert).
      // We still need to know "did the user already see this prompt
      // once?" when wording the *next* prompt, so the alert can soften
      // its lead-in to "Still couldn't reach the server — …" instead
      // of re-announcing the failure as if it were a first-time event
      // (Task #142). Sticky for the rest of this performExport call.
      let hasPromptedForCachedCopy = false;

      // Retry loop: when the cached-copy prompt returns "retry", we
      // re-run fetchAllMemoriesForExport in place. A successful retry
      // (usedCache: false) drops out of the loop with no warning copy;
      // a still-offline retry pops the prompt again. "resolve" /
      // "cancel" are terminal — see CachedCopyOutcome.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        setExportProgress(0);
        // Flip the indicator on *before* awaiting the fetch so a slow
        // network connection actually shows the user that their retry
        // tap registered, instead of looking identical to the
        // pre-retry exporting state.
        if (isRetryAttempt) setIsRetrying(true);
        const result = await fetchAllMemoriesForExport(user.email, {
          onProgress: (count) => setExportProgress(count),
          signal: controller.signal,
        });
        // Clear the indicator the moment the fetch resolves —
        // critically, *before* either the share sheet opens (success)
        // or the cached-copy alert re-pops (still offline). Otherwise
        // the user would briefly see "Retrying network…" stacked on
        // top of the prompt, which is misleading because the network
        // attempt already completed.
        setIsRetrying(false);
        isRetryAttempt = false;

        if (controller.signal.aborted) return;

        memories = result.memories;
        usedCache = result.usedCache;

        if (!usedCache) break;

        // Confirmation lives in `lib/exportCachePrompt` so it's
        // unit-testable. The helper resolves with one of three outcomes
        // — see `CachedCopyOutcome` — and we're responsible for
        // translating "cancel" into an AbortError so the catch block
        // below silently swallows it (user-cancel ≠ error).
        // `isRetry` softens the alert wording from a first-time
        // announcement to "Still couldn't reach the server — …"
        // when this prompt is firing on the heels of a failed retry.
        // We can't reuse `isRetryAttempt` here — that flag is cleared
        // on line above the moment the fetch resolves so the
        // "Retrying network…" indicator doesn't linger under the
        // alert. `hasPromptedForCachedCopy` is the sticky version:
        // false only on the very first prompt of this export, true
        // for every re-pop afterwards. (Task #142.)
        const outcome = await confirmCachedCopyExport({
          memoryCount: memories.length,
          isRetry: hasPromptedForCachedCopy,
        });
        hasPromptedForCachedCopy = true;
        if (outcome === "resolve") break;
        if (outcome === "cancel") {
          const cancelErr = new Error("Cancelled");
          cancelErr.name = "AbortError";
          throw cancelErr;
        }
        // outcome === "retry" → loop and refetch under the same
        // controller. Mark the next iteration as a retry attempt so
        // the indicator switches on while that fetch is in flight.
        isRetryAttempt = true;
      }

      const date = new Date().toISOString().slice(0, 10);
      const shareTitle = usedCache
        ? CACHED_COPY_SHARE_TITLE
        : DEFAULT_EXPORT_SHARE_TITLE;
      // Pass `usedCache` through so the saved file itself carries the
      // "older memories may be missing" warning — the share-sheet title
      // is gone the moment the file lands in Files / AirDrop / email,
      // but `_export_metadata.note` (JSON) and the leading `# Cached
      // export — ...` row (CSV) survive.
      if (format === "json") {
        const content = buildJsonExport(memories, { usedCache });
        await writeAndShare(`memtool-memories-${date}.json`, content, "application/json", shareTitle);
      } else {
        const content = buildCsvExport(memories, { usedCache });
        await writeAndShare(`memtool-memories-${date}.csv`, content, "text/csv", shareTitle);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      // The data layer throws AuthError with a numeric `status` for HTTP
      // failures (and re-throws them rather than silently serving cache).
      // Branch lives in `lib/exportErrorHandler` so it's unit-testable —
      // an expired session needs to route the user to sign-in, not
      // bounce on the generic "try again" banner.
      handleExportError(err, { setExportError, logout });
    } finally {
      setIsExporting(false);
      // Belt-and-suspenders: the retry indicator is normally cleared
      // inline as soon as the fetch resolves, but a thrown error /
      // user cancel mid-retry would skip that path. Clearing here
      // guarantees the next time the export row is shown it isn't
      // stuck on "Retrying network…".
      setIsRetrying(false);
      exportAbortRef.current = null;
    }
  };

  const handleExport = () => {
    Haptics.selectionAsync();
    setExportError(null);
    Alert.alert(
      "Export my memories",
      "Choose a format for your download.",
      [
        {
          text: "JSON (full fidelity)",
          onPress: () => { void performExport("json"); },
        },
        {
          text: "CSV (spreadsheet)",
          onPress: () => { void performExport("csv"); },
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  };

  const handleOpenPrivacy = async () => {
    Haptics.selectionAsync();
    await openLegalUrl(getPrivacyPolicyUrl());
  };

  const handleOpenTerms = async () => {
    Haptics.selectionAsync();
    await openLegalUrl(getTermsOfServiceUrl());
  };

  const handleOpenLicenses = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push("/(app)/licenses");
  };

  const handleNavigateSupport = () => {
    Haptics.selectionAsync();
    router.push("/support");
  };

  const handleOpenAbout = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push("/about");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Animated.ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: headerHeight + 8, paddingBottom: insets.bottom + 100 },
        ]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        <View style={styles.profileSection}>
          {/*
            Resting Mem (Task #340). Settings is a "no demands"
            surface — Mem is just here, companion not surveillance.
            Decorative; non-interactive so she never blocks the
            avatar tap target or the email row below.
          */}
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ marginBottom: spacing.sm }}
          >
            <MemCharacter size={72} expression="resting" />
          </View>
          <LinearGradient
            colors={["#a78bfa", "#5eead4"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarGradient}
          >
            <Text style={[styles.avatarText, { color: colors.background }]}>{initials}</Text>
          </LinearGradient>
          <Text style={[styles.email, { color: colors.foreground }]}>{user?.email}</Text>
        </View>

        {showCoreHapticsHint && (
          <View
            accessibilityRole="alert"
            accessibilityLabel="Now using richer haptics on this iPhone"
            testID="core-haptics-hint"
            style={[
              styles.card,
              styles.coreHapticsHintCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Ionicons name="pulse-outline" size={24} color={colors.primary} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  Now using richer haptics
                </Text>
                <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                  This iPhone plays MemTool's signature taps with finer texture.
                </Text>
              </View>
              <Pressable
                onPress={handleDismissCoreHapticsHint}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Dismiss richer haptics hint"
                testID="core-haptics-hint-dismiss"
                style={({ pressed }) => [pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="close" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>MEMBERSHIP</Text>

        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/subscription");
          }}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { opacity: 0.8 },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name={isPro ? "star" : "sparkles-outline"}
                size={24}
                color={colors.primary}
              />
            </View>
            <View style={styles.rowContent}>
              <View style={styles.pendingHeader}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  {isPro ? "MemTool Pro" : "Free plan"}
                </Text>
                {isPro && (
                  <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.badgeText, { color: colors.background }]}>PRO</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                {isPro ? "Manage your subscription" : "See what's in MemTool Pro"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
          </View>
        </Pressable>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>PREFERENCES</Text>
        
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/*
            "Sound" (audio-only) and "Haptics" (vibrations) are split
            into two independent master switches as of Task #252. The
            single "Sound Effects" toggle that used to live here had
            a label that promised both audio AND haptic feedback but
            only ever gated audio — confusing once per-signature
            haptic mutes (Task #243) shipped, since users who'd
            turned "Sound Effects" off and assumed haptics were also
            off were still feeling every buzz. The new "Haptics"
            switch is the master for the per-signature card below:
            flipping it off silently skips every signature regardless
            of the individual toggles.
          */}
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="volume-high" size={24} color={colors.primary} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Sound</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>Game sounds in Memory Match and Game 24</Text>
            </View>
            <Switch
              value={soundEnabled}
              onValueChange={() => {
                Haptics.selectionAsync();
                toggleSound();
              }}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.foreground}
              testID="settings-sound-toggle"
            />
          </View>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="pulse" size={24} color={colors.primary} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Haptics</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                MemTool's signature buzzes — fine-tune each one below
              </Text>
            </View>
            <Switch
              value={hapticsMasterEnabled}
              onValueChange={handleToggleHapticsMaster}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.foreground}
              accessibilityLabel="Haptics enabled"
              testID="settings-haptics-master-toggle"
            />
          </View>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          {/*
            "Mute Mem" coach toggle (Task #324). Silences the Mem
            avatar reactions on the level-select + LevelResultOverlay
            surfaces. Default OFF (Mem speaks) so first-run users
            hear the ladder coach, with a one-tap mute for users
            who'd rather progress in silence. Persists per-user
            via SettingsContext alongside Sound / Haptics.
          */}
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name={memMuted ? "mic-off-outline" : "mic-outline"}
                size={24}
                color={colors.primary}
              />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                Mute Mem
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                Silence Mem's coach reactions on the level screens
              </Text>
            </View>
            <Switch
              value={memMuted}
              onValueChange={() => {
                Haptics.selectionAsync().catch(() => {});
                void toggleMemMuted();
              }}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.foreground}
              accessibilityLabel="Mute Mem coach reactions"
              testID="settings-mute-mem-toggle"
            />
          </View>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          {/*
            "Mem captions" accessibility opt-in (Task #293). Lives
            next to Sound + Haptics because it's the third "how do I
            want Mem to reach me" channel: silent users on iOS get
            no audio, Reduce Motion users get no mouth movement, and
            this strip is the third option that works for both.
            Default off — the streaming bubble is the always-on
            signal; this toggle is for users who want a stronger
            "Mem is talking *now*" cue.
          */}
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="text-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Mem captions</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                Show the word Mem is saying — handy on silent
              </Text>
            </View>
            <Switch
              value={memCaptionsEnabled}
              onValueChange={handleToggleMemCaptions}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.foreground}
              accessibilityLabel="Show Mem captions"
              testID="settings-mem-captions-toggle"
            />
          </View>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="moon" size={24} color={colors.accent} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Dark Mode</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>Dark only — by design</Text>
            </View>
            <Switch
              value={true}
              disabled={true}
              trackColor={{ false: colors.muted, true: colors.accent }}
              thumbColor={colors.foreground}
            />
          </View>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          {/*
            "High Contrast" accessibility opt-in (Task #339). Lives in
            the same Preferences card as Mem captions and Dark Mode
            because it's the third "make Mem easier to read" lever.
            Flipping it merges the `darkHighContrast` overrides on top
            of the cosmic dark palette via `useColors()`, so every
            screen lifts text and accent contrast in one shot. The
            preference is persisted per-user in SettingsContext.
          */}
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name="contrast-outline"
                size={24}
                color={colors.primary}
              />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                High Contrast
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                Boosts text and accent contrast across the app
              </Text>
            </View>
            <Switch
              value={highContrast === true}
              onValueChange={() => {
                Haptics.selectionAsync().catch(() => {});
                void toggleHighContrast();
              }}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.foreground}
              accessibilityLabel="Enable high contrast"
              testID="settings-high-contrast-toggle"
            />
          </View>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          {/*
            Mem mood check-in opt-out (Task #346). Default ON so
            existing users keep the Task #336 MemMomentCard
            behaviour; flipping this off silences the card across
            both the wellness post-save flow and the recap surface
            without disabling wellness logging itself. The pref is
            global (not per-user) and persisted in AsyncStorage via
            `setMemMomentEnabled`; both surfaces hydrate via the
            `useMemMomentEnabled` hook so a flip here takes effect
            immediately even if recap is mounted in another tab.
          */}
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name="heart-outline"
                size={24}
                color={colors.primary}
              />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                Mem mood check-ins
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                Let Mem check in when I'm having a tough day
              </Text>
            </View>
            <Switch
              value={memMomentEnabled}
              onValueChange={(next) => {
                Haptics.selectionAsync().catch(() => {});
                void setMemMomentEnabled(next);
              }}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.foreground}
              accessibilityLabel="Let Mem check in when I'm having a tough day"
              testID="settings-mem-moment-toggle"
            />
          </View>
        </View>

        {/*
          Cognitive sound layer (Task #341). Opt-in ambient + optional
          binaural sub-layer for the four cognitive contexts (capture,
          recap, mini-games, sleep / wind-down). Defaults are
          deliberately conservative: master OFF, binaural OFF, master
          volume 0.4 — the layer is enhancement, never required.
          Volume drags update live playback so the user can audition
          the change without backing out of Settings. The "headphones
          recommended" hint appears the first time binaural is on.
        */}
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>COGNITIVE SOUND</Text>
        <View
          testID="cognitive-audio-card"
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="musical-notes-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Sound layer</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                Soft ambience under capture, recap, games, and wind-down.
              </Text>
            </View>
            <Switch
              value={cognitiveAudioPrefs.enabled}
              onValueChange={(next) => {
                Haptics.selectionAsync().catch(() => {});
                void setCognitiveAudioEnabled(next);
              }}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.foreground}
              accessibilityLabel="Cognitive sound layer enabled"
              testID="cognitive-audio-master-toggle"
            />
          </View>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          <View style={[styles.row, !cognitiveAudioPrefs.enabled && { opacity: 0.45 }]}>
            <View style={styles.rowIcon}>
              <Ionicons name="pulse-outline" size={24} color={colors.accent} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Binaural sub-layer</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                Adds a low brain-state tone (theta · alpha · beta · delta).
              </Text>
            </View>
            <Switch
              value={cognitiveAudioPrefs.binauralEnabled}
              onValueChange={(next) => {
                Haptics.selectionAsync().catch(() => {});
                void setBinauralEnabledPref(next);
              }}
              disabled={!cognitiveAudioPrefs.enabled}
              trackColor={{ false: colors.muted, true: colors.accent }}
              thumbColor={colors.foreground}
              accessibilityLabel="Binaural sub-layer enabled"
              testID="cognitive-audio-binaural-toggle"
            />
          </View>

          {headphonesHintVisible ? (
            <View
              testID="cognitive-audio-headphones-hint"
              style={{
                marginTop: spacing.sm,
                marginHorizontal: spacing.base,
                marginBottom: spacing.sm,
                padding: spacing.sm,
                borderRadius: radius.md,
                backgroundColor: colors.muted,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
              }}
            >
              <Ionicons name="headset-outline" size={18} color={colors.foreground} />
              <Text style={[styles.rowSubtitle, { color: colors.foreground, flex: 1 }]}>
                Headphones recommended — binaural tones don&apos;t work over the speaker.
              </Text>
              <Pressable
                onPress={dismissHeadphonesHint}
                accessibilityRole="button"
                accessibilityLabel="Dismiss headphones hint"
                testID="cognitive-audio-headphones-hint-dismiss"
                style={({ pressed }) => [
                  {
                    paddingVertical: spacing.xs,
                    paddingHorizontal: spacing.sm,
                    borderRadius: radius.sm,
                    backgroundColor: colors.primary,
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={{ color: colors.primaryForeground, ...text.bodySemibold }}>
                  Got it
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          <View style={[styles.row, !cognitiveAudioPrefs.enabled && { opacity: 0.45 }]}>
            <View style={styles.rowIcon}>
              <Ionicons name="volume-medium-outline" size={24} color={colors.foreground} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Master volume</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                {`${Math.round(cognitiveAudioPrefs.masterVolume * 100)}% — independent of device volume`}
              </Text>
              <View
                style={{ flexDirection: "row", marginTop: spacing.sm, gap: spacing.xs }}
                testID="cognitive-audio-volume-row"
              >
                {[0, 0.25, 0.5, 0.75, 1].map((step) => {
                  const active =
                    Math.abs(cognitiveAudioPrefs.masterVolume - step) < 0.01;
                  return (
                    <Pressable
                      key={step}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        void setCognitiveAudioMasterVolume(step);
                        applyLiveMasterVolume(step);
                      }}
                      disabled={!cognitiveAudioPrefs.enabled}
                      accessibilityRole="button"
                      accessibilityLabel={`Set cognitive sound volume to ${Math.round(step * 100)} percent`}
                      testID={`cognitive-audio-volume-${Math.round(step * 100)}`}
                      style={({ pressed }) => [
                        {
                          flex: 1,
                          paddingVertical: spacing.sm,
                          alignItems: "center",
                          borderRadius: radius.md,
                          borderWidth: 1,
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? colors.primary : "transparent",
                        },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text
                        style={{
                          color: active ? colors.primaryForeground : colors.mutedForeground,
                          ...text.bodySemibold,
                        }}
                      >
                        {Math.round(step * 100)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          {/*
            Per-context audit row — shows the user which contexts have
            a bundled bed and which don't yet (the asset registry
            ships empty by design, see lib/cognitiveAudio/registry.ts).
            This keeps the surface honest: a user who turns the layer
            on but only hears silence can see exactly which contexts
            haven't shipped a bed yet.
          */}
          {COGNITIVE_AUDIO_CONTEXTS.map((ctx) => {
            const label = COGNITIVE_AUDIO_LABELS[ctx];
            const bundled = hasBundledBed(ctx);
            return (
              <View
                key={ctx}
                style={[styles.row, !cognitiveAudioPrefs.enabled && { opacity: 0.45 }]}
                testID={`cognitive-audio-context-${ctx}`}
              >
                <View style={styles.rowIcon}>
                  <Ionicons
                    name={bundled ? "checkmark-circle-outline" : "ellipse-outline"}
                    size={20}
                    color={bundled ? colors.primary : colors.mutedForeground}
                  />
                </View>
                <View style={styles.rowContent}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                    {label.title}
                    <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                      {`  · ${BINAURAL_HZ[ctx]} Hz`}
                    </Text>
                  </Text>
                  <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                    {bundled ? label.subtitle : `${label.subtitle} (bed coming soon)`}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {/*
          Try-a-haptic demo (Task #231). Lets curious users tap each
          of the six MemTool signatures and feel the playback for
          themselves — turning the one-time "richer haptics" notice
          (Task #226) into a tangible "oh, that's what they mean"
          moment. Visible on every platform, but the header row tells
          the user which playback path they're getting so an Android /
          fallback user doesn't think the JS approximation IS the
          richer Core Haptics signature.
        */}
        <View
          testID="haptic-demo-card"
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="pulse-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                Try a haptic
              </Text>
              <Text
                style={[styles.rowSubtitle, { color: colors.mutedForeground }]}
                testID="haptic-demo-path-label"
              >
                {hapticPlaybackPath === "native"
                  ? "Tap to feel each signature — playing via Core Haptics."
                  : "Tap to feel each signature — playing the JS approximation."}
              </Text>
            </View>
          </View>

          {/*
            "Mute all haptics" shortcut (Task #251). Mirrors the
            master switch in the Preferences card above so users in
            a quiet space can silence everything in one tap instead
            of flipping six rows. The Switch value is the INVERSE
            of `hapticsMasterEnabled` — ON = all muted, OFF = all
            active — so the label reads naturally as a mute action.
            Tapping it calls the same `handleToggleHapticsMaster`
            that the Preferences row uses, keeping both switches in
            sync via the shared `useHapticsMasterEnabled()` hook.
          */}
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <View style={styles.row} testID="haptic-master-mute-row">
            <View style={styles.rowIcon}>
              <Ionicons
                name={hapticsMasterEnabled ? "notifications-outline" : "notifications-off-outline"}
                size={24}
                color={hapticsMasterEnabled ? colors.foreground : colors.mutedForeground}
              />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                Mute all haptics
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                {hapticsMasterEnabled
                  ? "Individual toggles below are active."
                  : "All haptics silenced — individual toggles are paused."}
              </Text>
            </View>
            <Switch
              value={!hapticsMasterEnabled}
              onValueChange={(nextMuted) => handleToggleHapticsMaster(!nextMuted)}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.foreground}
              accessibilityLabel="Mute all haptics"
              testID="haptic-master-mute-shortcut"
            />
          </View>

          {HAPTIC_NAMES.map((name) => {
            const label = HAPTIC_DEMO_LABELS[name];
            const muted = isHapticMuted(name);
            return (
              <React.Fragment key={name}>
                <View style={[styles.separator, { backgroundColor: colors.border }]} />
                {/*
                  Dim the entire row when the master mute is active
                  so users can tell at a glance why their individual
                  toggles aren't taking effect (Task #251). The
                  Pressable's play path keeps `ignoreMute: true` so
                  the demo still works even when all haptics are
                  silenced — that's the re-evaluate-before-unmuting
                  escape hatch from Task #243.
                */}
                <View
                  style={[
                    styles.row,
                    !hapticsMasterEnabled && { opacity: 0.45 },
                  ]}
                >
                  <Pressable
                    onPress={() => handlePlayHapticDemo(name)}
                    style={({ pressed }) => [
                      styles.hapticDemoTapArea,
                      pressed && { opacity: 0.7 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={
                      !hapticsMasterEnabled
                        ? `Play ${label.title} haptic (all haptics muted)`
                        : muted
                          ? `Play ${label.title} haptic (currently muted)`
                          : `Play ${label.title} haptic`
                    }
                    testID={`haptic-demo-row-${name}`}
                  >
                    <View style={styles.rowIcon}>
                      <Ionicons
                        name="play-circle-outline"
                        size={24}
                        color={muted || !hapticsMasterEnabled ? colors.mutedForeground : colors.accent}
                      />
                    </View>
                    <View style={styles.rowContent}>
                      <Text
                        style={[
                          styles.rowTitle,
                          { color: muted || !hapticsMasterEnabled ? colors.mutedForeground : colors.foreground },
                        ]}
                      >
                        {label.title}
                      </Text>
                      <Text
                        style={[styles.rowSubtitle, { color: colors.mutedForeground }]}
                      >
                        {muted ? "Muted — tap to feel it anyway." : label.subtitle}
                      </Text>
                    </View>
                  </Pressable>
                  <Switch
                    value={!muted}
                    onValueChange={(nextEnabled) =>
                      handleToggleHapticMute(name, nextEnabled)
                    }
                    trackColor={{ false: colors.muted, true: colors.accent }}
                    thumbColor={colors.foreground}
                    disabled={!hapticsMasterEnabled}
                    accessibilityLabel={`${label.title} haptic enabled`}
                    testID={`haptic-demo-toggle-${name}`}
                  />
                </View>
              </React.Fragment>
            );
          })}
        </View>

        {/*
          MEM'S VOICE picker (Task #292). Lets the user audition and
          pick from a small curated set of installed system voices.
          Tapping a concrete voice row selects it AND plays a one-line
          "Hi — I'm Mem." preview; tapping the System default row only
          saves the visual selection and never invokes default TTS.
          The selection remains saved per-user for future hand-picked
          avatar voice approval.

          Hidden when no voices have hydrated yet — the picker only
          ever shows once we know what's actually selectable, so we
          don't render an empty card on platforms without TTS.
        */}
        {curatedVoices.length > 0 ? (
          <>
            <Text
              style={[styles.sectionTitle, { color: colors.mutedForeground }]}
            >
              MEM&apos;S VOICE
            </Text>
            <View
              testID="mem-voice-card"
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons
                    name="mic-outline"
                    size={24}
                    color={colors.primary}
                  />
                </View>
                <View style={styles.rowContent}>
                  <Text
                    style={[styles.rowTitle, { color: colors.foreground }]}
                  >
                    How Mem sounds
                  </Text>
                  <Text
                    style={[
                      styles.rowSubtitle,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    Tap a voice to hear a sample and pick it. Voices
                    marked Premium are Apple&apos;s neural Siri voices —
                    free, on-device, and the warmest pick.
                  </Text>
                </View>
              </View>

              {/*
                Discoverability hint — when the device has zero
                Premium voices installed, point the user at the iOS
                download path. Apple ships these voices for free but
                they're a one-tap download buried under
                Settings → Accessibility → Spoken Content → Voices.
                We can't deep-link directly to that pane (Apple
                doesn't expose a URL scheme for it), so the row opens
                the top-level Settings app and tells the user where
                to navigate.
              */}
              {Platform.OS === "ios" &&
              !curatedVoices.some((v) => v.tier === "premium") ? (
                <>
                  <View
                    style={[
                      styles.separator,
                      { backgroundColor: colors.border },
                    ]}
                  />
                  <Pressable
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      Linking.openSettings().catch(() => {});
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && { opacity: 0.7 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Open iOS Settings to download Apple's free Premium voices for the warmest Mem voice"
                    testID="mem-voice-premium-hint"
                  >
                    <View style={styles.rowIcon}>
                      <Ionicons
                        name="sparkles-outline"
                        size={22}
                        color={colors.accent}
                      />
                    </View>
                    <View style={styles.rowContent}>
                      <Text
                        style={[styles.rowTitle, { color: colors.foreground }]}
                      >
                        Get warmer voices (free)
                      </Text>
                      <Text
                        style={[
                          styles.rowSubtitle,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        Open iOS Settings → Accessibility → Spoken
                        Content → Voices → English, then download
                        Ava or Evan (Premium).
                      </Text>
                    </View>
                    <View style={styles.rowIcon}>
                      <Ionicons
                        name="open-outline"
                        size={20}
                        color={colors.mutedForeground}
                      />
                    </View>
                  </Pressable>
                </>
              ) : null}

              {/*
                Coerce a saved-but-uninstalled voice id back to the
                "System default" pseudo-voice for the *display* state.
                Without this, a user who picked "Warm" on an iPhone
                and then opened MemTool on an Android tablet (where
                Samantha isn't installed) would see no checkmark on
                any row — the saved id matches none of the curated
                entries. Falling back to `null` highlights "System
                default" instead, which matches what Mem will
                actually speak with.
              */}
              {curatedVoices.map((voice) => {
                const isSelected = effectiveSelectedVoiceId === voice.id;
                return (
                  <React.Fragment key={voice.id ?? "__default__"}>
                    <View
                      style={[
                        styles.separator,
                        { backgroundColor: colors.border },
                      ]}
                    />
                    <Pressable
                      onPress={() => handleSelectVoice(voice)}
                      style={({ pressed }) => [
                        styles.row,
                        pressed && { opacity: 0.7 },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`${voice.label} voice${
                        isSelected ? ", selected" : ""
                      }. Tap to preview and select.`}
                      testID={`mem-voice-row-${voice.id ?? "default"}`}
                    >
                      <View style={styles.rowIcon}>
                        <Ionicons
                          name="play-circle-outline"
                          size={24}
                          color={colors.accent}
                        />
                      </View>
                      <View style={styles.rowContent}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <Text
                            style={[
                              styles.rowTitle,
                              { color: colors.foreground },
                            ]}
                          >
                            {voice.label}
                          </Text>
                          {voice.tier === "premium" ? (
                            <View
                              style={[
                                styles.badge,
                                {
                                  backgroundColor: colors.accent,
                                  marginLeft: 8,
                                },
                              ]}
                              testID={`mem-voice-premium-badge-${voice.id ?? "default"}`}
                            >
                              <Text
                                style={[
                                  styles.badgeText,
                                  { color: colors.background },
                                ]}
                              >
                                PREMIUM
                              </Text>
                            </View>
                          ) : null}
                          {voice.recommended ? (
                            <Ionicons
                              name="star"
                              size={14}
                              color={colors.primary}
                              style={{ marginLeft: 6 }}
                            />
                          ) : null}
                        </View>
                        <Text
                          style={[
                            styles.rowSubtitle,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {voice.subtitle}
                          {voice.recommended ? " · Recommended" : ""}
                        </Text>
                      </View>
                      {isSelected ? (
                        <View
                          style={styles.rowIcon}
                          testID={`mem-voice-checkmark-${
                            voice.id ?? "default"
                          }`}
                        >
                          <Ionicons
                            name="checkmark"
                            size={22}
                            color={colors.primary}
                          />
                        </View>
                      ) : null}
                    </Pressable>
                  </React.Fragment>
                );
              })}
            </View>
          </>
        ) : null}

        {/*
          NOTIFICATIONS section (Task #300). Shows the OS-level permission
          state with a toggle that fires the pre-prompt → OS dialog flow on
          first request. Below the master toggle, category rows let the user
          opt out of specific nudge types (daily recap, streak) without
          revoking the whole permission — which is the power-user flow Apple
          recommends over asking for blanket revocation.

          The whole section is hidden until the AsyncStorage reads have
          completed (notifLoaded) so we never flash "undetermined" state.
        */}
        {notifLoaded && (
          <>
            <Text
              style={[styles.sectionTitle, { color: colors.mutedForeground }]}
            >
              NOTIFICATIONS
            </Text>

            <View
              testID="notifications-card"
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons
                    name="notifications-outline"
                    size={24}
                    color={colors.primary}
                  />
                </View>
                <View style={styles.rowContent}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                    Allow notifications
                  </Text>
                  <Text
                    style={[
                      styles.rowSubtitle,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {notifPermStatus === "granted"
                      ? "Enabled"
                      : notifPermStatus === "denied"
                        ? "Blocked — tap to open Settings"
                        : "Not yet requested"}
                  </Text>
                </View>
                <Switch
                  value={notifPermStatus === "granted"}
                  onValueChange={(next) => {
                    void handleNotifPermToggle(next);
                  }}
                  trackColor={{ false: colors.muted, true: colors.primary }}
                  thumbColor={colors.foreground}
                  accessibilityLabel="Allow notifications"
                  testID="notifications-master-toggle"
                />
              </View>

              {notifPermStatus === "granted" &&
                NOTIFICATION_CATEGORIES.map((cat, idx) => {
                  const enabled = notifCategories[cat.id] ?? true;
                  const time = notifTimes[cat.id];
                  return (
                    <React.Fragment key={cat.id}>
                      <View
                        style={[
                          styles.separator,
                          { backgroundColor: colors.border },
                        ]}
                      />
                      <View style={styles.row}>
                        <View style={styles.rowIcon}>
                          <Ionicons
                            name={
                              idx === 0
                                ? "calendar-outline"
                                : "flame-outline"
                            }
                            size={24}
                            color={
                              enabled ? colors.accent : colors.mutedForeground
                            }
                          />
                        </View>
                        <View style={styles.rowContent}>
                          <Text
                            style={[
                              styles.rowTitle,
                              { color: colors.foreground },
                            ]}
                          >
                            {cat.label}
                          </Text>
                          <Text
                            style={[
                              styles.rowSubtitle,
                              { color: colors.mutedForeground },
                            ]}
                          >
                            {cat.subtitle}
                          </Text>
                        </View>
                        <Switch
                          value={enabled}
                          onValueChange={(next) => {
                            void handleToggleNotifCategory(cat.id, next);
                          }}
                          trackColor={{
                            false: colors.muted,
                            true: colors.accent,
                          }}
                          thumbColor={colors.foreground}
                          accessibilityLabel={`${cat.label} notifications enabled`}
                          testID={`notif-category-toggle-${cat.id}`}
                        />
                      </View>
                      {/*
                        Reminder time row — only rendered when the
                        category itself is enabled (i.e. there's an
                        active schedule). Tapping it opens the time
                        picker modal below; picking a time persists
                        the choice and reschedules the daily trigger.
                      */}
                      {enabled && (
                        <Pressable
                          style={({ pressed }) => [
                            styles.row,
                            {
                              opacity: pressed ? 0.7 : 1,
                              paddingLeft: 64,
                            },
                          ]}
                          onPress={() => {
                            Haptics.selectionAsync().catch(() => {});
                            setTimePickerCategory(cat.id);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Change reminder time for ${cat.label}`}
                          testID={`notif-category-time-${cat.id}`}
                        >
                          <View style={styles.rowContent}>
                            <Text
                              style={[
                                styles.rowSubtitle,
                                { color: colors.mutedForeground },
                              ]}
                            >
                              Reminder time
                            </Text>
                            <Text
                              style={[
                                styles.rowTitle,
                                { color: colors.foreground, marginTop: 2 },
                              ]}
                              testID={`notif-category-time-value-${cat.id}`}
                            >
                              {formatReminderTime(time)}
                            </Text>
                          </View>
                          <Ionicons
                            name="chevron-forward"
                            size={20}
                            color={colors.mutedForeground}
                          />
                        </Pressable>
                      )}
                    </React.Fragment>
                  );
                })}
            </View>

            {/*
              Time picker modal. Presents a scrollable list of
              30-minute slots from 06:00 → 22:30 — covers the
              practical "morning to bedtime" window users actually
              pick reminder times within without needing a native
              date/time picker dependency. Tapping a row both
              persists the choice (`setCategoryTime`) and
              reschedules the OS-level trigger if the category is
              currently enabled (`scheduleCategory`). The modal is
              rendered once at the section level so it works for
              whichever category opened it via `timePickerCategory`.
            */}
            <Modal
              visible={timePickerCategory !== null}
              transparent
              animationType="fade"
              onRequestClose={() => setTimePickerCategory(null)}
            >
              <Pressable
                style={styles.timePickerBackdrop}
                onPress={() => setTimePickerCategory(null)}
                testID="notif-time-picker-backdrop"
              >
                <Pressable
                  onPress={() => {}}
                  style={[
                    styles.timePickerSheet,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.timePickerTitle,
                      { color: colors.foreground },
                    ]}
                  >
                    Pick a reminder time
                  </Text>
                  <ScrollView style={{ maxHeight: 320 }}>
                    {(() => {
                      const slots: ReminderTime[] = [];
                      for (let h = 6; h <= 22; h++) {
                        slots.push({ hour: h, minute: 0 });
                        slots.push({ hour: h, minute: 30 });
                      }
                      const cat = timePickerCategory;
                      const current = cat ? notifTimes[cat] : null;
                      return slots.map((t) => {
                        const label = formatReminderTime(t);
                        const isSelected =
                          current !== null &&
                          current.hour === t.hour &&
                          current.minute === t.minute;
                        return (
                          <Pressable
                            key={label}
                            style={({ pressed }) => [
                              styles.timePickerRow,
                              {
                                opacity: pressed ? 0.7 : 1,
                                borderBottomColor: colors.border,
                              },
                            ]}
                            onPress={() => {
                              if (cat) void handlePickTime(cat, t);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`Set reminder time to ${label}`}
                            testID={`notif-time-option-${label}`}
                          >
                            <Text
                              style={[
                                styles.rowTitle,
                                {
                                  color: isSelected
                                    ? colors.accent
                                    : colors.foreground,
                                  fontWeight: isSelected ? "700" : "400",
                                },
                              ]}
                            >
                              {label}
                            </Text>
                            {isSelected && (
                              <Ionicons
                                name="checkmark"
                                size={20}
                                color={colors.accent}
                              />
                            )}
                          </Pressable>
                        );
                      });
                    })()}
                  </ScrollView>
                </Pressable>
              </Pressable>
            </Modal>
          </>
        )}

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>PROFILE</Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="person-circle-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>What Mem knows about you</Text>
              {profileLoading && !profile ? (
                <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                  Loading…
                </Text>
              ) : profile ? (
                <View style={{ marginTop: 6, gap: 6 }}>
                  {profile.traits.length > 0 ? (
                    <View style={styles.tagRow}>
                      {profile.traits.map((t) => (
                        <View
                          key={`t-${t}`}
                          style={[
                            styles.tag,
                            {
                              backgroundColor: colors.background,
                              borderColor: colors.primary,
                            },
                          ]}
                        >
                          <Text style={[styles.tagText, { color: colors.primary }]}>
                            {t}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                      No traits yet
                    </Text>
                  )}
                  {profile.focus_areas.length > 0 ? (
                    <View style={styles.tagRow}>
                      {profile.focus_areas.map((f) => (
                        <View
                          key={`f-${f}`}
                          style={[
                            styles.tag,
                            {
                              backgroundColor: colors.background,
                              borderColor: colors.accent,
                            },
                          ]}
                        >
                          <Text style={[styles.tagText, { color: colors.accent }]}>
                            {f}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                      No focus areas yet
                    </Text>
                  )}
                </View>
              ) : (
                <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                  No profile yet — say hi to Mem to get started.
                </Text>
              )}
            </View>
          </View>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          <Pressable
            onPress={handleRedoIntro}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Re-do my intro chat"
          >
            <View style={styles.rowIcon}>
              <Ionicons name="chatbubbles-outline" size={24} color={colors.accent} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Re-do my intro</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                Walk through the chat again
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
          </Pressable>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          <Pressable
            onPress={handleWatchIntroVideo}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Watch intro video again"
          >
            <View style={styles.rowIcon}>
              <Ionicons name="play-circle-outline" size={24} color={colors.accent} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                Watch intro again
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                Replay the OC2CO splash with Memora & Sagous
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
          </Pressable>

          {profile ? (
            <>
              <View style={[styles.separator, { backgroundColor: colors.border }]} />
              <Pressable
                onPress={handleDeleteProfile}
                disabled={isDeletingProfile}
                style={({ pressed }) => [
                  styles.row,
                  (pressed || isDeletingProfile) && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Reset Mem's memory"
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="refresh-outline" size={24} color={colors.destructive} />
                </View>
                <View style={styles.rowContent}>
                  <Text style={[styles.rowTitle, { color: colors.destructive }]}>
                    Reset Mem's memory
                  </Text>
                  <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                    Mem will start learning from scratch
                  </Text>
                </View>
                {isDeletingProfile ? (
                  <ActivityIndicator size="small" color={colors.destructive} />
                ) : null}
              </Pressable>
            </>
          ) : null}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>MEM AI</Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="sparkles-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                On-device understanding
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                {aiVectorCount} memor{aiVectorCount === 1 ? "y" : "ies"} understood · {formatAiLastBuilt(aiLastBuilt)}
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground, marginTop: 2 }]}>
                Daily AI budget: {aiCapUsed} of {EMBEDDING_DAILY_CAP} used today
              </Text>
            </View>
          </View>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          <Pressable
            onPress={handleClearAiCache}
            disabled={aiClearing}
            style={({ pressed }) => [
              styles.row,
              pressed && !aiClearing && { opacity: 0.8 },
              aiClearing && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Clear local AI cache"
          >
            <View style={styles.rowIcon}>
              <Ionicons name="trash-outline" size={24} color={colors.destructive} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                Clear local AI cache
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                {aiCleared
                  ? "Cleared. Mem will rebuild on the next refresh."
                  : "Forget on-device fingerprints. Server copy is kept."}
              </Text>
            </View>
            {aiClearing ? (
              <ActivityIndicator size="small" color={colors.destructive} />
            ) : null}
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>CLOUD SYNC</Text>

        {isPro ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/*
              Developer options toggle (Task #317). Lives at the top
              of the Cloud Sync card and gates the advanced "Cloud
              API URL" controls below — a normal Pro user never sees
              the BYO-backend field, but the team's __DEV__ default
              keeps the dev workflow untouched. Flipping the toggle
              off does NOT clear a previously saved URL.
            */}
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Ionicons
                  name="construct-outline"
                  size={24}
                  color={developerOptionsEnabled ? colors.accent : colors.mutedForeground}
                />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>Developer options</Text>
                <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                  Show advanced sync controls
                </Text>
              </View>
              <Switch
                value={developerOptionsEnabled}
                onValueChange={(next) => {
                  Haptics.selectionAsync().catch(() => {});
                  void setDeveloperOptionsEnabledPref(next);
                }}
                trackColor={{ false: colors.muted, true: colors.primary }}
                thumbColor={colors.foreground}
                accessibilityLabel="Developer options"
                testID="developer-options-toggle"
              />
            </View>

            {developerOptionsEnabled && (
              <View style={[styles.separator, { backgroundColor: colors.border }]} />
            )}

            {developerOptionsEnabled && (
              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="cloud-outline" size={24} color={colors.accent} />
                </View>
                <View style={styles.rowContent}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>Cloud API URL</Text>
                  <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {savedApiUrl ? savedApiUrl : "Not set — local only"}
                  </Text>
                </View>
              </View>
            )}

            {developerOptionsEnabled && (
              <>
                <View style={styles.urlInputRow}>
                  <TextInput
                    value={apiUrlInput}
                    onChangeText={(value) => {
                      setApiUrlInput(value);
                      if (urlError) setUrlError(null);
                    }}
                    placeholder="https://api.polsia.app"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    maxLength={API_URL_MAX_LENGTH}
                    style={[
                      styles.urlInput,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: urlError ? colors.destructive : colors.border,
                      },
                    ]}
                  />
                  <Pressable
                    onPress={handleSaveUrl}
                    style={({ pressed }) => [styles.saveUrlBtn, pressed && { opacity: 0.8 }]}
                  >
                    <LinearGradient
                      colors={["#a78bfa", "#5eead4"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.saveUrlGradient}
                    >
                      <Text style={[styles.saveUrlText, { color: colors.background }]}>{urlSaved ? "Saved" : "Save"}</Text>
                    </LinearGradient>
                  </Pressable>
                </View>

                {urlError ? (
                  <Text style={[styles.urlErrorText, { color: colors.destructive }]}>{urlError}</Text>
                ) : null}
              </>
            )}

            {developerOptionsEnabled && (
              <>
                <View style={[styles.separator, { backgroundColor: colors.border }]} />
                {/*
                  Task #371 — QA hook for verifying the Sentry pipeline
                  end-to-end before each release. Tapping this throws a
                  tagged error that the SDK captures and ships to the
                  mobile project; the event should be visible in the
                  Sentry dashboard within ~1 minute. Available in
                  production TestFlight builds (gated only on the
                  developer-options unlock) so QA can sign off on real
                  hardware. No-ops with a calm Alert when the DSN is
                  missing so the row never silently does nothing.
                */}
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    if (!isSentryEnabled()) {
                      Alert.alert(
                        "Sentry not configured",
                        "EXPO_PUBLIC_SENTRY_DSN is not set in this build, so no event will be sent.",
                      );
                      return;
                    }
                    const err = new Error(
                      `Sentry verification: MemTool test error (${new Date().toISOString()})`,
                    );
                    captureSentryError(err, { source: "settings_dev_test" });
                    Alert.alert(
                      "Sentry test error sent",
                      "Check the MemTool Sentry dashboard within ~1 minute.",
                    );
                  }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Send Sentry test error"
                  testID="settings-send-sentry-test-error"
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name="bug-outline" size={24} color={colors.destructive} />
                  </View>
                  <View style={styles.rowContent}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                      Send Sentry test error
                    </Text>
                    <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                      QA hook — verifies error reporting wiring.
                    </Text>
                  </View>
                </Pressable>
              </>
            )}

            {developerOptionsEnabled && __DEV__ && (
              <>
                <View style={[styles.separator, { backgroundColor: colors.border }]} />
                {/*
                  Task #304: dev-only launcher for the FoundationModels
                  spike + haptics debug screens. The screens themselves
                  live under `app/(app)/_dev/` (non-routable), so this
                  Modal-based launcher is the only way to reach them in
                  dev. Returns null in production builds.
                */}
                <DevToolsLauncher />
              </>
            )}

            <View style={[styles.separator, { backgroundColor: colors.border }]} />

            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Ionicons name="sync-outline" size={24} color={colors.primary} />
              </View>
              <View style={styles.rowContent}>
                <View style={styles.pendingHeader}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>Sync now</Text>
                  {pendingCount > 0 && (
                    <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.badgeText, { color: colors.background }]}>{pendingCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                  {syncResult ??
                    (pendingRefreshError
                      ? pendingCount > 0
                        ? `${pendingCount} item${pendingCount === 1 ? "" : "s"} pending · couldn't refresh`
                        : "Couldn't refresh"
                      : pendingCount > 0
                        ? `${pendingCount} item${pendingCount === 1 ? "" : "s"} pending`
                        : "All caught up")}
                </Text>
              </View>
              <Pressable
                onPress={handleSyncNow}
                disabled={isSyncing}
                style={({ pressed }) => [styles.syncBtn, { borderColor: colors.primary }, pressed && { opacity: 0.7 }, isSyncing && { opacity: 0.6 }]}
              >
                {isSyncing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.syncBtnText, { color: colors.primary }]}>Sync</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          // Free users see the upsell instead of the cloud sync
          // controls. Local capture/recap still work (memories live in
          // AsyncStorage); Pro is what unlocks the cross-device sync.
          <ProUpsellCard
            icon="cloud-done-outline"
            title="Priority cloud sync"
            body="Upgrade to MemTool Pro to back up memories to the cloud and keep them in sync across all your devices."
          />
        )}

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>LEGAL</Text>

        <Pressable
          onPress={handleOpenPrivacy}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { opacity: 0.8 },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="shield-checkmark-outline" size={24} color={colors.accent} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Privacy Policy</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>How your data is handled</Text>
            </View>
            <Ionicons name="open-outline" size={20} color={colors.mutedForeground} />
          </View>
        </Pressable>

        <Pressable
          onPress={handleOpenTerms}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { opacity: 0.8 },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="document-text-outline" size={24} color={colors.accent} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Terms of Service</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>The rules of using MemTool</Text>
            </View>
            <Ionicons name="open-outline" size={20} color={colors.mutedForeground} />
          </View>
        </Pressable>

        <Pressable
          onPress={handleOpenAbout}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { opacity: 0.8 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Watch the MemTool story"
          testID="about-row"
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="film-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Our story</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>Watch the MemTool story (3 short clips)</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
          </View>
        </Pressable>

        <Pressable
          onPress={handleOpenLicenses}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { opacity: 0.8 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Open-Source Licenses"
          testID="licenses-row"
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="code-slash-outline" size={24} color={colors.accent} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Open-Source Licenses</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>Third-party libraries we're grateful for</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
          </View>
        </Pressable>

        <Pressable
          onPress={handleNavigateSupport}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { opacity: 0.8 },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="help-circle-outline" size={24} color={colors.accent} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Support</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>FAQ and contact info</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
          </View>
        </Pressable>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ACCOUNT</Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Pressable
            onPress={handleEditProfile}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            testID="edit-profile-row"
          >
            <View style={styles.rowIcon}>
              <Ionicons name="person-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Edit profile</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                {user?.display_name ?? user?.email ?? "Display name & photo"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
          </Pressable>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          <Pressable
            onPress={isExporting ? undefined : handleExport}
            style={({ pressed }) => [styles.row, !isExporting && pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel="Export my memories"
          >
            <View style={styles.rowIcon}>
              <Ionicons name="download-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Export my memories</Text>
              {isExporting ? (
                <Text
                  style={[styles.rowSubtitle, { color: colors.mutedForeground }]}
                  accessibilityLabel={
                    isRetrying
                      ? "Retrying network…"
                      : exportProgress > 0
                        ? `Fetching… ${exportProgress} memories so far`
                        : "Preparing export…"
                  }
                  testID="export-status-subtitle"
                >
                  {isRetrying
                    ? "Retrying network…"
                    : exportProgress > 0
                      ? `Fetching… ${exportProgress} memories so far`
                      : "Preparing export…"}
                </Text>
              ) : exportError ? (
                <Text style={[styles.rowSubtitle, { color: colors.destructive }]}>{exportError}</Text>
              ) : (
                <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                  Download a copy of all your memories.
                </Text>
              )}
            </View>
            {isExporting ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
            ) : (
              <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
            )}
          </Pressable>
          {isExporting && (
            <View style={[styles.separator, { backgroundColor: colors.border }]} />
          )}
          {isExporting && (
            <Pressable
              onPress={() => {
                exportAbortRef.current?.abort();
                setIsExporting(false);
                setExportProgress(0);
                setIsRetrying(false);
                exportAbortRef.current = null;
              }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }, { justifyContent: "center" }]}
              accessibilityRole="button"
              accessibilityLabel="Cancel export"
            >
              <Text style={[styles.rowTitle, { color: colors.destructive, textAlign: "center" }]}>Cancel export</Text>
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={handleDeleteAccount}
          disabled={isDeletingAccount}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && !isDeletingAccount && { opacity: 0.8 },
            isDeletingAccount && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Delete account"
          testID="delete-account-row"
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="trash-outline" size={24} color={colors.destructive} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.destructive }]}>Delete account</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                Permanently remove all your data
              </Text>
            </View>
            {isDeletingAccount ? (
              <ActivityIndicator size="small" color={colors.destructive} />
            ) : null}
          </View>
        </Pressable>

        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { opacity: 0.8 },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="log-out-outline" size={24} color={colors.destructive} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.destructive }]}>Log Out</Text>
            </View>
          </View>
        </Pressable>

        {/*
          Version display (Task #300). Lives at the very bottom so it
          doesn't distract from functional rows but is always reachable
          for support and bug reports. Tapping 7 times opens a hidden
          developer info panel (easter egg) — a standard pattern in
          production apps for surfacing diagnostic info without shipping
          a debug screen that's reachable from navigation.
        */}
        <Pressable
          onPress={handleVersionTap}
          style={({ pressed }) => [
            styles.versionRow,
            pressed && { opacity: 0.5 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`MemTool version ${appVersion}, build ${buildNumber}`}
          testID="version-row"
          hitSlop={8}
        >
          <Text style={[styles.versionText, { color: colors.mutedForeground }]}>
            MemTool {appVersion} (build {buildNumber})
          </Text>
          {versionTapCount > 0 && versionTapCount < 7 && (
            <Text
              style={[styles.versionEasterEggHint, { color: colors.mutedForeground }]}
              testID="version-easter-egg-hint"
            >
              {7 - versionTapCount} more tap{7 - versionTapCount === 1 ? "" : "s"}
            </Text>
          )}
        </Pressable>

        {showDevPanel && (
          <View
            testID="dev-info-panel"
            style={[
              styles.devPanel,
              { backgroundColor: colors.card, borderColor: colors.primary },
            ]}
          >
            <View style={styles.devPanelHeader}>
              <Ionicons name="bug-outline" size={20} color={colors.primary} />
              <Text style={[styles.devPanelTitle, { color: colors.primary }]}>
                Developer Info
              </Text>
              <Pressable
                onPress={() => setShowDevPanel(false)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close developer panel"
              >
                <Ionicons name="close" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={[styles.devPanelRow, { color: colors.foreground }]}>
              Version: {appVersion}
            </Text>
            <Text style={[styles.devPanelRow, { color: colors.foreground }]}>
              Build: {buildNumber}
            </Text>
            <Text style={[styles.devPanelRow, { color: colors.foreground }]}>
              User: {user?.email ?? "—"}
            </Text>
            <Text style={[styles.devPanelRow, { color: colors.foreground }]}>
              Platform: {Platform.OS} {Platform.Version}
            </Text>
            <Text style={[styles.devPanelRow, { color: colors.foreground }]}>
              Expo SDK: {Constants.expoConfig?.sdkVersion ?? "—"}
            </Text>
          </View>
        )}
      </Animated.ScrollView>

      <View
        style={[styles.header, { paddingTop: insets.top + 16 }]}
        onLayout={onHeaderLayout}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <FrostBackground scrollY={scrollY} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    // Overlay the ScrollView so settings sections scroll *behind* the
    // frosted glass (Task #96, mirrors Archive). The list reserves
    // matching top padding via the measured `headerHeight` so the
    // profile section isn't initially obscured. `overflow: hidden`
    // clips the absolute-fill BlurView so the frost never bleeds past
    // the header bounds on Android (where overflow defaults to
    // "visible").
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: "hidden",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.base,
  },
  title: { ...text.screenTitle },
  scrollContent: { paddingHorizontal: spacing.lg },
  profileSection: { alignItems: "center", marginBottom: spacing.xl },
  avatarGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.base,
  },
  avatarText: {
    ...text.screenTitle,
  },
  email: { ...text.cardLabel },
  sectionTitle: {
    ...text.captionStrong,
    letterSpacing: 1,
    marginBottom: spacing.sm,
    marginLeft: spacing.base,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  // Subtler bottom margin than the section cards so the hint sits
  // visually between the profile and the MEMBERSHIP heading without
  // creating a third "section" of its own.
  coreHapticsHintCard: {
    marginBottom: spacing.base,
  },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.base },
  rowIcon: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.base,
  },
  rowContent: { flex: 1 },
  // The "Try a haptic" rows put a Pressable (icon + label) next to a
  // Switch inside the same row container. The Pressable needs to
  // own the whole left side so the play target is generously sized,
  // but it must NOT push the Switch off-row, hence the explicit
  // flex:1 + flexDirection:row mirroring `row` minus its own
  // padding (the parent row already pads).
  hapticDemoTapArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginRight: spacing.sm,
  },
  rowTitle: {
    ...text.bodyMedium,
    marginBottom: 2,
  },
  rowSubtitle: { ...text.caption },
  separator: { height: 1, marginLeft: 64 },
  urlInputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
    gap: spacing.sm,
  },
  urlInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    ...text.helperRegular,
  },
  saveUrlBtn: { borderRadius: 10, overflow: "hidden" },
  saveUrlGradient: {
    paddingHorizontal: spacing.base,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  saveUrlText: {
    ...text.helper,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  urlErrorText: {
    ...text.helperRegular,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  pendingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 2,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    ...text.captionStrong,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  syncBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 36,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  syncBtnText: {
    ...text.helper,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
  },
  tagText: {
    ...text.caption,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  versionRow: {
    alignItems: "center",
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
  },
  versionText: {
    ...text.caption,
    textAlign: "center",
  },
  versionEasterEggHint: {
    ...text.tiny,
    textAlign: "center",
    marginTop: 4,
    opacity: 0.6,
  },
  devPanel: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: spacing.lg,
    padding: spacing.base,
  },
  devPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.base,
  },
  devPanelTitle: {
    ...text.helper,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    flex: 1,
  },
  devPanelRow: {
    ...text.caption,
    marginBottom: 4,
    fontFamily: "Inter_400Regular",
  },
  timePickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  timePickerSheet: {
    width: "100%",
    maxWidth: 360,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
    paddingVertical: spacing.base,
  },
  timePickerTitle: {
    ...text.cardLabel,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  timePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
