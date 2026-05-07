import { useCallback, useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  AppState,
  Platform,
  type AppStateStatus,
} from "react-native";
import * as Speech from "expo-speech";
import {
  cancelAnimation,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

import { getBreathingEnabled } from "./aliveUI";
import { textToVisemeStream, type VisemeFrame } from "./textToVisemes";

/**
 * `useMemSpeech` — drive Mem's voice + jaw + word-by-word reveal
 * for the AI Guide chat (Task #283).
 *
 * Responsibilities:
 *   - Speak a string via on-device TTS (`expo-speech`).
 *   - Emit timed word-boundary indices so the screen can advance
 *     a "currently visible word" cursor in lock-step with the
 *     audio. iOS/Android both surface real `onBoundary` callbacks
 *     when available; when they aren't (e.g. some Android builds
 *     never fire one), we fall back to a fixed words-per-second
 *     estimator so the bubble still streams in time.
 *   - Drive a `mouthOpen` shared value (0..1) with a low-frequency
 *     sine + small randomization so Mem's mouth feels alive
 *     without faking phoneme-accurate lip-sync (Apple/Google ship
 *     amplitude-style lip-sync in their assistants — this is
 *     deliberately the same trick).
 *   - Honor mute (no audio, no mouth, *but* still emit boundaries
 *     at a faster pace so the transcript reveal isn't slowed by
 *     silence) and OS Reduce Motion (audio + reveal continue, but
 *     mouth stays closed so the screen reads as "calm").
 *   - Honor the existing `breathingEnabled` perf guard — when the
 *     screen reports sustained slow frames the lip-sync degrades
 *     to a 200ms two-state mouth open/close instead of the smooth
 *     sine, matching the spec's "no jank" clause.
 *   - `stop()` cancels everything immediately so a tap on Mem
 *     (or a new send) snaps the UI back to idle.
 *
 * Owned shared values:
 *   - `mouthOpen` is created here and exposed via the return value.
 *     The screen passes it to `<MemCharacter mouthOpen={...} />`.
 */

const DEFAULT_WPS = 3.2;
// Muted reveal must feel meaningfully *faster* than the spoken
// cadence (per Task #283 brief — silence shouldn't slow the UX).
// 6.5 wps is roughly 2× the spoken rate, so a 30-word reply
// reveals in ~5s instead of ~9s but still reads as words appearing
// rather than the whole bubble flashing in.
const MUTED_WPS = 6.5;
const FALLBACK_TICK_MS = 50;
const MOUTH_TICK_MS = 60;
const DEGRADED_MOUTH_TICK_MS = 200;
const SINE_HZ = 5.5;
// Grace window for the spoken path: once the fallback estimator
// has reached the full word count, wait this long for the OS
// `onDone` callback. If it doesn't arrive (some Android builds
// drop it; some devices throw the call synchronously and never
// invoke any callback), auto-teardown so timers + mouth animation
// don't leak past the visible end of the reply.
const SPOKEN_DONE_GRACE_MS = 1500;

export interface MemSpeechController {
  /** Read by `<MemCharacter mouthOpen={...} />`. 0..1, 0 = closed. */
  mouthOpen: SharedValue<number>;
  /**
   * Integer viseme code (see `VISEME_INDEX` in `Memora.tsx`).
   * Drives true lip-sync — `<Memora viseme={...} />` morphs its
   * mouth shape between the 7 visemes (rest, MBP, AI, E, O, U,
   * FV) on the UI thread. We derive the stream from the spoken
   * text via a word-by-word phoneme heuristic and tick through
   * each word's frames between `onBoundary` events. Muted /
   * Reduce Motion → stays at 0 (rest).
   */
  viseme: SharedValue<number>;
  /**
   * Speak a string. Returns once the call has been *enqueued* (or
   * skipped because muted with no callbacks). The callbacks fire
   * progressively as the speech advances. `onWordIndex` is called
   * with the index of the next word to *reveal* (1-based count of
   * visible words), starting from 0 and ending with the total word
   * count when speech finishes (or is interrupted).
   */
  speak: (
    text: string,
    callbacks?: {
      onWordIndex?: (visibleWordCount: number) => void;
      onDone?: () => void;
    },
  ) => void;
  /** Interrupt any in-flight speech and snap the bubble to full text. */
  stop: () => void;
  /** True while a speech utterance is in flight. */
  isSpeaking: () => boolean;
}

export interface UseMemSpeechOptions {
  /** When true, skip audio + jaw movement; transcript still streams. */
  muted: boolean;
  /**
   * Wpm-style fallback rate for the spoken (or "no-boundary-events")
   * path. Defaults to 3.2 words/sec — a comfortable speaking pace.
   */
  fallbackWordsPerSecond?: number;
  /**
   * Wpm-style rate used when `muted` is true. Defaults to 6.5 — about
   * 2× the spoken rate so silence doesn't slow the UX (per task brief).
   */
  mutedWordsPerSecond?: number;
  /**
   * Non-null launch-approved native TTS voice id. Null never falls back
   * to system/default TTS; it uses the silent reveal path instead.
   */
  voice?: string | null;
}

interface SpeechRunState {
  words: string[];
  /** Per-word viseme frame list (precomputed from text). */
  visemeStream: VisemeFrame[][];
  /** Index of the word whose visemes are currently being ticked. */
  visemeWordIdx: number;
  /** Index inside the current word's frame list. */
  visemeFrameIdx: number;
  visemeTimer: ReturnType<typeof setInterval> | null;
  visible: number;
  cancelled: boolean;
  fallbackTimer: ReturnType<typeof setInterval> | null;
  mouthTimer: ReturnType<typeof setInterval> | null;
  startedAt: number;
  // Set to `Date.now()` the moment the fallback estimator first
  // reaches `words.length`. Used by the spoken path to auto-
  // teardown after `SPOKEN_DONE_GRACE_MS` if the OS `onDone`
  // callback never arrives (drops on some Android builds, or
  // when `Speech.speak` throws synchronously and we landed in
  // the timer-only fallback).
  fullyRevealedAt: number | null;
  onWordIndex?: (visible: number) => void;
  onDone?: () => void;
  // Snapshot of the per-call config so a mid-call mute toggle is
  // handled by `stop()` from outside, not by re-reading flags here.
  muted: boolean;
  reduceMotion: boolean;
  degraded: boolean;
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

function normalizeSpeechText(input: string): string {
  return input
    .replace(/\bM\.E\.M\.\b/g, "Mehm")
    .replace(/\bMEM\b/g, "Mehm")
    .replace(/\bMemTool\b/g, "Mehm Tool");
}

export function useMemSpeech(
  options: UseMemSpeechOptions,
): MemSpeechController {
  const {
    muted,
    fallbackWordsPerSecond = DEFAULT_WPS,
    mutedWordsPerSecond = MUTED_WPS,
    voice,
  } = options;

  const mouthOpen = useSharedValue(0);
  const viseme = useSharedValue(0);
  const runRef = useRef<SpeechRunState | null>(null);
  const reduceMotionRef = useRef<boolean>(false);

  // Track Reduce Motion so the lip-sync gate stays a sync read at
  // speak-time (we don't want to await the OS query inside speak()).
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) reduceMotionRef.current = v;
      })
      .catch(() => {
        if (mounted) reduceMotionRef.current = false;
      });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v) => {
        if (mounted) reduceMotionRef.current = Boolean(v);
      },
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const teardown = useCallback(
    (run: SpeechRunState | null, opts: { fireDone: boolean }) => {
      if (!run) return;
      if (run.fallbackTimer) {
        clearInterval(run.fallbackTimer);
        run.fallbackTimer = null;
      }
      if (run.mouthTimer) {
        clearInterval(run.mouthTimer);
        run.mouthTimer = null;
      }
      if (run.visemeTimer) {
        clearInterval(run.visemeTimer);
        run.visemeTimer = null;
      }
      cancelAnimation(mouthOpen);
      mouthOpen.value = 0;
      viseme.value = 0;
      if (opts.fireDone && !run.cancelled) {
        // Snap visible to the full count so the bubble shows the
        // entire reply even if boundary events stopped firing
        // before the last word.
        if (run.visible < run.words.length && run.onWordIndex) {
          run.onWordIndex(run.words.length);
        }
        run.onDone?.();
      }
    },
    [mouthOpen],
  );

  const stop = useCallback(() => {
    const run = runRef.current;
    if (run) {
      run.cancelled = true;
      teardown(run, { fireDone: false });
      runRef.current = null;
      // Snap the bubble to full text so the user sees the complete
      // reply even though we cut the audio short.
      if (run.onWordIndex) {
        run.onWordIndex(run.words.length);
      }
      run.onDone?.();
    }
    // expo-speech.stop() resolves; we don't need to await — the
    // OS-level cancellation is best-effort either way.
    void Speech.stop().catch(() => {});
  }, [teardown]);

  const isSpeaking = useCallback(() => {
    return runRef.current !== null && !runRef.current.cancelled;
  }, []);

  const speak = useCallback<MemSpeechController["speak"]>(
    (text, callbacks) => {
      // Cancel any in-flight run first so back-to-back replies don't
      // stack up.
      if (runRef.current) {
        const prev = runRef.current;
        prev.cancelled = true;
        teardown(prev, { fireDone: false });
        runRef.current = null;
        void Speech.stop().catch(() => {});
      }

      const words = tokenize(text);
      if (words.length === 0) {
        callbacks?.onDone?.();
        return;
      }

      const reduceMotion = reduceMotionRef.current;
      const degraded = !getBreathingEnabled();
      const visemeStream = textToVisemeStream(text);
      const approvedVoiceId =
        typeof voice === "string" && voice.trim().length > 0 ? voice.trim() : null;
      const speechAudioEnabled = !muted && approvedVoiceId !== null;
      const run: SpeechRunState = {
        words,
        visemeStream,
        visemeWordIdx: 0,
        visemeFrameIdx: 0,
        visemeTimer: null,
        visible: 0,
        cancelled: false,
        fallbackTimer: null,
        mouthTimer: null,
        startedAt: Date.now(),
        fullyRevealedAt: null,
        onWordIndex: callbacks?.onWordIndex,
        onDone: callbacks?.onDone,
        muted: !speechAudioEnabled,
        reduceMotion,
        degraded,
      };
      runRef.current = run;

      const advanceWord = (nextVisible: number) => {
        if (run.cancelled) return;
        const clamped = Math.max(run.visible, Math.min(words.length, nextVisible));
        if (clamped === run.visible) return;
        run.visible = clamped;
        run.onWordIndex?.(clamped);
        if (clamped >= words.length) {
          // The last boundary fired before onDone — keep the
          // current run alive so onDone (or our fallback) can do
          // the final teardown without a double-fire.
        }
      };

      // Always run the fallback estimator. When real boundary events
      // arrive they'll outpace it and `advanceWord` clamps so we
      // never go backwards. When they don't arrive (muted path or
      // a device that doesn't fire onBoundary), the estimator IS
      // the timing source. The muted path uses a visibly faster
      // wps so silence doesn't slow the UX.
      const tickMs = FALLBACK_TICK_MS;
      const activeWps = run.muted ? mutedWordsPerSecond : fallbackWordsPerSecond;
      const wordsPerMs = activeWps / 1000;
      run.fallbackTimer = setInterval(() => {
        if (run.cancelled) return;
        const elapsed = Date.now() - run.startedAt;
        const estimated = Math.floor(elapsed * wordsPerMs);
        if (estimated > run.visible) {
          advanceWord(estimated);
        }
        // The muted path has no `onDone` from expo-speech to lean
        // on, so we self-terminate here when the estimator has
        // exhausted the word list.
        if (run.muted && run.visible >= run.words.length) {
          teardown(run, { fireDone: true });
          if (runRef.current === run) runRef.current = null;
          return;
        }
        // Spoken path: the OS `onDone` callback is best-effort.
        // Some Android builds drop it; if `Speech.speak` threw
        // synchronously above, no native callback will ever fire.
        // Once the fallback estimator has revealed the full text,
        // give the OS `SPOKEN_DONE_GRACE_MS` to deliver `onDone`
        // and then auto-teardown. This guarantees timers + the
        // mouth animation don't outlive the visible end of the
        // reply.
        if (!run.muted && run.visible >= run.words.length) {
          if (run.fullyRevealedAt === null) {
            run.fullyRevealedAt = Date.now();
          } else if (Date.now() - run.fullyRevealedAt >= SPOKEN_DONE_GRACE_MS) {
            teardown(run, { fireDone: true });
            if (runRef.current === run) runRef.current = null;
            // Best-effort native cancel so any straggler audio
            // playback also stops. Mirrors the `stop()` path.
            void Speech.stop().catch(() => {});
          }
        }
      }, tickMs);

      // Viseme cycling — drives `<Memora viseme={...} />` lip-sync.
      // We tick through the per-word frame list at ~80ms/frame so a
      // typical 4-frame word maps to ~320ms (close to the average
      // English word duration at our 0.94 rate). The current word
      // is anchored by the most recent `onBoundary` event via
      // `run.visemeWordIdx`. Muted / Reduce Motion → mouth stays
      // at rest so the screen reads as silent.
      if (speechAudioEnabled && !reduceMotion) {
        run.visemeTimer = setInterval(() => {
          if (run.cancelled) {
            viseme.value = 0;
            return;
          }
          const wordFrames = run.visemeStream[run.visemeWordIdx];
          if (!wordFrames || wordFrames.length === 0) {
            viseme.value = 0;
            return;
          }
          const frame = wordFrames[run.visemeFrameIdx % wordFrames.length];
          if (frame) viseme.value = frame.code;
          run.visemeFrameIdx += 1;
        }, 80);
      }

      // Mouth animation — only when audio is playing AND motion is
      // allowed. Muted or Reduce Motion → mouth stays closed.
      if (speechAudioEnabled && !reduceMotion) {
        const startedAt = Date.now();
        const tick = degraded ? DEGRADED_MOUTH_TICK_MS : MOUTH_TICK_MS;
        let degradedToggle = 0;
        run.mouthTimer = setInterval(() => {
          if (run.cancelled) {
            mouthOpen.value = 0;
            return;
          }
          if (degraded) {
            degradedToggle = degradedToggle === 0 ? 1 : 0;
            mouthOpen.value = degradedToggle === 0 ? 0.05 : 0.85;
            return;
          }
          const t = (Date.now() - startedAt) / 1000;
          // Sine in [0, 1], biased toward open with small jitter so
          // it doesn't look mechanical. The 0.2 floor keeps the
          // mouth from snapping fully closed mid-word.
          const sine = 0.5 + 0.5 * Math.sin(t * SINE_HZ * Math.PI * 2);
          const jitter = (Math.random() - 0.5) * 0.12;
          mouthOpen.value = Math.max(0, Math.min(1, 0.2 + 0.7 * sine + jitter));
        }, tick);
      }

      // Silent path: user-muted, or no launch-approved voice id exists.
      // No audio, no expo-speech call; fallback timer drives reveal and self-terminates.
      if (!speechAudioEnabled || approvedVoiceId == null) return;

      try {
        Speech.speak(normalizeSpeechText(text), {
          // Calm, slightly slowed cadence — research on perceived
          // warmth / soothingness in synthesised speech consistently
          // favours a rate just below 1.0 with a near-neutral pitch.
          // 0.94 / 1.0 reads as "unhurried friend" rather than
          // "newsreader at 1.0" or "stoner at 0.85".
          rate: 0.94,
          pitch: 1.0,
          // Launch safety: never omit `voice`, because omitting it
          // lets the OS pick the system/default TTS voice.
          voice: approvedVoiceId,
          // iOS audio behavior (per task brief):
          //   - Use the *system* audio session so the silent switch
          //     mutes Mem (`useApplicationAudioSession: false` —
          //     when true, expo-av's category overrides the silent
          //     switch and Mem would talk over silent mode).
          //   - `ducksOtherPlayingAudio: true` so any music/podcast
          //     playing in the background dips while Mem speaks
          //     instead of competing with it.
          ...(Platform.OS === "ios"
            ? {
                useApplicationAudioSession: false,
                ducksOtherPlayingAudio: true,
              }
            : {}),
          onBoundary: (ev: { charIndex: number; charLength: number }) => {
            if (run.cancelled) return;
            // Convert char-index → word-index: count words whose
            // start <= charIndex. We rebuild the cumulative offset
            // table lazily on first boundary; the tokenize+offset
            // pass is O(N) and N is small (a Mem reply is ~30
            // words).
            const charIndex = ev?.charIndex ?? 0;
            let wordIdx = 0;
            let cursor = 0;
            for (let i = 0; i < words.length; i += 1) {
              const w = words[i]!;
              const found = text.indexOf(w, cursor);
              if (found < 0) break;
              if (found > charIndex) break;
              wordIdx = i + 1;
              cursor = found + w.length;
            }
            advanceWord(wordIdx);
            // Anchor the viseme stream to the spoken word so the
            // mouth shape stays in sync with the audio even when
            // word durations vary.
            const nextVisemeWord = Math.max(0, wordIdx - 1);
            if (nextVisemeWord !== run.visemeWordIdx) {
              run.visemeWordIdx = nextVisemeWord;
              run.visemeFrameIdx = 0;
            }
          },
          onDone: () => {
            if (run.cancelled) return;
            teardown(run, { fireDone: true });
            if (runRef.current === run) runRef.current = null;
          },
          onStopped: () => {
            // expo-speech fires onStopped when WE called stop().
            // The cancel path already handled teardown; do nothing.
          },
          onError: () => {
            if (run.cancelled) return;
            // Errors are non-fatal: snap the bubble to full text
            // and end the run so the screen isn't stuck "speaking".
            teardown(run, { fireDone: true });
            if (runRef.current === run) runRef.current = null;
          },
        });
      } catch {
        // Some devices throw synchronously when TTS is unavailable;
        // fall back to the timer-driven reveal we already started.
        // Nothing more to do here.
      }
    },
    [muted, fallbackWordsPerSecond, mutedWordsPerSecond, voice, teardown, mouthOpen],
  );

  // Tear down on unmount so we don't leak timers or leave audio
  // playing after the screen unmounts.
  useEffect(() => {
    return () => {
      const run = runRef.current;
      if (run) {
        run.cancelled = true;
        teardown(run, { fireDone: false });
        runRef.current = null;
      }
      void Speech.stop().catch(() => {});
    };
  }, [teardown]);

  // App backgrounding / inactive transitions must immediately stop
  // Mem (Task #294). On iOS, expo-speech keeps speaking even after
  // the user swipes home or routes to another tab — Mem would be
  // talking out of context with no visible chat. We use a ref to
  // the latest `stop` so the listener stays subscribed across
  // re-renders without re-registering. Resume on foreground does
  // NOT auto-restart speech: once the user has moved on, the reply
  // bubble is already snapped to full text and `stop()`'s `onDone`
  // has cleared the screen's streaming state.
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);
  useEffect(() => {
    const sub = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        if (state === "background" || state === "inactive") {
          stopRef.current();
        }
      },
    );
    return () => sub.remove();
  }, []);

  return { mouthOpen, viseme, speak, stop, isSpeaking };
}
