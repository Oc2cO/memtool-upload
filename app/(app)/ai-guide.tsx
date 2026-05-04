import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  Easing,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolateColor,
} from "react-native-reanimated";

import { BrandHero } from "@/components/BrandHero";
import { ChatThread, FreeTextInput, type ChatMessage } from "@/components/ChatThread";
import { MemCharacter, type MemExpression } from "@/components/MemCharacter";
import { FrostBackground } from "@/components/alive/FrostBackground";
import { ProUpsellCard } from "@/components/ProUpsellCard";
import { useAuth } from "@/context/AuthContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { AuthError } from "@/lib/auth";
import {
  AiGuideError,
  AI_GUIDE_NETWORK_ERROR_MESSAGE,
  AI_GUIDE_UNAVAILABLE_MESSAGE,
  normalizeMood,
  sendAiGuideMessage,
  type MemMood,
} from "@/lib/aiGuide";
import {
  aiGuideStreakOpener,
  aiGuideStreakOpenerKey,
  fetchStreak,
} from "@/lib/streak";
import { getLocalDayKey } from "@/lib/captureLimits";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  bumpAiGuideCounter,
  getAiGuideLimitState,
  loadAiGuideCounter,
} from "@/lib/aiGuideLimits";
import {
  clearAiGuideThread,
  loadAiGuideThread,
  saveAiGuideThread,
  type StoredAiGuideMessage,
} from "@/lib/aiGuideThread";
import { useHaptics } from "@/lib/haptics";
import {
  ensureMemCaptionsEnabledHydrated,
  ensureMemVoiceMuteHydrated,
  hasMemIntroBeenSpoken,
  hasMemSkipHintBeenSeen,
  markMemIntroSpoken,
  markMemSkipHintSeen,
  setMemVoiceMuted,
  useMemCaptionsEnabled,
  useMemVoiceId,
  useMemVoiceMuted,
} from "@/lib/memVoicePrefs";
import { useEffectiveMemVoiceId } from "@/lib/memVoiceCatalog";
import { useMemSpeech } from "@/lib/useMemSpeech";

/**
 * The "Mem" chat surface. Wires the user-facing chat thread into the
 * Polsia /ai-guide/chat endpoint via lib/aiGuide.ts.
 *
 * Architectural notes:
 * - The screen owns thread state in React; AsyncStorage is the
 *   persistence layer (lib/aiGuideThread.ts) keyed by user id so an
 *   account swap never shows the wrong history.
 * - All API decisions live in lib/aiGuide.ts: error mapping, mood
 *   normalization, response shape validation. The screen only
 *   handles UI side effects (haptics, scroll, keyboard, persistence).
 * - The "Mem is thinking…" indicator and the user bubble both render
 *   instantly off the local thread before the server responds, so
 *   the UI feels snappy even on slow networks.
 * - The mood tint is applied as a subtle ambient ring at the top of
 *   the screen, animating between mood colors with a low-opacity
 *   gradient. Spec says "subtle, not loud" — opacity stays under
 *   0.18 even at peak.
 * - Pro-gating: free users see a calm ProUpsellCard in place of the
 *   input once they hit the daily cap. Sending against the cap is
 *   guarded by both UI state and a re-check inside the send handler
 *   so a stale render can't rack up server cost.
 * - Crisis detection is server-authoritative (per task brief). The
 *   screen never inspects message content for safety routing —
 *   whatever the server returns is rendered verbatim.
 *
 * Talking-Mem stage (Task #283):
 * - A dedicated Mem stage lives at the top of the screen, just under
 *   the frosted header. It hosts the larger Mem character whose
 *   mouth is driven by `useMemSpeech`'s `mouthOpen` shared value
 *   and whose `expression` follows the latest reply's `mood`.
 * - The in-bubble Mem avatar is hidden on this screen (`showAvatars
 *   = false` to ChatThread) — Mem lives in the stage instead.
 * - Replies stream word-by-word: the bubble appears empty, then
 *   `useMemSpeech` advances a per-message visible-word cursor in
 *   sync with the spoken voice. Tapping the stage stops speech and
 *   snaps the bubble to the full text.
 * - A header mute toggle (next to "Clear") persists per-user; when
 *   muted the streaming reveal continues at a faster fixed rate so
 *   silence doesn't slow the experience.
 * - The intro greeting speaks exactly once per user on first
 *   launch, gated by a one-shot AsyncStorage flag.
 */

// Per-user dedupe key for the streak opener message (Task #369).
// Stores the last `aiGuideStreakOpenerKey` we've already shown so a
// returning user with chat history sees the milestone or at-risk
// acknowledgment exactly once per state transition rather than on
// every screen mount. Implicitly invalidates when the underlying
// streak state changes (a new milestone crosses, the local day
// rolls over for the at-risk variant) because the key itself
// changes.
const STREAK_OPENER_LAST_KEY_PREFIX = "mem_streak_opener_last_v1:";
function streakOpenerStorageKey(userId: string): string {
  return `${STREAK_OPENER_LAST_KEY_PREFIX}${userId}`;
}

const PALETTE = {
  bg: "#0a0612",
  bgDeep: "#050309",
  mem: "#FFD56F",
  hot: "#B47AFF",
  cool: "#6FE5FF",
  pink: "#FF8FB1",
  text: "#F4EEFF",
  textMuted: "#9B91B5",
  card: "rgba(180, 122, 255, 0.10)",
  border: "rgba(180, 122, 255, 0.25)",
};

/**
 * Subtle ambient color per mood. Picked from the brand palette so the
 * tint never feels foreign. "neutral" intentionally returns the same
 * color as bgDeep so the ambient strip fades to invisible.
 */
const MOOD_COLOR: Record<MemMood, string> = {
  calm: "#6FE5FF",
  happy: "#FFD56F",
  sad: "#9DB1D5",
  anxious: "#C49BFF",
  neutral: PALETTE.bgDeep,
};

const INTRO_MESSAGE: StoredAiGuideMessage = {
  id: "intro",
  role: "mem",
  text:
    "Hi — I'm Mem. Tell me how today's going. There's no right way to talk " +
    "about it; I'm here to listen.",
  accentMood: "calm",
};

// Height of the dedicated Mem stage at the top of the AI chat
// (Task #283). Sized to comfortably hold a 120 px Mem character +
// the one-time "Tap Mem to skip" hint underneath without crowding
// the first chat bubble.
const MEM_STAGE_HEIGHT = 168;
const MEM_STAGE_CHAR_SIZE = 120;
const SKIP_HINT_TIMEOUT_MS = 4000;
// How many words on each side of the currently-spoken word to show
// in the caption strip (Task #293). Keeps the strip narrow enough
// to fit one line on small phones while still giving the user a
// little context around the focal word — single-word captions
// felt jumpy in early review.
const CAPTION_WINDOW = 2;

function newMsgId(prefix: "u" | "m"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function toChatMessages(
  thread: readonly StoredAiGuideMessage[],
  streamingMessageId: string | null,
  visibleWordCount: number,
): ChatMessage[] {
  return thread.map(({ id, role, text }) => {
    if (id === streamingMessageId) {
      return { id, role, text, visibleWordCount };
    }
    return { id, role, text };
  });
}

function latestMemMood(thread: readonly StoredAiGuideMessage[]): MemMood {
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const m = thread[i];
    if (m.role === "mem" && m.accentMood) {
      return normalizeMood(m.accentMood);
    }
  }
  return "calm";
}

function moodToExpression(mood: MemMood): MemExpression {
  // Mem's expression vocabulary is a strict superset of MemMood;
  // these names line up 1:1 except for "neutral" which we map to
  // "calm" so the resting face never looks blank.
  switch (mood) {
    case "calm":
      return "calm";
    case "happy":
      return "happy";
    case "sad":
      return "sad";
    case "anxious":
      return "anxious";
    case "neutral":
    default:
      return "calm";
  }
}

export default function AiGuideScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { status: subscriptionStatus } = useSubscription();
  const isPro = subscriptionStatus?.is_pro === true;
  const haptics = useHaptics();
  const userId = user?.id ?? user?.email ?? "";
  const muted = useMemVoiceMuted(userId);
  // "Mem captions" accessibility opt-in (Task #293). When on, a thin
  // strip below the Mem stage mirrors the spoken word so users on
  // silent mode (or with Reduce Motion freezing the mouth) still
  // get a clear "Mem is talking *now*" signal. Default OFF — the
  // bubble streaming is the always-on signal; this is for users who
  // need a stronger cue.
  const captionsEnabled = useMemCaptionsEnabled(userId);
  // User-picked voice (Task #292). The saved id is funneled through
  // `useEffectiveMemVoiceId` which checks the curated catalog on
  // the *current* device and collapses unknown ids to `null`
  // (system default) — so a "Warm" pick made on iOS doesn't try to
  // speak with an iOS-only voice id when the user opens MemTool on
  // an Android tablet. Until the catalog hydrates the hook returns
  // `null` (system default) rather than the raw saved id, so Mem
  // never speaks with an id we haven't verified is installed here.
  const savedVoiceId = useMemVoiceId(userId);
  const selectedVoiceId = useEffectiveMemVoiceId(savedVoiceId);

  const [thread, setThread] = useState<StoredAiGuideMessage[]>([INTRO_MESSAGE]);
  const [hydrated, setHydrated] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  const [sentToday, setSentToday] = useState(0);
  // Consecutive 5xx-from-Polsia counter (Task #397). Tracks how many
  // back-to-back upstream-outage replies we've seen so the inline
  // "Try again in a moment" copy can be swapped for the dedicated
  // "Mem is temporarily unavailable" banner once the gateway is
  // clearly down (not a one-off blip). Reset to zero on any
  // successful chat round-trip.
  const [outageStrikes, setOutageStrikes] = useState(0);
  const isBackendUnavailable = outageStrikes >= 2;
  // Streaming reveal state — `streamingId` is the message id whose
  // bubble is currently animating in word-by-word; `visibleWords`
  // is the number of words from the front of that message's text
  // that should currently be visible.
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [visibleWords, setVisibleWords] = useState(0);
  // One-shot "Tap Mem to skip" hint — exactly once per user across
  // the install lifetime, persisted in AsyncStorage. The local
  // `showSkipHint` is render-state for the current session; the
  // `skipHintAvailable` ref is the post-hydration "is this user
  // still allowed to see it?" gate. Hides on first tap, on
  // interrupt, or after SKIP_HINT_TIMEOUT_MS.
  const [showSkipHint, setShowSkipHint] = useState(false);
  const skipHintAvailableRef = useRef(false);
  const skipHintShownThisSessionRef = useRef(false);
  // Timer that auto-dismisses the skip hint after SKIP_HINT_TIMEOUT_MS.
  // Tracked in a ref so a superseding speech run, an interrupt, or
  // an unmount can clear it — otherwise a stale `setShowSkipHint(false)`
  // could fire on an unmounted screen, triggering React's "state update
  // on unmounted component" warning and (in jest) a leak detection.
  const skipHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSkipHintTimer = useCallback(() => {
    if (skipHintTimerRef.current !== null) {
      clearTimeout(skipHintTimerRef.current);
      skipHintTimerRef.current = null;
    }
  }, []);

  // Guard against double-submits during the in-flight POST.
  const sendingRef = useRef(false);

  const speech = useMemSpeech({ muted, voice: selectedVoiceId });

  // The current "speak target" — the message whose text we are
  // streaming. We hold a ref so the speech callbacks can resolve
  // their target without closing over stale state.
  const streamingIdRef = useRef<string | null>(null);
  useEffect(() => {
    streamingIdRef.current = streamingId;
  }, [streamingId]);

  // Hydrate the persisted thread + today's counter once we know the user id.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setHydrated(true);
      return;
    }
    void (async () => {
      const [
        persistedThread,
        counter,
        ,
        skipHintAlreadySeen,
        ,
        // Streak (Task #369). Fetched in the same hydration round-trip
        // so the intro greeting can be prefixed with a streak-aware
        // opener BEFORE the speak-intro effect picks it up — otherwise
        // we'd race the 50ms speak timer and Mem would speak the
        // unprefixed intro on cold start. Cold-start safe: a fallback
        // (no token / network error) returns a zeroed snapshot for
        // which `aiGuideStreakOpener` returns null, so the intro just
        // reads as before.
        streakResp,
      ] = await Promise.all([
        loadAiGuideThread(userId),
        loadAiGuideCounter(),
        ensureMemVoiceMuteHydrated(userId),
        hasMemSkipHintBeenSeen(userId),
        // Captions hydrate alongside mute so the strip's first paint
        // already reflects the user's persisted choice instead of
        // briefly defaulting to off and then snapping on.
        ensureMemCaptionsEnabledHydrated(userId),
        fetchStreak(),
      ]);
      if (cancelled) return;
      // Compute the streak opener and its dedupe key once off the
      // freshly-fetched snapshot. Two delivery paths:
      //   - Brand-new (or cleared) thread → bake the opener into
      //     the intro greeting so Mem speaks it as one breath with
      //     the welcome.
      //   - Returning user with persisted history → append the
      //     opener as a fresh transient mem bubble at the bottom
      //     of the thread, dedupe-gated so it only re-shows when
      //     the underlying streak state changes (new milestone
      //     crosses, local day rolls over for the at-risk variant).
      const opener = aiGuideStreakOpener(
        streakResp.streak,
        streakResp.config,
        getLocalDayKey(),
        new Date().getHours(),
      );
      const openerKey = aiGuideStreakOpenerKey(
        streakResp.streak,
        streakResp.config,
        getLocalDayKey(),
        new Date().getHours(),
      );
      if (persistedThread.length > 0) {
        // Read the last-shown key to dedupe across re-mounts. A
        // null/missing value just means "never shown" so the first
        // qualifying opener after install will still land.
        const lastShown = await AsyncStorage.getItem(
          streakOpenerStorageKey(userId),
        ).catch(() => null);
        if (cancelled) return;
        if (opener && openerKey && openerKey !== lastShown) {
          const accentMood: MemMood = openerKey.startsWith("m:")
            ? "happy"
            : "calm";
          const memMsg: StoredAiGuideMessage = {
            id: newMsgId("m"),
            role: "mem",
            text: opener,
            accentMood,
          };
          setThread([...persistedThread, memMsg]);
          // Persist immediately so a back-to-back mount (e.g. tab
          // bounce) doesn't double-inject before the next state
          // transition. Best-effort: a write failure just means the
          // user might see the same opener once more — acceptable.
          void AsyncStorage.setItem(
            streakOpenerStorageKey(userId),
            openerKey,
          );
        } else {
          setThread(persistedThread);
        }
      } else {
        const intro: StoredAiGuideMessage = opener
          ? { ...INTRO_MESSAGE, text: `${opener} ${INTRO_MESSAGE.text}` }
          : INTRO_MESSAGE;
        setThread([intro]);
        // Persist the opener key in the brand-new path too, so
        // when the user opens the screen again later (now with a
        // persisted thread) we don't immediately re-append the
        // same opener as a separate bubble.
        if (openerKey) {
          void AsyncStorage.setItem(
            streakOpenerStorageKey(userId),
            openerKey,
          );
        }
      }
      setSentToday(counter.count);
      // Gate the per-install "Tap Mem to skip" hint: only available
      // if the user has never seen it before. Stored in AsyncStorage
      // so a relaunch doesn't reset the gate.
      skipHintAvailableRef.current = !skipHintAlreadySeen;
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Persist thread on every change (best-effort).
  useEffect(() => {
    if (!hydrated) return;
    if (!userId) return;
    void saveAiGuideThread(userId, thread);
  }, [thread, hydrated, userId]);

  const limitState = getAiGuideLimitState(sentToday, isPro);

  const moodForAmbient = useMemo(() => latestMemMood(thread), [thread]);
  const stageExpression = moodToExpression(moodForAmbient);

  // Reduce Motion gate for the caption strip (Task #293). When the
  // OS reports Reduce Motion, the strip skips its on-word-change
  // fade so the only visual change is the word swap itself. We
  // mirror the pattern used inside `useMemSpeech` rather than
  // introducing a shared hook for a single screen — and keep the
  // listener live so a mid-session toggle in iOS settings is
  // honored without a remount.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduceMotion(v);
      })
      .catch(() => {
        if (mounted) setReduceMotion(false);
      });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v) => {
        if (mounted) setReduceMotion(Boolean(v));
      },
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // Derive the caption window from the message currently being
  // streamed and the per-word visibility cursor `useMemSpeech`
  // already drives. The strip renders a small window centered on
  // the current word so the user can see what just landed and what
  // is about to land — single-word captions feel jumpy, full-line
  // captions look like a transcript and lose the "this is the word
  // *now*" beat. CAPTION_WINDOW words on each side keeps the strip
  // narrow enough to fit one line on the smallest supported screen.
  const captionWindow = useMemo(() => {
    if (!captionsEnabled) return null;
    if (!streamingId) return null;
    if (visibleWords <= 0) return null;
    const msg = thread.find((m) => m.id === streamingId);
    if (!msg) return null;
    const words = msg.text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return null;
    // `visibleWords` can hit Number.MAX_SAFE_INTEGER as a sentinel
    // when the bubble is snapped to full text on interrupt/done —
    // clamp before subtracting so we don't render a phantom "last
    // word" after streaming has ended.
    const clamped = Math.min(words.length, visibleWords);
    const cur = clamped - 1;
    if (cur < 0) return null;
    const start = Math.max(0, cur - CAPTION_WINDOW);
    const end = Math.min(words.length, cur + CAPTION_WINDOW + 1);
    return {
      before: words.slice(start, cur),
      current: words[cur] ?? "",
      after: words.slice(cur + 1, end),
      cur,
    };
  }, [captionsEnabled, streamingId, visibleWords, thread]);

  // Subtle fade on word-change. Stays at full opacity in Reduce
  // Motion. We deliberately animate the whole strip rather than
  // just the highlighted word so context words don't jitter while
  // the focal word transitions — single-element animation is
  // cheaper and reads as one atomic update.
  const captionOpacity = useSharedValue(1);
  useEffect(() => {
    if (!captionWindow) return;
    if (reduceMotion) {
      captionOpacity.value = 1;
      return;
    }
    captionOpacity.value = 0.55;
    captionOpacity.value = withTiming(1, {
      duration: 160,
      easing: Easing.out(Easing.quad),
    });
  }, [captionWindow?.cur, reduceMotion, captionOpacity, captionWindow]);
  const captionAnimStyle = useAnimatedStyle(() => ({
    opacity: captionOpacity.value,
  }));

  const ambientProgress = useSharedValue(0);
  useEffect(() => {
    // Convert the mood enum into a stable integer for interpolation.
    const order: MemMood[] = ["neutral", "calm", "happy", "sad", "anxious"];
    const next = Math.max(0, order.indexOf(moodForAmbient));
    ambientProgress.value = withTiming(next, {
      duration: 600,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [moodForAmbient, ambientProgress]);

  // Drives the frosted-glass intensity on the sticky AI Guide header
  // (Task #96). Updated off the JS thread via `useAnimatedScrollHandler`
  // and consumed by `<FrostBackground>` so the BlurView ramp stays
  // smooth even while the chat thread is fast-scrolling.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  // Header is absolutely positioned over the chat so messages can
  // scroll *behind* the frosted glass (matches Archive). We measure
  // the live header height so ChatThread can reserve matching top
  // padding — otherwise the first bubble would render under the frost.
  const [headerHeight, setHeaderHeight] = useState(0);
  const onHeaderLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    setHeaderHeight((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  };

  const ambientStyle = useAnimatedStyle(() => {
    const order: MemMood[] = ["neutral", "calm", "happy", "sad", "anxious"];
    const colors = order.map((m) => MOOD_COLOR[m]);
    const bg = interpolateColor(
      ambientProgress.value,
      order.map((_, i) => i),
      colors,
    );
    // Keep the tint very subtle so it never overpowers the chat.
    return { backgroundColor: bg, opacity: 0.18 };
  });

  /**
   * Kick off the talking + streaming reveal for a Mem message that
   * is already in the thread. Caller is responsible for inserting
   * the message first; we never mutate `thread` here so the
   * "show the bubble immediately, then fill it" ordering is up to
   * the caller.
   */
  const startSpeakingMessage = useCallback(
    (
      messageId: string,
      text: string,
      callbacks?: { onSpeechStart?: () => void },
    ) => {
      // Per-install one-shot "Tap Mem to skip" training hint.
      // Three gates must all be true to show it:
      //   1. Hydration finished and the user has not previously seen it
      //      (skipHintAvailableRef, sourced from AsyncStorage).
      //   2. We haven't already shown it once this session (the
      //      AsyncStorage write is async, so without this guard a
      //      back-to-back send could double-show before the write
      //      lands).
      //   3. We have a non-empty userId so the persistence write
      //      can target a real key.
      if (
        skipHintAvailableRef.current &&
        !skipHintShownThisSessionRef.current &&
        userId
      ) {
        skipHintShownThisSessionRef.current = true;
        skipHintAvailableRef.current = false;
        setShowSkipHint(true);
        // Persist immediately so a relaunch never re-shows it.
        void markMemSkipHintSeen(userId);
        // Clear any previous auto-dismiss timer (a back-to-back
        // speak before the prior one finished its 4s window) so
        // the hint never gets multiple racing dismiss timers, then
        // arm a fresh one. The ref is also cleared on unmount and
        // on `interruptSpeech` so the timer can never fire after
        // the screen is gone.
        clearSkipHintTimer();
        skipHintTimerRef.current = setTimeout(() => {
          skipHintTimerRef.current = null;
          setShowSkipHint(false);
        }, SKIP_HINT_TIMEOUT_MS);
      }
      setStreamingId(messageId);
      setVisibleWords(0);
      // Track whether speech has actually started emitting words.
      // Used by the intro path to defer the "intro spoken" persistence
      // until we've seen real progress — if expo-speech throws
      // synchronously or never emits any boundary, the intro flag
      // stays unset so the user gets another chance on next mount.
      let started = false;
      speech.speak(text, {
        onWordIndex: (count) => {
          if (streamingIdRef.current !== messageId) return;
          if (!started && count > 0) {
            started = true;
            callbacks?.onSpeechStart?.();
          }
          setVisibleWords(count);
        },
        onDone: () => {
          if (streamingIdRef.current === messageId) {
            // Snap to full text + clear streaming state.
            setVisibleWords(Number.MAX_SAFE_INTEGER);
            setStreamingId(null);
          }
        },
      });
    },
    [speech, userId, clearSkipHintTimer],
  );

  /** Interrupt any in-flight speech and snap the bubble open. */
  const interruptSpeech = useCallback(() => {
    if (streamingIdRef.current) {
      setVisibleWords(Number.MAX_SAFE_INTEGER);
      setStreamingId(null);
    }
    speech.stop();
    // Clear the auto-dismiss timer alongside the visible state so a
    // late timer callback can't undo a manual re-show on the very
    // next speak().
    clearSkipHintTimer();
    setShowSkipHint(false);
  }, [speech, clearSkipHintTimer]);

  // Final cleanup: cancel the skip-hint auto-dismiss timer on
  // unmount so an in-flight 4s window can't fire `setShowSkipHint`
  // on an unmounted component.
  useEffect(() => {
    return () => {
      clearSkipHintTimer();
    };
  }, [clearSkipHintTimer]);

  // Stop Mem speaking immediately when the user navigates away from
  // /ai-guide — tab switch, back nav, deep link to another screen
  // (Task #294). The hook's own unmount cleanup handles teardown if
  // the screen unmounts, but expo-router keeps screens mounted on
  // tab switches, so without this blur hook Mem would keep talking
  // off-screen on iOS. Fires only on blur (the cleanup of the
  // focus-effect callback), and never auto-restarts on re-focus —
  // the user has moved on and the bubble is already snapped to full
  // text via `interruptSpeech`'s `stop()` path.
  useFocusEffect(
    useCallback(() => {
      return () => {
        interruptSpeech();
      };
    }, [interruptSpeech]),
  );

  // First-launch one-shot intro greeting. Speaks the locally-rendered
  // intro bubble exactly once per user, then sets a persistent flag
  // so subsequent screen mounts don't re-speak it.
  const introHandledRef = useRef(false);
  // Tracks "is the screen still mounted?" so the deferred
  // intro-speak setTimeout can no-op cleanly if the screen
  // unmounted between the AsyncStorage round-trip and the timer
  // firing. Without this, jest teardowns flag the timer as a leak.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!hydrated || !userId) return;
    if (introHandledRef.current) return;
    introHandledRef.current = true;
    // The intro is only spoken when the very first message in the
    // thread *is* the intro (i.e. brand-new thread). If the user
    // already has prior messages the intro bubble isn't even on
    // screen.
    if (thread[0]?.id !== INTRO_MESSAGE.id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      const already = await hasMemIntroBeenSpoken(userId);
      if (already || !mountedRef.current) return;
      // Defer one tick so the freshly-mounted ChatThread has a
      // chance to lay out the bubble before the words start
      // streaming into it.
      timer = setTimeout(() => {
        if (!mountedRef.current) return;
        // Persist the "intro spoken" flag *after* speech actually
        // begins emitting words — not before. If `Speech.speak`
        // throws synchronously or the device never emits any
        // boundary at all, the flag stays unset so the user gets
        // another chance to hear the intro on the next mount,
        // matching the brief's "exactly once per user" guarantee
        // (per actually-experienced once, not attempted-once).
        startSpeakingMessage(INTRO_MESSAGE.id, INTRO_MESSAGE.text, {
          onSpeechStart: () => {
            void markMemIntroSpoken(userId);
          },
        });
      }, 50);
    })();
    return () => {
      if (timer) clearTimeout(timer);
    };
    // We deliberately ignore further changes — the intro is a one-shot
    // and `thread` may grow after the first send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, userId]);

  const sendMessage = useCallback(
    async (text: string, options: { isRetry?: boolean } = {}) => {
      if (sendingRef.current) return;
      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      // Re-check the cap inside the send handler — UI state can lag
      // behind a multi-tab race or a stale subscription read. Pro
      // bypass is enforced inside getAiGuideLimitState.
      const live = getAiGuideLimitState(sentToday, isPro);
      if (live.atLimit) return;

      // A fresh send interrupts any in-flight Mem speech immediately
      // so the previous reply doesn't keep streaming behind the new one.
      interruptSpeech();

      sendingRef.current = true;
      setSending(true);
      setErrorMessage(null);
      setLastUserMessage(trimmed);

      // Only append a fresh user bubble for new sends. On retry the
      // previous user bubble is still in the thread (we don't strip
      // it on error), so re-appending would duplicate it.
      if (!options.isRetry) {
        const userMsg: StoredAiGuideMessage = {
          id: newMsgId("u"),
          role: "user",
          text: trimmed,
        };
        setThread((prev) => [...prev, userMsg]);
      }
      void Haptics.selectionAsync().catch(() => {});

      try {
        const reply = await sendAiGuideMessage(trimmed);
        const memId = newMsgId("m");
        const memMsg: StoredAiGuideMessage = {
          id: memId,
          role: "mem",
          text: reply.response,
          accentMood: reply.mood,
        };
        setThread((prev) => [...prev, memMsg]);
        // Successful round-trip → clear any sustained-outage banner
        // (Task #397). One success is enough; a launch-day outage
        // recovers as soon as a single chat lands.
        setOutageStrikes(0);
        const next = await bumpAiGuideCounter();
        setSentToday(next.count);
        // Mem's reply just landed — use the "day-recap-ready" verb,
        // the existing arrival-cue chime, instead of the system
        // success buzz.
        haptics.play("day-recap-ready");
        // Kick off the talking-Mem reveal now that the bubble has
        // been inserted. The streaming state owner sets visibleWords
        // to 0 first so the bubble flashes empty (per task brief),
        // then the speech callbacks fill it word by word.
        startSpeakingMessage(memId, reply.response);
      } catch (err) {
        if (err instanceof AuthError && err.status === 401) {
          // Re-auth required — the auth layer already cleared the
          // token from storage; route to /login.
          router.replace("/login");
          return;
        }
        // Track consecutive Polsia 5xx strikes (Task #397). A
        // single blip still surfaces the calm "Try again in a
        // moment" copy; two in a row means the gateway is actually
        // down and the screen swaps to the dedicated unavailable
        // banner via `isBackendUnavailable`. Non-outage errors
        // (4xx / network blips) reset the counter so a one-off
        // local glitch can't push us past the threshold.
        if (err instanceof AiGuideError && err.isServerOutage) {
          setOutageStrikes((n) => n + 1);
        } else {
          setOutageStrikes(0);
        }
        const friendly =
          err instanceof AiGuideError
            ? err.userMessage
            : AI_GUIDE_NETWORK_ERROR_MESSAGE;
        setErrorMessage(friendly);
        haptics.play("error");
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [isPro, sentToday, router, haptics, startSpeakingMessage, interruptSpeech],
  );

  const handleRetry = useCallback(() => {
    if (!lastUserMessage) return;
    setErrorMessage(null);
    void sendMessage(lastUserMessage, { isRetry: true });
  }, [lastUserMessage, sendMessage]);

  const handleClearConversation = useCallback(() => {
    interruptSpeech();
    setThread([INTRO_MESSAGE]);
    setErrorMessage(null);
    setLastUserMessage(null);
    if (userId) {
      void clearAiGuideThread(userId);
    }
    void Haptics.selectionAsync().catch(() => {});
  }, [userId, interruptSpeech]);

  const handleToggleMute = useCallback(() => {
    if (!userId) return;
    const next = !muted;
    // Stop in-flight speech immediately so toggling mid-sentence
    // doesn't leave audio playing while the icon shows muted.
    interruptSpeech();
    void setMemVoiceMuted(userId, next);
    void Haptics.selectionAsync().catch(() => {});
  }, [userId, muted, interruptSpeech]);

  const messages = useMemo(
    () => toChatMessages(thread, streamingId, visibleWords),
    [thread, streamingId, visibleWords],
  );

  // Empty-state Memora hero (Task #313). Shows the warm `mem-hero-chat`
  // photo + a one-line greeting when the user hasn't sent anything
  // yet — the intro Mem bubble is the verbal welcome, this is the
  // visual one. Fades out the instant the first user message lands so
  // it never crowds an active conversation, and lives behind the
  // talking-Mem stage (lower zIndex, pointer-transparent) so it never
  // interferes with the in-flight reply playback.
  const hasUserMessages = useMemo(
    () => thread.some((m) => m.role === "user"),
    [thread],
  );
  const showEmptyHero = hydrated && !hasUserMessages;
  const heroOpacity = useSharedValue(showEmptyHero ? 1 : 0);
  useEffect(() => {
    heroOpacity.value = withTiming(showEmptyHero ? 1 : 0, {
      duration: 260,
      easing: Easing.out(Easing.quad),
    });
  }, [showEmptyHero, heroOpacity]);
  const heroAnimStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
  }));

  const inputNode = useMemo<React.ReactNode>(() => {
    if (limitState.atLimit) {
      return (
        <View style={styles.upsellWrap}>
          <ProUpsellCard
            icon="sparkles"
            title="You've used today's free messages with Mem"
            body={`Upgrade to Pro for unlimited Mem chats. Free chats reset tomorrow.`}
            ctaLabel="Upgrade to Pro"
          />
        </View>
      );
    }
    // Sustained Polsia outage (Task #397): show a calm,
    // informational banner ABOVE the regular composer so the user
    // can still attempt a send — that successful round-trip is
    // exactly what clears the banner (resets `outageStrikes` to 0).
    // We also suppress the redundant pink errorBar in this state so
    // the user sees the friendlier copy, not the inline retry one.
    if (isBackendUnavailable) {
      return (
        <View>
          <View
            style={[styles.unavailableBar, styles.unavailableBarSpacing]}
            accessibilityRole="alert"
            accessibilityLabel={AI_GUIDE_UNAVAILABLE_MESSAGE}
            testID="mem-unavailable-banner"
          >
            <Feather name="cloud-off" size={16} color={PALETTE.cool} />
            <Text style={styles.unavailableText} numberOfLines={2}>
              {AI_GUIDE_UNAVAILABLE_MESSAGE}
            </Text>
          </View>
          <FreeTextInput
            placeholder="Tell Mem what's on your mind…"
            skippable={false}
            disabled={sending}
            onSubmit={(value) => {
              void sendMessage(value);
            }}
            palette={PALETTE}
          />
        </View>
      );
    }
    if (errorMessage) {
      return (
        <View style={styles.errorBar}>
          <Feather name="alert-triangle" size={16} color={PALETTE.pink} />
          <Text style={styles.errorText} numberOfLines={2}>
            {errorMessage}
          </Text>
          <Pressable
            onPress={handleRetry}
            disabled={!lastUserMessage || sending}
            hitSlop={10}
            style={styles.errorRetry}
            accessibilityRole="button"
            accessibilityLabel="Try sending the last message again"
          >
            <Text style={styles.errorRetryText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View>
        <FreeTextInput
          placeholder="Tell Mem what's on your mind…"
          skippable={false}
          disabled={sending}
          onSubmit={(value) => {
            void sendMessage(value);
          }}
          palette={PALETTE}
        />
        {!isPro ? (
          <Text style={styles.capHint}>
            {limitState.remainingToday === 0
              ? "No free Mem chats left today"
              : `${limitState.remainingToday} free Mem chat${
                  limitState.remainingToday === 1 ? "" : "s"
                } left today`}
          </Text>
        ) : null}
      </View>
    );
  }, [
    limitState.atLimit,
    limitState.remainingToday,
    errorMessage,
    isBackendUnavailable,
    handleRetry,
    isPro,
    lastUserMessage,
    sending,
    sendMessage,
  ]);

  return (
    <View style={[styles.container, { backgroundColor: PALETTE.bg }]}>
      <Animated.View
        pointerEvents="none"
        style={[styles.ambient, { top: 0, height: insets.top + 140 }, ambientStyle]}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 8 : 0}
      >
        <ChatThread
          messages={messages}
          showTyping={sending}
          input={inputNode}
          palette={PALETTE}
          showAvatars={false}
          onScroll={scrollHandler}
          contentTopInset={headerHeight + MEM_STAGE_HEIGHT}
          scrollY={scrollY}
          speech={speech}
        />
      </KeyboardAvoidingView>

      {/* Empty-state hero (Task #313) — warm Memora photo + one-line
          greeting that anchors a brand-new chat before the user has
          said anything. Pointer-transparent and rendered with a
          lower zIndex than the talking-Mem stage so the stage tap +
          caption strip always win, and it never blocks chat scroll. */}
      {showEmptyHero ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.emptyHero,
            {
              top: headerHeight + MEM_STAGE_HEIGHT + 8,
              paddingHorizontal: 32,
            },
            heroAnimStyle,
          ]}
          accessibilityLabel="Memora is here whenever you're ready"
        >
          <BrandHero variant="memora-hero-chat" size={180} decorative />
          <Text style={styles.emptyHeroText}>
            I'm here whenever you're ready, Sunshine.
          </Text>
        </Animated.View>
      ) : null}

      {/* Mem stage — sits below the frosted header, above the thread.
          Tapping it interrupts in-flight speech (per task brief). */}
      <View
        pointerEvents="box-none"
        style={[
          styles.stage,
          {
            top: headerHeight,
            height: MEM_STAGE_HEIGHT,
          },
        ]}
      >
        <Pressable
          onPress={interruptSpeech}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Tap Mem to skip the current voice"
          style={styles.stageTap}
        >
          <MemCharacter
            size={MEM_STAGE_CHAR_SIZE}
            expression={stageExpression}
            mouthOpen={speech.mouthOpen}
            viseme={speech.viseme}
            color={PALETTE.mem}
          />
          {showSkipHint ? (
            <Text style={styles.skipHint} accessibilityLiveRegion="polite">
              Tap Mem to skip
            </Text>
          ) : null}
        </Pressable>
      </View>

      {/* Caption strip (Task #293). Sits just below the Mem stage,
          mirrors the currently-spoken word with a soft highlight so
          users on silent (or with Reduce Motion freezing the mouth)
          still get a clear "Mem is talking now" cue. Opt-in via the
          Settings "Mem captions" toggle, default off. */}
      {captionWindow ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.captionStrip,
            { top: headerHeight + MEM_STAGE_HEIGHT - 4 },
            captionAnimStyle,
          ]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Mem is saying: ${captionWindow.current}`}
          testID="mem-caption-strip"
        >
          <Text
            style={styles.captionLine}
            numberOfLines={1}
            ellipsizeMode="clip"
          >
            {captionWindow.before.length > 0 ? (
              <Text style={styles.captionContext}>
                {captionWindow.before.join(" ")}{" "}
              </Text>
            ) : null}
            <Text style={styles.captionCurrent} testID="mem-caption-current">
              {captionWindow.current}
            </Text>
            {captionWindow.after.length > 0 ? (
              <Text style={styles.captionContext}>
                {" "}
                {captionWindow.after.join(" ")}
              </Text>
            ) : null}
          </Text>
        </Animated.View>
      ) : null}

      <View
        style={[styles.header, { paddingTop: insets.top + 12 }]}
        onLayout={onHeaderLayout}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <FrostBackground scrollY={scrollY} />
        </View>
        <View style={styles.headerLeft}>
          <Ionicons name="sparkles" size={18} color={PALETTE.mem} />
          <Text style={styles.headerTitle}>Mem</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleToggleMute}
            hitSlop={12}
            style={styles.headerIconBtn}
            accessibilityRole="button"
            accessibilityLabel={muted ? "Unmute Mem's voice" : "Mute Mem's voice"}
            accessibilityState={{ selected: muted }}
          >
            <Feather
              name={muted ? "volume-x" : "volume-2"}
              size={18}
              color={muted ? PALETTE.textMuted : PALETTE.text}
            />
          </Pressable>
          <Pressable
            onPress={handleClearConversation}
            hitSlop={12}
            style={styles.clearBtn}
            accessibilityRole="button"
            accessibilityLabel="Clear conversation with Mem"
          >
            <Text style={styles.clearBtnText}>Clear</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  ambient: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  header: {
    // Overlay the chat thread so messages scroll *behind* the
    // frosted glass (Task #96, mirrors Archive). ChatThread is told
    // about the measured height via `contentTopInset` so the first
    // bubble isn't initially obscured. `overflow: hidden` clips the
    // absolute-fill BlurView so the frost never bleeds past the
    // header bounds on Android (where overflow defaults to "visible").
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: PALETTE.text,
  },
  headerIconBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  clearBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: PALETTE.textMuted,
  },
  stage: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 5,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 8,
  },
  stageTap: {
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 6,
  },
  skipHint: {
    color: PALETTE.textMuted,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  // Caption strip (Task #293). Sits absolutely below the Mem stage,
  // pointer-transparent so taps still land on the chat. The
  // negative top offset (-4) tucks it visually against the bottom
  // of the stage without claiming a new band of vertical space.
  captionStrip: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 6,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  captionLine: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  captionContext: {
    color: PALETTE.textMuted,
    fontFamily: "Inter_400Regular",
  },
  captionCurrent: {
    color: PALETTE.text,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
  },
  emptyHero: {
    position: "absolute",
    left: 0,
    right: 0,
    // Sit behind the talking-Mem stage (zIndex 5) and the caption
    // strip (zIndex 6) so neither is ever obscured. The hero is
    // purely decorative and pointer-transparent.
    zIndex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 14,
  },
  emptyHeroText: {
    color: PALETTE.text,
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    opacity: 0.9,
  },
  upsellWrap: {
    paddingTop: 4,
  },
  errorBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255, 143, 177, 0.10)",
    borderColor: "rgba(255, 143, 177, 0.35)",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorText: {
    flex: 1,
    color: PALETTE.text,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 19,
  },
  errorRetry: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PALETTE.border,
    backgroundColor: PALETTE.card,
  },
  errorRetryText: {
    color: PALETTE.text,
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  // Sustained-outage banner (Task #397). Cool tint instead of the
  // pink alert wash so it reads as informational rather than
  // accusatory — the user hasn't done anything wrong, the upstream
  // is down. No retry button: the user can't unblock this.
  unavailableBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(111, 229, 255, 0.10)",
    borderColor: "rgba(111, 229, 255, 0.35)",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  unavailableText: {
    flex: 1,
    color: PALETTE.text,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 19,
  },
  unavailableBarSpacing: {
    marginBottom: 10,
  },
  capHint: {
    marginTop: 6,
    color: PALETTE.textMuted,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    textAlign: "center",
  },
});
