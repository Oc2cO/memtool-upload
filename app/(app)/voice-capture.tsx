/**
 * "Speak a memory" voice capture screen (Task #171).
 *
 * Flow:
 *   1. idle              — big mic button, "Hold to record" hint
 *   2. recording         — timer + waveform-style pulse, auto-stops at MAX_DURATION_S
 *                          Live captions (Task #265) appear under the mic when the
 *                          streaming STT provider is registered, giving the user
 *                          rolling feedback ("…had coffee with Alex this…") so they
 *                          can re-record sooner if it mishears.
 *   3. processing        — in-app "Processing memory…" banner +
 *                          an iOS Live Activity / Dynamic Island
 *                          (Task #200) so the user gets the same
 *                          feedback when they put the phone down or
 *                          switch apps mid-walk. The activity
 *                          deep-links back here ("memtool:///voice-
 *                          capture") so a tap on the lock screen
 *                          jumps straight to the draft when it's
 *                          ready. The native module
 *                          `modules/voice-processing-live-activity`
 *                          is the Swift bridge; on platforms /
 *                          builds without it, the in-app banner is
 *                          the only visible surface and everything
 *                          here gracefully no-ops.
 *   4. drafting          — editable form populated by the structured
 *                          extractor (title, body, tags, people, tone)
 *   5. saving / saved    — confirms via the same `addMemory` pipeline
 *                          capture.tsx uses, then routes back
 *
 * Free-tier daily-cap handling mirrors `capture.tsx` exactly: same
 * `getCaptureLimitState` math, same `ProUpsellCard` when atLimit,
 * same `CaptureLimitReachedError` / `CaptureBlockedError` branches
 * on the catch. The brief is explicit that the result must NEVER be
 * auto-saved without user confirmation — `phase === "drafting"`
 * holds the form open until the user taps Save.
 *
 * Recording uses `expo-audio` (already in the project for game
 * SFX). Speech-to-text and the on-device LLM go through
 * `lib/voiceCapture.ts` so the WhisperKit + Foundation Models
 * native modules can plug in via setter without touching this
 * file.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";

import { useHaptic } from "@/lib/haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useMemories } from "@/context/MemoriesContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { clearDraft, loadDraft, saveDraft } from "@/lib/captureDraftStore";
import { Toast } from "@/components/Toast";
import { ProUpsellCard } from "@/components/ProUpsellCard";
import {
  CaptureBlockedError,
  CaptureLimitReachedError,
} from "@/lib/subscription";
import { getCaptureLimitState } from "@/lib/captureLimits";
import {
  EMOTIONAL_TONES,
  VOICE_SUGGESTED_TAGS_POOL,
  type EmotionalTone,
  type StructuredMemoryDraft,
  type VoiceSuggestedTag,
} from "@/lib/voiceMemoryPipeline";
import {
  extractFromTranscript,
  getSpeechToTextEngineName,
  getSpeechToTextUnavailableReason,
  isFoundationModelsAvailable,
  isSpeechToTextAvailable,
  isStreamingTranscriptionAvailable,
  startStreamingTranscription,
  transcribeRecording,
  type STTUnavailableReason,
  type SpeechToTextStreamSession,
} from "@/lib/voiceCapture";
import {
  endProcessingActivity,
  type LiveActivityHandle,
  markProcessingActivityReady,
  startProcessingActivity,
} from "@/lib/voiceProcessingLiveActivity";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

/** Hard cap for a single ramble. The brief calls for ~60s; we honor
 *  it exactly so the user can't accidentally hold the button for
 *  five minutes and then wait for an enormous transcript to come
 *  back. The recording auto-stops at this boundary. */
const MAX_DURATION_S = 60;

/** Visual tick rate for the timer. 250ms is fast enough that the
 *  countdown feels live without thrashing the JS thread. */
const TIMER_TICK_MS = 250;

/**
 * Duration (ms) of the fade-in animation played each time new
 * partial caption text arrives. Short enough that rapid updates
 * feel smooth; long enough that the transition is visible.
 */
const CAPTION_FADE_MS = 180;

type Phase = "idle" | "recording" | "processing" | "drafting" | "saving";

const TONE_LABEL: Record<EmotionalTone, string> = {
  excited: "Excited",
  happy: "Happy",
  anxious: "Anxious",
  frustrated: "Frustrated",
  sad: "Sad",
  calm: "Calm",
  neutral: "Neutral",
};

const TONE_ICON: Record<EmotionalTone, keyof typeof Ionicons.glyphMap> = {
  excited: "flash-outline",
  happy: "happy-outline",
  anxious: "alert-circle-outline",
  frustrated: "thunderstorm-outline",
  sad: "sad-outline",
  calm: "leaf-outline",
  neutral: "ellipse-outline",
};

function formatTimer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

/**
 * Maps each typed unavailability reason to a calm, one-line explanation
 * the user sees in the idle-screen card and in any Alert triggered when
 * they press the mic button before the issue is resolved.
 */
function sttUnavailableMessage(reason: STTUnavailableReason | null): string {
  switch (reason) {
    case "authorization_denied":
      return "Speech recognition permission was denied. Enable it in Settings to use Speak a memory.";
    case "on_device_unsupported":
      return "On-device speech recognition isn't supported for your device's current language.";
    case "ios_too_old":
      return "Speak a memory requires iOS 13 or later.";
    case "framework_not_present":
      return "Apple's Speech framework isn't available on this device.";
    case "module_not_linked":
      return "Voice transcription isn't available in this build. It ships in the production release.";
    case "non_ios_platform":
      return "Voice transcription is only available on iPhone and iPad.";
    case "recognizer_unavailable":
      return "Speech recognition is temporarily unavailable. Try again in a moment.";
    case "unknown":
    default:
      return "Voice transcription isn't available on this device.";
  }
}

export default function VoiceCaptureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { addMemory, todayMemories } = useMemories();
  const { status: subscriptionStatus, freeDailyCaptureLimit } =
    useSubscription();
  // Voice-save shares typed capture's `capture` signature so the two
  // surfaces feel identical.
  const captureHaptic = useHaptic("capture");

  // Same Layer-2 cap math as capture.tsx — voice memories count
  // against the daily limit too, otherwise voice would be a
  // trivial cap-bypass surface.
  //
  // `freeDailyCaptureLimit` (Task #144 / #185) is the live server cap
  // so the "X of Y left" banner and the upsell body reflect on-call's
  // current value during a promotion instead of the compiled-in 10.
  const { isPro, remainingToday, atLimit: limitReached, limit } =
    getCaptureLimitState(
      todayMemories.length,
      subscriptionStatus?.is_pro === true,
      freeDailyCaptureLimit,
    );

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedS, setElapsedS] = useState(0);
  const [draft, setDraft] = useState<StructuredMemoryDraft | null>(null);
  // Editable copies of the draft fields. Kept separate so the user's
  // edits aren't blown away if some background recompute re-runs.
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editTags, setEditTags] = useState<VoiceSuggestedTag[]>([]);
  const [editTone, setEditTone] = useState<EmotionalTone>("neutral");
  const [showToast, setShowToast] = useState(false);
  const [toastSynced, setToastSynced] = useState(true);

  // Live caption state (Task #265). `partialCaption` holds the
  // latest partial result from the streaming recognizer. We keep it
  // in state (not a ref) so the caption renders reactively. The
  // animated value drives a fade-in each time new text arrives,
  // giving the rolling text a subtle pulse that communicates "still
  // listening" without distracting from the record button.
  const [partialCaption, setPartialCaption] = useState("");
  const captionOpacity = useRef(new Animated.Value(1)).current;
  // Active streaming session. Stored in a ref (not state) because
  // nothing in the render output depends on it — mutations must
  // never trigger re-renders. Null outside of the recording phase.
  const streamingSessionRef = useRef<SpeechToTextStreamSession | null>(null);
  // Monotonically-incrementing counter that identifies the current
  // recording attempt. When `startStreamingTranscription` resolves
  // (it's non-blocking), we compare the resolved recording ID against
  // the current counter. If they differ, the user already released
  // the button before the session was ready — we stop the session
  // immediately rather than leaking a live tap/recognizer.
  const recordingIdRef = useRef(0);

  // Draft persistence (Task #323). Mirrors the typed Capture and
  // Log-a-Call screens (Task #319) so a force-kill / iOS bundle
  // eviction in the editable-draft step doesn't lose a transcribed
  // ramble. We only persist while `phase === "drafting"` (or a brief
  // hand-off to "saving") — there's nothing to restore from
  // recording / processing because no editable text exists yet.
  //
  // The hydration effect runs on mount (and again on user change).
  // If a draft is found we synthesize a `StructuredMemoryDraft` shell
  // and jump straight to the drafting phase so the form renders. The
  // synthesized draft has `isEmpty: false` and `people: []`; the
  // people chips are display-only, so dropping them is fine, and the
  // empty-hint copy is suppressed because the user already had a
  // real draft on screen last session.
  //
  // `draftClosedRef` is the post-clear write suppressor: once any
  // path has fired a clear (save success, discard, cap upsell,
  // cooldown block, re-record) we flip it so a debounce timer that
  // was already armed at the moment of clear cannot revive the
  // draft on its next tick.
  const [draftHydrated, setDraftHydrated] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftClosedRef = useRef(false);

  const cancelPendingDraftWrite = useCallback(() => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
  }, []);

  const closeDraft = useCallback(() => {
    cancelPendingDraftWrite();
    draftClosedRef.current = true;
    void clearDraft("voice-capture", userId);
  }, [cancelPendingDraftWrite, userId]);

  const sttAvailable = isSpeechToTextAvailable();
  const sttEngineName = getSpeechToTextEngineName();
  const sttUnavailableReason = getSpeechToTextUnavailableReason();
  const fmAvailable = isFoundationModelsAvailable();
  const streamingAvailable = isStreamingTranscriptionAvailable();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  // Poll-based timer driving the on-screen countdown. We can't rely
  // on `recorderState.durationMillis` alone because that updates
  // less frequently and we want the timer to feel responsive.
  const recordStartedAtRef = useRef<number | null>(null);

  // Handle for the in-flight iOS Live Activity (Task #200). Null
  // when no activity has been started, when the native module isn't
  // linked, or after the activity has been ended. Stored in a ref
  // (not state) because nothing in the render output depends on it
  // — flipping it should never trigger a re-render. The unmount
  // effect below dismisses any leftover activity defensively so an
  // activity can never outlive its session.
  const liveActivityHandleRef = useRef<LiveActivityHandle>(null);
  useEffect(() => {
    return () => {
      const handle = liveActivityHandleRef.current;
      if (handle != null) {
        liveActivityHandleRef.current = null;
        // Fire-and-forget — the screen is already gone, there's no
        // user-facing recovery path.
        void endProcessingActivity(handle);
      }
    };
  }, []);

  // Unmount safety: if a streaming session is still active when the
  // screen unmounts (e.g. user force-closes the app), stop it so the
  // AVAudioEngine tap doesn't leak.
  useEffect(() => {
    return () => {
      const session = streamingSessionRef.current;
      if (session != null) {
        streamingSessionRef.current = null;
        void session.stop();
      }
    };
  }, []);

  // Hydration: load any persisted voice-capture draft for this user
  // and jump straight to the editable form. Reset the close flag for
  // the new mount / new user so a debounced write isn't suppressed
  // forever. If no draft exists for the new user, leave the screen
  // in its default idle state — account-switch can't surface another
  // user's title/body because keys are per-user.
  useEffect(() => {
    let cancelled = false;
    draftClosedRef.current = false;
    setDraftHydrated(false);
    if (!userId) {
      setDraftHydrated(true);
      return;
    }
    void loadDraft("voice-capture", userId).then((stored) => {
      if (cancelled) return;
      if (stored) {
        const tone: EmotionalTone = (EMOTIONAL_TONES as readonly string[]).includes(
          stored.tone,
        )
          ? (stored.tone as EmotionalTone)
          : "neutral";
        const tags = stored.tags.filter((t): t is VoiceSuggestedTag =>
          (VOICE_SUGGESTED_TAGS_POOL as readonly string[]).includes(t),
        );
        setEditTitle(stored.title);
        setEditBody(stored.content);
        setEditTags(tags);
        setEditTone(tone);
        setDraft({
          title: stored.title,
          body: stored.content,
          tags,
          people: [],
          tone,
          isEmpty: false,
        });
        setPhase("drafting");
      } else {
        // Account-switch isolation: if the new user has no draft,
        // wipe whatever the previous user had on screen so prior
        // transcript / title / tags / tone can't leak across accounts
        // on a hot swap (no remount). Also reset the phase machine
        // back to idle so we don't leave a stale "drafting" form
        // populated from the previous account up.
        setEditTitle("");
        setEditBody("");
        setEditTags([]);
        setEditTone("neutral");
        setDraft(null);
        setPhase("idle");
      }
      setDraftHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Debounced write: ~0.8s after the last edit the current state
  // lands in AsyncStorage. Same window as the typed Capture screen
  // so a fast typist only writes once at the end of a burst. We
  // only persist when the user is actually editing a draft — the
  // recording / processing / saving phases have nothing worth
  // restoring, and the saving phase is the brief window between
  // tapping Save and the cloud round-trip clearing the draft.
  useEffect(() => {
    if (!draftHydrated || !userId) return;
    if (phase !== "drafting") return;
    if (draftClosedRef.current) return;
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      if (draftClosedRef.current) return;
      void saveDraft("voice-capture", userId, {
        content: editBody,
        person: "",
        title: editTitle,
        tone: editTone,
        tags: editTags,
      });
    }, 800);
    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [editBody, editTitle, editTags, editTone, userId, draftHydrated, phase]);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => {
      const startedAt = recordStartedAtRef.current;
      if (startedAt == null) return;
      const elapsed = (Date.now() - startedAt) / 1000;
      setElapsedS(elapsed);
      // Hard auto-stop at the 60s ceiling — the brief is explicit
      // about the upper bound. Triggers the same path as a manual
      // release.
      if (elapsed >= MAX_DURATION_S) {
        void stopAndProcess();
      }
    }, TIMER_TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /**
   * Fade-in animation triggered whenever the partial caption text
   * changes. We animate from 0.4 → 1.0 so the update is visible
   * without being jarring. The animation is fire-and-forget — if
   * another update arrives mid-animation the new animation simply
   * takes over from wherever opacity is at that point.
   */
  useEffect(() => {
    if (!partialCaption) return;
    captionOpacity.setValue(0.4);
    Animated.timing(captionOpacity, {
      toValue: 1,
      duration: CAPTION_FADE_MS,
      useNativeDriver: true,
    }).start();
  }, [partialCaption, captionOpacity]);

  /** Press-in handler for the hold-to-record button. */
  const startRecording = useCallback(async () => {
    if (limitReached || phase !== "idle") return;
    if (!sttAvailable) {
      // Show a specific explanation for why STT is unavailable.
      // For permission-denied, offer a one-tap deep link to Settings
      // so the user can fix the only blocker that is actually in their
      // hands to resolve.
      const message = sttUnavailableMessage(sttUnavailableReason);
      if (sttUnavailableReason === "authorization_denied") {
        Alert.alert("Speech recognition permission denied", message, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Settings",
            onPress: () => void Linking.openSettings(),
          },
        ]);
      } else {
        Alert.alert("Voice transcription unavailable", message, [
          { text: "OK", style: "cancel" },
        ]);
      }
      return;
    }
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Microphone permission needed",
          "Enable microphone access in Settings to use Speak a memory.",
        );
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordStartedAtRef.current = Date.now();
      setElapsedS(0);
      setPartialCaption("");
      setPhase("recording");

      // Start the streaming recognizer concurrently with the file
      // recorder if a streaming provider is registered (Task #265).
      // We don't await the session start here — the recording UI is
      // already visible and the caption simply stays blank until the
      // first partial arrives.
      //
      // Race guard: take a snapshot of the recording ID before the
      // async start. If the user releases the button before the
      // promise resolves, `stopAndProcess` increments `recordingIdRef`
      // (via its own snapshot taken at recording start). When the
      // promise resolves we compare IDs — if they differ the session
      // is stale and we stop it immediately rather than leaking a
      // live mic tap.
      if (streamingAvailable) {
        const thisRecordingId = ++recordingIdRef.current;
        void startStreamingTranscription({
          onPartial: (text: string) => {
            setPartialCaption(text);
          },
        }).then((session) => {
          if (recordingIdRef.current !== thisRecordingId) {
            // Recording was stopped/aborted before the session was
            // ready — clean up immediately to release the mic tap.
            session?.stop();
            return;
          }
          streamingSessionRef.current = session;
        });
      }

      // Press-in tap acknowledgement, not a verb moment. The
      // `capture` verb fires on save below.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      console.warn("[voice-capture] start failed", err);
      Alert.alert(
        "Couldn't start recording",
        "Something interrupted the microphone. Try again in a moment.",
      );
      setPhase("idle");
    }
  }, [
    limitReached,
    phase,
    sttAvailable,
    sttUnavailableReason,
    streamingAvailable,
    recorder,
    router,
  ]);

  /** Press-out handler. Also called by the 60s auto-stop. Idempotent
   *  so a fast double-trigger doesn't double-process. */
  const stopAndProcess = useCallback(async () => {
    if (phase !== "recording") return;
    // Advance the recording ID so any in-flight `startStreamingTranscription`
    // promise that resolves after this point sees a mismatched ID and
    // immediately stops its (now stale) session rather than storing it.
    ++recordingIdRef.current;
    setPhase("processing");
    // Release acknowledgement only — no saved memory yet to celebrate.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Start the iOS Live Activity before we begin the long-running
    // transcription / extraction work so the lock-screen pill goes
    // up the moment the user releases the button. We `await` (not
    // fire-and-forget) so the handle is known before the next
    // `markProcessingActivityReady` call — otherwise a very fast
    // heuristic extraction could race past `start` and leave a
    // dangling activity. The call is a quick local Swift hop and
    // never throws (the wrapper swallows every failure path).
    liveActivityHandleRef.current = await startProcessingActivity();

    // Stop the streaming recognizer (if active) to get the final
    // transcript. We do this before stopping the file recorder so
    // the recognizer can still pick up the last word the user speaks
    // before releasing the button. The file recorder stop happens
    // right after so its audio is still saved for any future replay.
    let streamingTranscript: string | null = null;
    const session = streamingSessionRef.current;
    if (session != null) {
      streamingSessionRef.current = null;
      streamingTranscript = await session.stop();
    }
    // Clear the live caption once processing starts — the processing
    // banner takes over the UI feedback role.
    setPartialCaption("");

    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch (err) {
      console.warn("[voice-capture] stop failed", err);
    }
    const streamingTranscriptUsable =
      streamingTranscript != null && streamingTranscript.trim().length > 0;
    if (!uri && !streamingTranscriptUsable) {
      Alert.alert(
        "Recording lost",
        "We couldn't save the audio file. Try recording again.",
      );
      // The recording is gone — there's nothing to advertise
      // anymore. End any activity that did manage to start.
      const handle = liveActivityHandleRef.current;
      liveActivityHandleRef.current = null;
      void endProcessingActivity(handle);
      setPhase("idle");
      return;
    }
    try {
      // Prefer the streaming final transcript when available
      // (higher confidence, already on-device). Fall back to the
      // file-based provider when streaming wasn't active or returned
      // null (e.g. the user didn't speak during recording).
      let transcript: string;
      if (streamingTranscriptUsable) {
        transcript = streamingTranscript!;
      } else if (uri) {
        transcript = await transcribeRecording(uri);
      } else {
        transcript = "";
      }
      const result = await extractFromTranscript(transcript);
      setDraft(result);
      setEditTitle(result.title);
      setEditBody(result.body);
      setEditTags(result.tags);
      setEditTone(result.tone);
      // Flip the activity (if any) to "Memory ready — tap to
      // review". The activity stays on screen until the user
      // saves / discards / re-records — see those handlers.
      void markProcessingActivityReady(liveActivityHandleRef.current);
      if (result.isEmpty) {
        // Surface the empty-transcript case as a calm in-form hint
        // (the form still renders) rather than throwing the user
        // back to the start. They can record again from the same
        // screen via the Re-record button.
        setPhase("drafting");
        return;
      }
      setPhase("drafting");
    } catch (err) {
      console.warn("[voice-capture] transcribe / extract failed", err);
      Alert.alert(
        "Couldn't process that recording",
        err instanceof Error
          ? err.message
          : "Something went wrong while processing your voice memory.",
      );
      // Failure path: end the activity so the user isn't left
      // with a stale "Processing memory…" pill.
      const handle = liveActivityHandleRef.current;
      liveActivityHandleRef.current = null;
      void endProcessingActivity(handle);
      setPhase("idle");
    }
  }, [phase, recorder]);

  const toggleTag = (tag: VoiceSuggestedTag) => {
    setEditTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleReRecord = () => {
    // Re-recording starts a fresh session — drop the old activity
    // (the next `stopAndProcess` will spin up a new one).
    const handle = liveActivityHandleRef.current;
    liveActivityHandleRef.current = null;
    void endProcessingActivity(handle);
    // Stop any lingering streaming session defensively.
    const session = streamingSessionRef.current;
    if (session != null) {
      streamingSessionRef.current = null;
      void session.stop();
    }
    // Re-record throws away the in-progress draft — clear it so the
    // next force-kill can't restore the old transcript on top of a
    // fresh recording.
    closeDraft();
    setDraft(null);
    setEditTitle("");
    setEditBody("");
    setEditTags([]);
    setEditTone("neutral");
    setElapsedS(0);
    setPartialCaption("");
    setPhase("idle");
    // Re-arm the post-clear gate now that the user is back at idle
    // and may eventually produce a new draft to persist.
    draftClosedRef.current = false;
  };

  const handleDiscard = () => {
    Alert.alert(
      "Discard this memory?",
      "Your draft won't be saved.",
      [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            // The user is throwing the draft away — dismiss the
            // Live Activity now so they don't see a stale
            // "Memory ready" pill on the lock screen, and clear the
            // persisted draft so the next session starts fresh.
            const handle = liveActivityHandleRef.current;
            liveActivityHandleRef.current = null;
            void endProcessingActivity(handle);
            closeDraft();
            router.back();
          },
        },
      ],
    );
  };

  // Android hardware-back handling. Without this the system back
  // gesture pops the modal silently, which:
  //   - drops a draft mid-edit without the same "Discard?" prompt the
  //     close button shows, and
  //   - leaves the recorder running if the user backs out mid-record
  //     (the audio session would hold the mic until GC).
  // We intercept the back press for the two phases that own state:
  //   - recording  → stop the recorder, return to idle, swallow back
  //   - drafting   → trigger the discard confirmation, swallow back
  // The other phases (idle, processing, saving) fall through to the
  // default Stack pop. iOS doesn't fire BackHandler events, so this
  // is a no-op there and doesn't interfere with the swipe-to-dismiss
  // modal gesture.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (phase === "recording") {
        // Advance ID so any in-flight streaming session start sees a
        // mismatched ID and cleans itself up without storing into the ref.
        ++recordingIdRef.current;
        void recorder.stop().catch(() => {});
        recordStartedAtRef.current = null;
        setElapsedS(0);
        setPartialCaption("");
        const session = streamingSessionRef.current;
        if (session != null) {
          streamingSessionRef.current = null;
          void session.stop();
        }
        setPhase("idle");
        return true;
      }
      if (phase === "drafting") {
        handleDiscard();
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleSave = async () => {
    const body = editBody.trim();
    if (!body || limitReached || phase === "saving") return;
    // Build the saved content. If the user edited the title to
    // something different from the body's first sentence, we prefix
    // it so the title isn't lost. Otherwise the body alone is
    // enough — the existing memory model has no separate title
    // field, so prefixing with "Title — " is the cleanest way to
    // preserve the headline without a server schema change.
    let content = body;
    const trimmedTitle = editTitle.trim();
    if (
      trimmedTitle &&
      !body.toLowerCase().startsWith(trimmedTitle.toLowerCase())
    ) {
      content = `${trimmedTitle}\n\n${body}`;
    }
    setPhase("saving");
    captureHaptic.play();
    let syncedToCloud = true;
    try {
      const result = await addMemory(content, { tags: editTags });
      syncedToCloud = result.syncedToCloud;
    } catch (err) {
      // Same catch ladder as capture.tsx: route the cap-bypass and
      // server-block branches; let anything else bubble up. Either
      // way the draft is still on screen, so the Live Activity
      // (if any) should stay up — the user might retry — except
      // for the cap-bypass branch which navigates away.
      if (err instanceof CaptureLimitReachedError) {
        // Navigating to /subscription means the draft is gone.
        // Dismiss the activity so the lock screen doesn't keep
        // promising a memory the user can't actually save, and
        // drop the persisted draft so the next visit starts clean
        // (mirrors the typed Capture / Log-a-Call cap-block path).
        const handle = liveActivityHandleRef.current;
        liveActivityHandleRef.current = null;
        void endProcessingActivity(handle);
        closeDraft();
        router.replace("/subscription");
        return;
      }
      if (err instanceof CaptureBlockedError) {
        // Per Task #319: cooldown block also clears the draft so it
        // doesn't reappear on the next visit. The in-memory text
        // stays on screen for the current session.
        closeDraft();
        Alert.alert(
          "Capture temporarily unavailable",
          "We've paused new memories from your account for the rest of the day after detecting unusual activity. This will lift automatically tomorrow.",
        );
        setPhase("drafting");
        return;
      }
      setPhase("drafting");
      throw err;
    }
    // Save succeeded — the memory is committed. Drop the persisted
    // draft now (before the toast countdown) so a force-kill during
    // the 1.5s confirmation window can't restore the just-saved
    // text as a phantom draft on next launch. Then dismiss the
    // Live Activity in lockstep with the in-app toast.
    closeDraft();
    const handle = liveActivityHandleRef.current;
    liveActivityHandleRef.current = null;
    void endProcessingActivity(handle);
    setToastSynced(syncedToCloud);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
      router.back();
    }, 1500);
  };

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  const remainingS = Math.max(0, MAX_DURATION_S - elapsedS);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 16,
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={() => {
            // Mirror the Android hardware-back ladder so the close
            // button can never be the surface that leaves the audio
            // session running. Drafting → discard alert; recording →
            // stop the recorder and navigate back; everything else →
            // plain Stack pop.
            if (phase === "drafting") {
              handleDiscard();
              return;
            }
            if (phase === "recording") {
              ++recordingIdRef.current;
              void recorder.stop().catch(() => {});
              recordStartedAtRef.current = null;
              setElapsedS(0);
              setPartialCaption("");
              const session = streamingSessionRef.current;
              if (session != null) {
                streamingSessionRef.current = null;
                void session.stop();
              }
              setPhase("idle");
              router.back();
              return;
            }
            router.back();
          }}
          style={styles.iconButton}
          accessibilityLabel="Close voice capture"
        >
          <Ionicons name="close" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Speak a memory
        </Text>
        {phase === "drafting" || phase === "saving" ? (
          <Pressable
            onPress={() => handleSave()}
            style={[
              styles.saveButton,
              (!editBody.trim() || limitReached || phase === "saving") && {
                opacity: 0.5,
              },
            ]}
            disabled={!editBody.trim() || limitReached || phase === "saving"}
          >
            <Text style={[styles.saveText, { color: colors.primary }]}>
              {phase === "saving" ? "Saving…" : "Save"}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {limitReached ? (
          <ProUpsellCard
            icon="infinite-outline"
            title="Daily capture limit reached"
            body={`You've captured ${limit} memories today on the free plan. Upgrade to MemTool Pro to capture unlimited memories every day.`}
          />
        ) : (
          <>
            {!isPro && (
              <View
                style={[
                  styles.usageBanner,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Ionicons
                  name="hourglass-outline"
                  size={16}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[styles.usageText, { color: colors.mutedForeground }]}
                >
                  {remainingToday} of {limit} memories left today on the free
                  plan
                </Text>
              </View>
            )}

            {phase === "idle" && (
              <View style={styles.recordZone}>
                <Text
                  style={[styles.heroTitle, { color: colors.foreground }]}
                >
                  Hold to record
                </Text>
                <Text
                  style={[
                    styles.heroSub,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Speak for up to {MAX_DURATION_S} seconds. We'll turn it into
                  an editable memory you can save.
                </Text>
                <Pressable
                  onPressIn={() => void startRecording()}
                  onPressOut={() => void stopAndProcess()}
                  style={({ pressed }) => [
                    styles.micButton,
                    {
                      backgroundColor: colors.primary,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                  accessibilityLabel="Hold to record a voice memory"
                  accessibilityHint={`Press and hold for up to ${MAX_DURATION_S} seconds, then release to process the recording.`}
                >
                  <Ionicons
                    name="mic"
                    size={56}
                    color={colors.primaryForeground}
                  />
                </Pressable>
                {!sttAvailable && (
                  <View
                    style={[
                      styles.unavailableCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        sttUnavailableReason === "authorization_denied"
                          ? "lock-closed-outline"
                          : "information-circle-outline"
                      }
                      size={16}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.unavailableCardText,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {sttUnavailableMessage(sttUnavailableReason)}
                    </Text>
                    {sttUnavailableReason === "authorization_denied" && (
                      <TouchableOpacity
                        onPress={() => void Linking.openSettings()}
                        style={[
                          styles.openSettingsButton,
                          { borderColor: colors.border },
                        ]}
                        accessibilityLabel="Open Settings to grant speech recognition permission"
                      >
                        <Text
                          style={[
                            styles.openSettingsText,
                            { color: colors.primary },
                          ]}
                        >
                          Open Settings
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                {__DEV__ && !sttAvailable && sttUnavailableReason != null && (
                  <View
                    style={[
                      styles.devDebugCard,
                      {
                        backgroundColor: "#1a1a2e",
                        borderColor: "#3a3a5c",
                      },
                    ]}
                  >
                    <Text style={styles.devDebugLabel}>DEV · STT reason</Text>
                    <Text style={styles.devDebugValue}>
                      {sttUnavailableReason}
                    </Text>
                  </View>
                )}
                {fmAvailable && (
                  <View
                    style={[
                      styles.fmBadge,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name="sparkles"
                      size={12}
                      color={colors.primary}
                    />
                    <Text
                      style={[
                        styles.fmBadgeText,
                        { color: colors.foreground },
                      ]}
                    >
                      On-device Apple Intelligence
                    </Text>
                  </View>
                )}
              </View>
            )}

            {phase === "recording" && (
              <View style={styles.recordZone}>
                <Text style={[styles.timer, { color: colors.foreground }]}>
                  {formatTimer(remainingS)}
                </Text>
                <Text
                  style={[styles.heroSub, { color: colors.mutedForeground }]}
                >
                  Listening… release the button to stop.
                </Text>
                <Pressable
                  onPressOut={() => void stopAndProcess()}
                  style={({ pressed }) => [
                    styles.micButton,
                    styles.micButtonRecording,
                    {
                      backgroundColor: colors.primary,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                  accessibilityLabel="Recording — release to stop"
                >
                  <Ionicons
                    name="stop"
                    size={56}
                    color={colors.primaryForeground}
                  />
                </Pressable>

                {/*
                  Live caption line (Task #265). Only rendered when
                  the streaming provider is available AND has produced
                  at least one partial result. The animated container
                  fades in each time new text arrives so the user sees
                  a subtle pulse that communicates "still listening"
                  without distracting from the stop button. The text
                  is styled in mutedForeground to distinguish it from
                  final/confirmed content and kept to two lines so a
                  long ramble doesn't push the stop button off screen.
                */}
                {streamingAvailable && partialCaption.length > 0 && (
                  <Animated.View
                    style={[
                      styles.captionContainer,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        opacity: captionOpacity,
                      },
                    ]}
                  >
                    <Ionicons
                      name="mic-outline"
                      size={13}
                      color={colors.primary}
                      style={styles.captionIcon}
                    />
                    <Text
                      style={[
                        styles.captionText,
                        { color: colors.mutedForeground },
                      ]}
                      numberOfLines={2}
                      ellipsizeMode="head"
                    >
                      {partialCaption}
                    </Text>
                  </Animated.View>
                )}

                <View
                  style={[
                    styles.recordingIndicator,
                    { backgroundColor: colors.card },
                  ]}
                >
                  <View
                    style={[
                      styles.recordingDot,
                      { backgroundColor: "#ef4444" },
                    ]}
                  />
                  <Text
                    style={[
                      styles.recordingLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    Recording {formatTimer(elapsedS)} / {formatTimer(MAX_DURATION_S)}
                  </Text>
                </View>
              </View>
            )}

            {phase === "processing" && (
              <View style={styles.recordZone}>
                {/*
                  Foreground companion to the iOS Live Activity /
                  Dynamic Island wired up by Task #200. The activity
                  is what the user sees when the phone is locked or
                  they swiped away to another app; this banner is
                  what they see if they stay on the screen. Both
                  surfaces narrate the same lifecycle and are torn
                  down together by `stopAndProcess` /
                  `handleSave` / `handleDiscard`. On platforms or
                  builds without the WidgetKit extension the
                  activity calls no-op and this banner is the only
                  visible surface.
                */}
                <View
                  style={[
                    styles.processingBanner,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="sparkles"
                    size={20}
                    color={colors.primary}
                  />
                  <Text
                    style={[
                      styles.processingTitle,
                      { color: colors.foreground },
                    ]}
                  >
                    Processing memory…
                  </Text>
                  <Text
                    style={[
                      styles.processingSub,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    Turning your ramble into an editable draft
                    {fmAvailable
                      ? " with Apple Intelligence."
                      : " with on-device pattern matching."}
                  </Text>
                </View>
              </View>
            )}

            {(phase === "drafting" || phase === "saving") && draft && (
              <View>
                {sttEngineName && !draft.isEmpty && (
                  // Small "Transcribed on-device" badge so the user
                  // can confirm which engine produced their transcript
                  // (Task #199). Hidden when the heuristic produced an
                  // empty draft because there's no transcript to
                  // attribute. Reuses the same fmBadge style as the
                  // Apple Intelligence pill on the idle screen so the
                  // two engine attributions look consistent.
                  <View
                    style={[
                      styles.fmBadge,
                      {
                        alignSelf: "flex-start",
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        marginTop: 0,
                        marginBottom: spacing.base,
                      },
                    ]}
                  >
                    <Ionicons
                      name="mic-outline"
                      size={12}
                      color={colors.primary}
                    />
                    <Text
                      style={[
                        styles.fmBadgeText,
                        { color: colors.foreground },
                      ]}
                    >
                      Transcribed on-device · {sttEngineName}
                    </Text>
                  </View>
                )}
                {draft.isEmpty && (
                  <View
                    style={[
                      styles.emptyHint,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name="information-circle-outline"
                      size={16}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.emptyHintText,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      We didn't catch much from that recording. Type below or
                      tap Re-record to try again.
                    </Text>
                  </View>
                )}

                <Text
                  style={[
                    styles.fieldLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Title
                </Text>
                <TextInput
                  style={[
                    styles.titleInput,
                    {
                      color: colors.foreground,
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholder="Give this memory a headline"
                  placeholderTextColor={colors.mutedForeground}
                />

                <Text
                  style={[
                    styles.fieldLabel,
                    { color: colors.mutedForeground, marginTop: spacing.base },
                  ]}
                >
                  Memory
                </Text>
                <TextInput
                  style={[
                    styles.bodyInput,
                    {
                      color: colors.foreground,
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  value={editBody}
                  onChangeText={setEditBody}
                  placeholder="Edit the cleaned transcript before saving"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  textAlignVertical="top"
                />

                <Text
                  style={[
                    styles.fieldLabel,
                    { color: colors.mutedForeground, marginTop: spacing.base },
                  ]}
                >
                  Tags
                </Text>
                <View style={styles.chipRow}>
                  {VOICE_SUGGESTED_TAGS_POOL.map((tag) => {
                    const selected = editTags.includes(tag);
                    return (
                      <TouchableOpacity
                        key={tag}
                        style={[
                          styles.chip,
                          { borderColor: colors.border },
                          selected && {
                            backgroundColor: colors.primary,
                            borderColor: colors.primary,
                          },
                        ]}
                        onPress={() => toggleTag(tag)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: colors.foreground },
                            selected && { color: colors.primaryForeground },
                          ]}
                        >
                          #{tag}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {draft.people.length > 0 && (
                  <>
                    <Text
                      style={[
                        styles.fieldLabel,
                        {
                          color: colors.mutedForeground,
                          marginTop: spacing.base,
                        },
                      ]}
                    >
                      People mentioned
                    </Text>
                    <View style={styles.chipRow}>
                      {draft.people.map((p) => (
                        <View
                          key={p}
                          style={[
                            styles.chip,
                            {
                              borderColor: colors.border,
                              backgroundColor: colors.card,
                            },
                          ]}
                        >
                          <Ionicons
                            name="person-outline"
                            size={12}
                            color={colors.mutedForeground}
                          />
                          <Text
                            style={[
                              styles.chipText,
                              { color: colors.foreground, marginLeft: 4 },
                            ]}
                          >
                            {p}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}

                <Text
                  style={[
                    styles.fieldLabel,
                    {
                      color: colors.mutedForeground,
                      marginTop: spacing.base,
                    },
                  ]}
                >
                  Emotional tone
                </Text>
                <View style={styles.chipRow}>
                  {EMOTIONAL_TONES.map((tone) => {
                    const selected = editTone === tone;
                    return (
                      <TouchableOpacity
                        key={tone}
                        style={[
                          styles.chip,
                          { borderColor: colors.border },
                          selected && {
                            backgroundColor: colors.primary,
                            borderColor: colors.primary,
                          },
                        ]}
                        onPress={() => setEditTone(tone)}
                      >
                        <Ionicons
                          name={TONE_ICON[tone]}
                          size={12}
                          color={
                            selected
                              ? colors.primaryForeground
                              : colors.mutedForeground
                          }
                        />
                        <Text
                          style={[
                            styles.chipText,
                            {
                              color: colors.foreground,
                              marginLeft: 4,
                            },
                            selected && { color: colors.primaryForeground },
                          ]}
                        >
                          {TONE_LABEL[tone]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.draftActions}>
                  <Pressable
                    onPress={handleReRecord}
                    style={[
                      styles.secondaryButton,
                      { borderColor: colors.border },
                    ]}
                  >
                    <Ionicons
                      name="mic-outline"
                      size={18}
                      color={colors.foreground}
                    />
                    <Text
                      style={[
                        styles.secondaryButtonText,
                        { color: colors.foreground },
                      ]}
                    >
                      Re-record
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDiscard}
                    style={[
                      styles.secondaryButton,
                      { borderColor: colors.border },
                    ]}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.secondaryButtonText,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      Discard
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
      <Toast
        message={
          toastSynced
            ? "Memory saved!"
            : "Saved offline — will sync when reconnected"
        }
        icon={toastSynced ? "checkmark-circle" : "cloud-offline-outline"}
        iconColor={toastSynced ? undefined : colors.mutedForeground}
        visible={showToast}
      />
    </KeyboardAvoidingView>
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
    borderBottomWidth: 1,
  },
  iconButton: { padding: spacing.xs, minWidth: 44 },
  headerTitle: { ...text.cardLabel },
  saveButton: { padding: spacing.xs, paddingHorizontal: spacing.sm },
  saveText: {
    ...text.body,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  scrollContent: { padding: spacing.lg, paddingBottom: 100, flexGrow: 1 },
  usageBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  usageText: {
    ...text.caption,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  recordZone: {
    alignItems: "center",
    paddingVertical: spacing.lg,
    gap: spacing.base,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  heroSub: {
    ...text.caption,
    textAlign: "center",
    paddingHorizontal: spacing.base,
  },
  micButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: spacing.lg,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  micButtonRecording: {
    transform: [{ scale: 1.04 }],
  },
  captionContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    width: "100%",
  },
  captionIcon: {
    marginTop: 2,
    flexShrink: 0,
  },
  captionText: {
    ...text.caption,
    flex: 1,
    fontStyle: "italic",
    lineHeight: 18,
  },
  recordingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  recordingLabel: {
    ...text.caption,
  },
  timer: {
    fontSize: 48,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  mutedNote: {
    ...text.caption,
    textAlign: "center",
    paddingHorizontal: spacing.base,
    marginTop: spacing.sm,
  },
  unavailableCard: {
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    width: "100%",
  },
  unavailableCardText: {
    ...text.caption,
    textAlign: "center",
    paddingHorizontal: spacing.xs,
  },
  openSettingsButton: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  openSettingsText: {
    ...text.caption,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  devDebugCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    width: "100%",
  },
  devDebugLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: "#7c7cb0",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  devDebugValue: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#a0a0d0",
  },
  fmBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: spacing.sm,
  },
  fmBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  processingBanner: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.lg,
  },
  processingTitle: {
    ...text.body,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  processingSub: {
    ...text.caption,
    textAlign: "center",
  },
  emptyHint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  emptyHintText: {
    ...text.caption,
    flex: 1,
  },
  fieldLabel: {
    ...text.caption,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    marginBottom: spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  titleInput: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  bodyInput: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    minHeight: 140,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
    fontWeight: "500",
  },
  draftActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
