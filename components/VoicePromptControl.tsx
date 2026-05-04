/**
 * Reusable mic + waveform + transcript preview control. Owns the
 * record → transcribe lifecycle and hands the result back to the host
 * via `onTranscript({ text, previous })`. The host keeps the editable
 * text destination — the control never persists or uploads audio.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  AudioModule,
  createAudioPlayer,
  RecordingPresets,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import {
  getSpeechToTextEngineName,
  getSpeechToTextUnavailableReason,
  isSpeechToTextAvailable,
  transcribeRecording,
  type STTUnavailableReason,
} from "@/lib/voiceCapture";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

export const VOICE_PROMPT_DEFAULT_MAX_S = 60;
const UNDO_VISIBLE_MS = 6000;
const WAVEFORM_BAR_COUNT = 16;
const TRANSCRIPT_PREVIEW_MAX = 220;

export type VoicePromptPhase = "idle" | "recording" | "processing";

export type VoicePromptTranscriptEvent = {
  text: string;
  previous: string | null;
};

export type VoicePromptControlProps = {
  onTranscript: (event: VoicePromptTranscriptEvent) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  maxDurationS?: number;
  promptLabel?: string;
  testID?: string;
};

function defaultUnavailableMessage(
  reason: STTUnavailableReason | null,
): string {
  switch (reason) {
    case "authorization_denied":
      return "Speech recognition permission was denied. Enable it in Settings to record a voice prompt.";
    case "on_device_unsupported":
      return "Your iPhone's current language doesn't support on-device dictation. Add a supported language under Settings → General → Keyboard → Dictation Languages to use voice prompts.";
    case "ios_too_old":
      return "Voice prompts need iOS 17 or newer. Update your iPhone in Settings → General → Software Update to use this feature.";
    case "framework_not_present":
      return "This iPhone doesn't include Apple's on-device speech recognizer, so voice prompts aren't available here. You can still type your memory below.";
    case "module_not_linked":
      return "This build doesn't include voice transcription. Reinstall the latest version of the app to enable voice prompts.";
    case "non_ios_platform":
      return "Voice prompts use Apple's on-device dictation, so they're only available on iPhone and iPad. Type your memory below instead.";
    case "recognizer_unavailable":
      return "The on-device speech recognizer is busy or offline right now. Wait a moment and try again — no internet needed.";
    case "invalid_uri":
      return "We couldn't read that recording. Try recording again in a moment.";
    case "transcription_failed":
      return "Voice transcription didn't finish. Try again — speaking a little closer to the mic often helps.";
    case "unknown":
    default:
      return "Voice transcription isn't available on this device right now. You can still type your memory below.";
  }
}

function formatTimer(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

// Map a dB metering reading (~-160…0) to a 0…1 level. Falls back to
// a calm fake-level pulse when metering isn't available so the bars
// still feel alive (tests, simulators, devices without metering).
function meteringToLevel(metering: number | undefined): number | null {
  if (metering == null || !Number.isFinite(metering)) return null;
  const clamped = Math.max(-60, Math.min(0, metering));
  return (clamped + 60) / 60;
}

// Best-effort delete of the temporary recording file. expo-audio
// writes it under the app sandbox (cache dir) so removing it just
// frees disk — never used for anything else. We swallow errors so a
// missing/already-removed file never surfaces as a user-facing
// failure when the screen unmounts or the user re-records.
function deleteRecordingFile(uri: string | null): void {
  if (!uri) return;
  try {
    const fs = require("expo-file-system/legacy") as {
      deleteAsync?: (
        uri: string,
        opts?: { idempotent?: boolean },
      ) => Promise<void>;
    };
    if (typeof fs.deleteAsync === "function") {
      void fs.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  } catch {
    /* ignore — file-system module may not be linked in tests/web */
  }
}

type PlaybackPlayer = {
  play: () => void;
  pause: () => void;
  remove?: () => void;
  seekTo?: (s: number) => void;
  addListener?: (
    event: string,
    cb: (status: { didJustFinish?: boolean; isLoaded?: boolean }) => void,
  ) => { remove: () => void };
};

export function VoicePromptControl({
  onTranscript,
  onError,
  disabled = false,
  maxDurationS = VOICE_PROMPT_DEFAULT_MAX_S,
  promptLabel = "Add a voice note",
  testID,
}: VoicePromptControlProps) {
  const colors = useColors();
  // Spread the preset so we can flip on metering without mutating
  // the shared constant. Falls back gracefully if metering isn't
  // wired on a given platform.
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const recorderState = useAudioRecorderState(recorder, 100);

  const [phase, setPhase] = useState<VoicePromptPhase>("idle");
  const [elapsedS, setElapsedS] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [undoCandidate, setUndoCandidate] = useState<string | null>(null);
  // URI of the last successful recording. Held in state so the
  // "Play back" chip can show/hide; tracked in a ref too so cleanup
  // paths (unmount, re-record, undo) can delete the temp file
  // without depending on a re-render.
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const recordingUriRef = useRef<string | null>(null);
  const playerRef = useRef<PlaybackPlayer | null>(null);
  const playerListenerRef = useRef<{ remove: () => void } | null>(null);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  // Rolling window of recent levels feeding the waveform bars.
  const [levels, setLevels] = useState<number[]>(() =>
    Array(WAVEFORM_BAR_COUNT).fill(0),
  );

  const sttAvailable = isSpeechToTextAvailable();
  const sttReason = getSpeechToTextUnavailableReason();
  const engineName = getSpeechToTextEngineName();

  // Push a new level sample onto the waveform every metering tick.
  // When metering returns nothing (web, mocked tests), fall back to
  // a soft sine pulse so the bars still animate during recording.
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => {
      const live = meteringToLevel(recorderState?.metering);
      const synthetic =
        0.35 + 0.4 * Math.abs(Math.sin(Date.now() / 220));
      const next = live ?? synthetic;
      setLevels((prev) => {
        const out = prev.slice(1);
        out.push(Math.max(0.08, Math.min(1, next)));
        return out;
      });
    }, 110);
    return () => clearInterval(id);
  }, [phase, recorderState?.metering]);

  useEffect(() => {
    if (phase === "idle") {
      setLevels(Array(WAVEFORM_BAR_COUNT).fill(0));
    }
  }, [phase]);

  // 1Hz timer + auto-stop when the cap is reached.
  const startedAtRef = useRef<number | null>(null);
  const stopReqRef = useRef(false);
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => {
      if (startedAtRef.current == null) return;
      const elapsed = Math.floor(
        (Date.now() - startedAtRef.current) / 1000,
      );
      setElapsedS(elapsed);
      if (elapsed >= maxDurationS && !stopReqRef.current) {
        stopReqRef.current = true;
        void stopAndProcess();
      }
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, maxDurationS]);

  useEffect(() => {
    if (undoCandidate == null) return;
    const id = setTimeout(() => setUndoCandidate(null), UNDO_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [undoCandidate]);

  const reportError = useCallback(
    (message: string) => {
      setErrorMessage(message);
      onError?.(message);
    },
    [onError],
  );

  // Tear down the in-memory player without touching the underlying
  // file. Used both when swapping recordings and on unmount.
  const teardownPlayer = useCallback(() => {
    try {
      playerListenerRef.current?.remove();
    } catch {
      /* ignore */
    }
    playerListenerRef.current = null;
    const p = playerRef.current;
    playerRef.current = null;
    if (p) {
      try {
        p.pause();
      } catch {
        /* ignore */
      }
      try {
        p.remove?.();
      } catch {
        /* ignore */
      }
    }
    setIsPlayingBack(false);
  }, []);

  // Drop the current recording — stop playback, dispose the player,
  // delete the temp file, and clear the URI state. Safe to call
  // multiple times.
  const clearRecording = useCallback(() => {
    teardownPlayer();
    const uri = recordingUriRef.current;
    recordingUriRef.current = null;
    if (uri) deleteRecordingFile(uri);
    setRecordingUri(null);
  }, [teardownPlayer]);

  // Cleanup on unmount: kill any active playback and remove the
  // temp recording so audio never lingers on disk past this screen.
  useEffect(() => {
    return () => {
      try {
        playerListenerRef.current?.remove();
      } catch {
        /* ignore */
      }
      playerListenerRef.current = null;
      const p = playerRef.current;
      playerRef.current = null;
      if (p) {
        try {
          p.pause();
        } catch {
          /* ignore */
        }
        try {
          p.remove?.();
        } catch {
          /* ignore */
        }
      }
      const uri = recordingUriRef.current;
      recordingUriRef.current = null;
      if (uri) deleteRecordingFile(uri);
    };
  }, []);

  const togglePlayback = useCallback(() => {
    const uri = recordingUriRef.current;
    if (!uri) return;
    if (isPlayingBack && playerRef.current) {
      try {
        playerRef.current.pause();
      } catch {
        /* ignore */
      }
      setIsPlayingBack(false);
      return;
    }
    // Lazily build a player on first play. expo-audio's
    // createAudioPlayer may be unavailable in tests/web — in that
    // case we silently no-op so the chip press is harmless.
    let player = playerRef.current;
    if (!player) {
      try {
        const made =
          typeof createAudioPlayer === "function"
            ? (createAudioPlayer({ uri }) as PlaybackPlayer | null)
            : null;
        if (made) {
          player = made;
          playerRef.current = made;
          try {
            playerListenerRef.current =
              made.addListener?.("playbackStatusUpdate", (status) => {
                if (status?.didJustFinish) {
                  setIsPlayingBack(false);
                  try {
                    made.seekTo?.(0);
                  } catch {
                    /* ignore */
                  }
                }
              }) ?? null;
          } catch {
            playerListenerRef.current = null;
          }
        }
      } catch {
        player = null;
      }
    }
    if (!player) return;
    try {
      player.seekTo?.(0);
    } catch {
      /* ignore */
    }
    try {
      player.play();
      setIsPlayingBack(true);
      void Haptics.selectionAsync?.();
    } catch {
      setIsPlayingBack(false);
    }
  }, [isPlayingBack]);

  const promptForSettings = useCallback(() => {
    Alert.alert(
      "Microphone access needed",
      "Memora needs microphone access to record your voice prompt. Open Settings to turn it on.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Open Settings",
          onPress: () => void Linking.openSettings(),
        },
      ],
    );
  }, []);

  const startRecording = useCallback(async () => {
    if (phase !== "idle" || disabled) return;
    setErrorMessage(null);
    if (!sttAvailable) {
      const msg = defaultUnavailableMessage(sttReason);
      reportError(msg);
      if (sttReason === "authorization_denied") {
        promptForSettings();
      }
      return;
    }
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        reportError(
          "Microphone access is off. Turn it on in Settings to record a voice prompt.",
        );
        promptForSettings();
        return;
      }
      stopReqRef.current = false;
      setElapsedS(0);
      startedAtRef.current = Date.now();
      // Drop the previous capture (audio + player) before starting
      // a new one so disk/memory don't accumulate across re-records.
      clearRecording();
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      if (__DEV__) console.warn("[VoicePromptControl] start failed", err);
      reportError("Couldn't start the microphone. Try again in a moment.");
      setPhase("idle");
    }
  }, [
    disabled,
    phase,
    promptForSettings,
    recorder,
    reportError,
    sttAvailable,
    sttReason,
  ]);

  const stopAndProcess = useCallback(async () => {
    if (phase !== "recording") return;
    setPhase("processing");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch (err) {
      if (__DEV__) console.warn("[VoicePromptControl] stop failed", err);
    }
    startedAtRef.current = null;
    if (!uri) {
      reportError("We couldn't save the recording. Try again in a moment.");
      setPhase("idle");
      return;
    }
    try {
      const transcript = await transcribeRecording(uri);
      const trimmed = (transcript ?? "").trim();
      if (trimmed.length === 0) {
        reportError(
          "We didn't catch any speech in that recording. Try again a little closer to the mic.",
        );
        setPhase("idle");
        return;
      }
      const previous = lastTranscript;
      onTranscript({ text: trimmed, previous });
      setLastTranscript(trimmed);
      setUndoCandidate(previous && previous !== trimmed ? previous : null);
      // Remember the temp recording so the user can play it back
      // before saving. Stored both as state (for the chip) and as a
      // ref (for cleanup paths that fire outside React's render).
      recordingUriRef.current = uri;
      setRecordingUri(uri);
      setPhase("idle");
      setElapsedS(0);
    } catch (err) {
      if (__DEV__)
        console.warn("[VoicePromptControl] transcribe failed", err);
      reportError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't transcribe that recording. Try again in a moment.",
      );
      setPhase("idle");
    }
  }, [lastTranscript, onTranscript, phase, recorder, reportError]);

  const handleUndo = useCallback(() => {
    const previous = undoCandidate;
    if (previous == null) return;
    setUndoCandidate(null);
    setLastTranscript(previous);
    onTranscript({ text: previous, previous: lastTranscript ?? null });
    // The audio for the prior transcript is gone (we deleted it on
    // re-record). Drop the current recording too so the Play back
    // chip doesn't offer audio that no longer matches the transcript.
    clearRecording();
  }, [clearRecording, lastTranscript, onTranscript, undoCandidate]);

  const interactiveDisabled = disabled;
  const showInlineSettings = sttReason === "authorization_denied";

  const micLabel =
    phase === "recording"
      ? "Recording — tap to stop"
      : phase === "processing"
        ? "Transcribing voice prompt"
        : lastTranscript
          ? "Re-record voice prompt"
          : "Record voice prompt";

  const transcriptPreview = useMemo(() => {
    if (!lastTranscript) return null;
    return lastTranscript.length > TRANSCRIPT_PREVIEW_MAX
      ? `${lastTranscript.slice(0, TRANSCRIPT_PREVIEW_MAX - 1)}…`
      : lastTranscript;
  }, [lastTranscript]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      testID={testID ?? "voice-prompt-control"}
    >
      <View style={styles.headerRow}>
        <Ionicons name="mic-outline" size={16} color={colors.primary} />
        <Text style={[styles.headerLabel, { color: colors.foreground }]}>
          {promptLabel}
        </Text>
        {engineName && lastTranscript ? (
          <Text
            style={[styles.engineBadge, { color: colors.mutedForeground }]}
          >
            On-device · {engineName}
          </Text>
        ) : null}
      </View>

      <View style={styles.controlRow}>
        <Pressable
          onPress={() => {
            if (phase === "recording") {
              stopReqRef.current = true;
              void stopAndProcess();
            } else if (phase === "idle") {
              void startRecording();
            }
          }}
          disabled={interactiveDisabled || phase === "processing"}
          accessibilityRole="button"
          accessibilityLabel={micLabel}
          accessibilityState={{
            disabled: interactiveDisabled || phase === "processing",
            busy: phase !== "idle",
          }}
          style={({ pressed }) => [
            styles.micButton,
            {
              backgroundColor:
                phase === "recording" ? "#ef4444" : colors.primary,
              opacity:
                interactiveDisabled || phase === "processing"
                  ? 0.5
                  : pressed
                    ? 0.85
                    : 1,
            },
          ]}
          testID={`${testID ?? "voice-prompt-control"}-mic`}
        >
          <Ionicons
            name={
              phase === "recording"
                ? "stop"
                : phase === "processing"
                  ? "ellipsis-horizontal"
                  : "mic"
            }
            size={28}
            color={colors.primaryForeground}
          />
        </Pressable>

        <View style={styles.statusColumn}>
          {phase === "recording" ? (
            <View>
              <Text style={[styles.statusText, { color: colors.foreground }]}>
                Recording {formatTimer(elapsedS)} / {formatTimer(maxDurationS)}
              </Text>
              <Waveform
                levels={levels}
                color={colors.primary}
                testID={`${testID ?? "voice-prompt-control"}-waveform`}
              />
            </View>
          ) : phase === "processing" ? (
            <Text style={[styles.statusText, { color: colors.foreground }]}>
              Transcribing on device…
            </Text>
          ) : lastTranscript ? (
            <Text
              style={[styles.statusText, { color: colors.mutedForeground }]}
              numberOfLines={2}
            >
              Tap the mic to re-record. Edit the text below before saving.
            </Text>
          ) : (
            <Text
              style={[styles.statusText, { color: colors.mutedForeground }]}
            >
              Tap the mic and speak — up to {maxDurationS}s. We'll add the
              transcript to your memory.
            </Text>
          )}
        </View>
      </View>

      {transcriptPreview && phase !== "recording" ? (
        <View
          style={[
            styles.transcriptPreview,
            {
              borderColor: colors.border,
              backgroundColor: colors.background,
            },
          ]}
          testID={`${testID ?? "voice-prompt-control"}-transcript`}
        >
          <Text
            style={[
              styles.transcriptLabel,
              { color: colors.mutedForeground },
            ]}
          >
            Heard
          </Text>
          <Text
            style={[styles.transcriptText, { color: colors.foreground }]}
          >
            “{transcriptPreview}”
          </Text>
        </View>
      ) : null}

      {recordingUri && phase === "idle" ? (
        <View style={styles.actionRow}>
          <TouchableOpacity
            onPress={togglePlayback}
            accessibilityRole="button"
            accessibilityLabel={
              isPlayingBack
                ? "Pause voice note playback"
                : "Play back voice note"
            }
            accessibilityState={{ busy: isPlayingBack }}
            style={[
              styles.playbackChip,
              {
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
            testID={`${testID ?? "voice-prompt-control"}-playback`}
          >
            <Ionicons
              name={isPlayingBack ? "pause" : "play"}
              size={14}
              color={colors.primary}
            />
            <Text style={[styles.playbackChipText, { color: colors.primary }]}>
              {isPlayingBack ? "Pause" : "Play back"}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {undoCandidate != null && phase === "idle" ? (
        <View
          style={[
            styles.undoRow,
            { borderColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <Ionicons
            name="arrow-undo-outline"
            size={14}
            color={colors.mutedForeground}
          />
          <Text
            style={[styles.undoText, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            Replaced previous transcript
          </Text>
          <TouchableOpacity
            onPress={handleUndo}
            accessibilityRole="button"
            accessibilityLabel="Undo voice transcript replacement"
            testID={`${testID ?? "voice-prompt-control"}-undo`}
          >
            <Text style={[styles.undoAction, { color: colors.primary }]}>
              Undo
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {errorMessage ? (
        <View
          style={[
            styles.errorRow,
            { borderColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <Ionicons
            name={
              showInlineSettings
                ? "lock-closed-outline"
                : "alert-circle-outline"
            }
            size={14}
            color={colors.mutedForeground}
          />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
            {errorMessage}
          </Text>
          {showInlineSettings ? (
            <TouchableOpacity
              onPress={() => void Linking.openSettings()}
              accessibilityRole="button"
              accessibilityLabel="Open Settings to grant microphone permission"
              testID={`${testID ?? "voice-prompt-control"}-settings`}
            >
              <Text style={[styles.errorAction, { color: colors.primary }]}>
                Open Settings
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Waveform({
  levels,
  color,
  testID,
}: {
  levels: number[];
  color: string;
  testID?: string;
}) {
  // Animate each bar's height between renders for smoother motion.
  const animated = useRef(levels.map((l) => new Animated.Value(l))).current;
  useEffect(() => {
    levels.forEach((value, i) => {
      const target = animated[i];
      if (!target) return;
      Animated.timing(target, {
        toValue: value,
        duration: 90,
        useNativeDriver: false,
      }).start();
    });
  }, [animated, levels]);
  return (
    <View
      style={styles.waveform}
      testID={testID}
      accessibilityLabel="Live audio level"
    >
      {animated.map((value, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveformBar,
            {
              backgroundColor: color,
              height: value.interpolate({
                inputRange: [0, 1],
                outputRange: [3, 28],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerLabel: {
    ...text.bodySemibold,
    flex: 1,
  },
  engineBadge: {
    ...text.captionStrong,
  },
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  micButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  statusColumn: {
    flex: 1,
  },
  statusText: {
    ...text.body,
  },
  waveform: {
    marginTop: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 32,
  },
  waveformBar: {
    width: 3,
    borderRadius: 2,
    minHeight: 3,
  },
  transcriptPreview: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 2,
  },
  transcriptLabel: {
    ...text.captionStrong,
  },
  transcriptText: {
    ...text.body,
    fontStyle: "italic",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  playbackChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  playbackChipText: {
    ...text.captionStrong,
  },
  undoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  undoText: {
    ...text.caption,
    flex: 1,
  },
  undoAction: {
    ...text.captionStrong,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  errorText: {
    ...text.caption,
    flex: 1,
  },
  errorAction: {
    ...text.captionStrong,
  },
});
