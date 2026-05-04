import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  AppState,
  type AppStateStatus,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { BrandHero } from "@/components/BrandHero";
import { useBreathingEnabled } from "@/lib/aliveUI";
import { DURATIONS, EASING } from "@/lib/animationTokens";

/**
 * AuthCinematicStage — Task #350.
 *
 * Owns the entire "Memora and Sagous step out of the Oc2cO universe"
 * choreography for the auth flow. Single timeline, single source of
 * truth: drift-in from the wings → small shared beat → settle into
 * the canonical yin/yang resting marks (Memora slightly left +
 * elevated, Sagous slightly right + forward — see BRAND.md).
 *
 * Modes:
 *   - "login"  → cinematic plays once per cold launch, then resting.
 *   - "signup" → same cinematic, plus a small Sagous "welcome" wave
 *                on settle (one-shot, reduce-motion-aware).
 *   - "forgot" → no cinematic, only the resting composition with
 *                Memora pulled forward and dimmed (softer / concerned).
 *
 * Per spec: tap-anywhere to skip, OS reduce-motion fallback, one-shot
 * per process via module-level state (NOT AsyncStorage), idle loops
 * pause when the keyboard is open.
 */

type Mode = "login" | "signup" | "forgot";

export type AuthCinematicStageHandle = {
  /**
   * Imperatively end the cinematic (used by the full-screen
   * tap-to-skip overlay in login.tsx). Idempotent: subsequent calls
   * after the cinematic has already settled are no-ops.
   */
  skip: () => void;
};

type Props = {
  mode?: Mode;
  /** Fires once the cinematic has settled (or immediately if skipped). */
  onSettle?: () => void;
  /**
   * When true (e.g. while the keyboard is open) idle loops pause so
   * input is never visually contested.
   */
  paused?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

// ---------------------------------------------------------------------------
// One-shot per cold launch — module-level so it resets on a real process
// kill but persists across tab-aways within the same session.
// ---------------------------------------------------------------------------

let cinematicPlayedThisSession = false;
// Signup welcome-wave is also one-shot per process so toggling
// login↔signup or paused↔unpaused after the first settle never replays
// the wave (caught in code review).
let signupWavePlayedThisSession = false;

/** Test-only: clears the per-process "played" flags. */
export function _resetAuthCinematicForTests(): void {
  cinematicPlayedThisSession = false;
  signupWavePlayedThisSession = false;
}

/** Inspector for tests so we can assert the no-replay-in-session contract. */
export function _hasAuthCinematicPlayedForTests(): boolean {
  return cinematicPlayedThisSession;
}

const IS_WEB = Platform.OS === "web";

// Choreography timings (in ms) — keep the total under ~3.5s per spec.
// DRIFT/BEAT/SETTLE/REDUCED_FADE durations are choreography-locked at
// non-token values: they were tuned against the BRAND.md storyboard
// and the composer's haptic cues, so they MUST NOT be replaced with
// the generic DURATIONS scale even though the magnitudes are similar.
// SKIP_FADE is an OS-style short cross-fade and IS pulled from
// DURATIONS.base so it tracks the global token if it ever moves.
const DRIFT_DURATION = 1100;
const BEAT_DURATION = 700;
const SETTLE_DURATION = 700;
const REDUCED_FADE = 250;
const SKIP_FADE = DURATIONS.base;

export const AuthCinematicStage = forwardRef<
  AuthCinematicStageHandle,
  Props
>(function AuthCinematicStage(
  { mode = "login", onSettle, paused = false, height = 240, style },
  ref,
) {
  const breathingEnabled = useBreathingEnabled();
  // `null` = not yet resolved. We default to "reduced" while we wait
  // so users with reduce-motion enabled never see a frame of the full
  // cinematic on first mount (race fix from code review).
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(
    IS_WEB ? false : null,
  );
  const [skipped, setSkipped] = useState(false);
  // Tracks whether the app is currently backgrounded. When true the
  // resting idle loops pause (same plumbing as the keyboard `paused`
  // prop) so we don't waste Reanimated frames while the user is away
  // and the cinematic doesn't "skip ahead" on resume.
  const [appBackgrounded, setAppBackgrounded] = useState(false);
  // Drive "settled" with React state so the resting alive-loop effect
  // actually re-runs once the cinematic finishes. (A pure ref wouldn't
  // trigger a re-render and the breathing/spark loops would never
  // start — caught in code review.)
  const [settled, setSettled] = useState(false);
  const settledRef = useRef(false);

  // Whether to play the cinematic on this mount. Forgot-password skips
  // entirely; everything else replays only on a true cold launch.
  const shouldPlayCinematic =
    mode !== "forgot" && !cinematicPlayedThisSession;

  // Shared values driving the timeline. Starting offsets put the
  // characters off-screen left/right; settle targets are the canonical
  // yin/yang resting marks from BRAND.md (Memora upper-left, Sagous
  // lower-right).
  const memX = useSharedValue(shouldPlayCinematic ? -160 : -28);
  const memY = useSharedValue(shouldPlayCinematic ? 0 : -10);
  const memOpacity = useSharedValue(shouldPlayCinematic ? 0 : 1);
  const memGlow = useSharedValue(0.6);
  const memScale = useSharedValue(1);

  const sagX = useSharedValue(shouldPlayCinematic ? 160 : 28);
  const sagY = useSharedValue(shouldPlayCinematic ? 0 : 6);
  const sagOpacity = useSharedValue(shouldPlayCinematic ? 0 : 1);
  const sagSpark = useSharedValue(0.6);
  const sagWave = useSharedValue(0);

  // Subscribe to AppState so backgrounding the app pauses idle loops
  // and foregrounding resumes them at the correct phase.
  useEffect(() => {
    if (IS_WEB) return;
    const handle = (state: AppStateStatus): void => {
      // Treat anything explicitly non-active (background/inactive) as
      // paused. Unknown/undefined is treated as active so the cinematic
      // never stalls in environments where AppState.currentState isn't
      // populated yet (e.g. unit tests, very early mount).
      setAppBackgrounded(state === "background" || state === "inactive");
    };
    const sub = AppState.addEventListener("change", handle);
    // Seed from the current state in case we mounted while inactive.
    handle(AppState.currentState);
    return () => {
      sub.remove();
    };
  }, []);

  // Read OS reduce-motion preference once on mount + listen for changes.
  useEffect(() => {
    if (IS_WEB) return;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((rm) => {
        if (!cancelled) setReduceMotion(rm);
      })
      .catch(() => {
        // Safe fallback: if the accessibility query rejects we MUST
        // unblock the timeline (otherwise onSettle never fires and
        // the form fade-up stalls). Default to "no reduce-motion".
        if (!cancelled) setReduceMotion(false);
      });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (rm) => setReduceMotion(rm),
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // Mark the cinematic settled — fire onSettle exactly once and flip
  // the per-process flag so subsequent mounts skip the open.
  const markSettled = (): void => {
    if (settledRef.current) return;
    settledRef.current = true;
    setSettled(true);
    // Only the login/signup cinematic counts toward the per-process
    // "already played" flag. Forgot-password never replays the open
    // and must never block the next login mount from doing so.
    if (shouldPlayCinematic) {
      cinematicPlayedThisSession = true;
    }
    onSettle?.();
  };

  // Tracks how much of the cinematic timeline has actually elapsed
  // while the app was foregrounded. Backgrounding freezes both shared
  // values (via cancelAnimation) and this counter, so on resume the
  // remaining drift/beat/settle phases continue from the correct phase
  // instead of skipping ahead.
  const elapsedRef = useRef(0);
  const lastStartRef = useRef<number | null>(null);

  // Main timeline. Runs once per mount; the `skipped` / reduce-motion
  // branches collapse the cinematic to a fade-in. AppState background
  // pauses the timeline and resume continues from the same phase.
  useEffect(() => {
    // Wait for the OS reduce-motion preference to resolve before
    // starting any motion. This prevents a flash of the full
    // cinematic on cold launch when the user has reduce-motion on.
    if (reduceMotion === null) return;

    if (!shouldPlayCinematic) {
      // Forgot-password (and any returning-in-session render) starts
      // already at the resting marks. Fade up gently and signal settle.
      memOpacity.value = withTiming(1, { duration: REDUCED_FADE });
      sagOpacity.value = withTiming(1, { duration: REDUCED_FADE });
      const t = setTimeout(markSettled, REDUCED_FADE);
      return () => clearTimeout(t);
    }

    if (reduceMotion) {
      // Reduce-motion contract: NO drift, NO flicker, NO pulse.
      // Snap positions to resting and only fade opacity in.
      memX.value = -28;
      memY.value = -10;
      sagX.value = 28;
      sagY.value = 6;
      memOpacity.value = withTiming(1, { duration: REDUCED_FADE });
      sagOpacity.value = withTiming(1, { duration: REDUCED_FADE });
      const t = setTimeout(markSettled, REDUCED_FADE);
      return () => clearTimeout(t);
    }

    if (skipped) {
      // Tap-to-skip: short cross-fade from wherever the timeline was.
      const dur = SKIP_FADE;
      memX.value = withTiming(-28, { duration: dur });
      memY.value = withTiming(-10, { duration: dur });
      memOpacity.value = withTiming(1, { duration: dur });
      sagX.value = withTiming(28, { duration: dur });
      sagY.value = withTiming(6, { duration: dur });
      sagOpacity.value = withTiming(1, { duration: dur });
      const t = setTimeout(markSettled, dur);
      return () => clearTimeout(t);
    }

    if (appBackgrounded) {
      // Pause: capture elapsed, freeze every in-flight shared value
      // exactly where it is, and let the cleanup below drop the settle
      // timer. The next foreground transition re-runs this effect on
      // the resume branch below and continues from the same phase.
      if (lastStartRef.current !== null) {
        elapsedRef.current += Date.now() - lastStartRef.current;
        lastStartRef.current = null;
      }
      cancelAnimation(memX);
      cancelAnimation(memY);
      cancelAnimation(memOpacity);
      cancelAnimation(memScale);
      cancelAnimation(sagX);
      cancelAnimation(sagY);
      cancelAnimation(sagOpacity);
      cancelAnimation(sagSpark);
      return;
    }

    // Full cinematic — compute remaining slice of each phase based
    // on how much real foreground time has already been spent on the
    // timeline. Phases that have already finished are no-ops; phases
    // mid-flight resume from the current shared-value position.
    const easeOut = EASING.out;
    const easeInOut = EASING.default;
    const elapsed = elapsedRef.current;
    lastStartRef.current = Date.now();

    const remainOf = (
      start: number,
      dur: number,
    ): { delay: number; duration: number } | null => {
      const end = start + dur;
      if (elapsed >= end) return null;
      const delay = Math.max(0, start - elapsed);
      const duration = end - Math.max(elapsed, start);
      return { delay, duration };
    };

    // Opacity fade-in (runs alongside the drift).
    const fadeP = remainOf(0, 350);
    if (fadeP) {
      memOpacity.value = withDelay(
        fadeP.delay,
        withTiming(1, { duration: fadeP.duration }),
      );
      sagOpacity.value = withDelay(
        fadeP.delay,
        withTiming(1, { duration: fadeP.duration }),
      );
    } else {
      memOpacity.value = 1;
      sagOpacity.value = 1;
    }

    // 1. Drift in from the wings.
    const driftP = remainOf(0, DRIFT_DURATION);
    if (driftP) {
      memX.value = withDelay(
        driftP.delay,
        withTiming(-12, { duration: driftP.duration, easing: easeOut }),
      );
      sagX.value = withDelay(
        driftP.delay,
        withTiming(12, { duration: driftP.duration, easing: easeOut }),
      );
    }

    // 2. Small shared beat — Sagous flickers brighter once, Memora
    //    gives a calm look (subtle scale up). The full sequence is
    //    short enough (~700ms) that re-issuing it on a mid-beat
    //    resume reads as a continuation rather than a restart.
    const beatP = remainOf(DRIFT_DURATION, BEAT_DURATION);
    if (beatP) {
      sagSpark.value = withDelay(
        beatP.delay,
        withSequence(
          withTiming(1, { duration: BEAT_DURATION / 2, easing: easeInOut }),
          withTiming(0.7, { duration: BEAT_DURATION / 2, easing: easeInOut }),
        ),
      );
      memScale.value = withDelay(
        beatP.delay,
        withSequence(
          withTiming(1.04, { duration: BEAT_DURATION / 2, easing: easeInOut }),
          withTiming(1, { duration: BEAT_DURATION / 2, easing: easeInOut }),
        ),
      );
    }

    // 3. Settle to canonical resting marks.
    const settleStart = DRIFT_DURATION + BEAT_DURATION;
    const settleP = remainOf(settleStart, SETTLE_DURATION);
    if (settleP) {
      memX.value = withDelay(
        settleP.delay,
        withTiming(-28, { duration: settleP.duration, easing: easeInOut }),
      );
      memY.value = withDelay(
        settleP.delay,
        withTiming(-10, { duration: settleP.duration, easing: easeInOut }),
      );
      sagX.value = withDelay(
        settleP.delay,
        withTiming(28, { duration: settleP.duration, easing: easeInOut }),
      );
      sagY.value = withDelay(
        settleP.delay,
        withTiming(6, { duration: settleP.duration, easing: easeInOut }),
      );
    }

    const total = settleStart + SETTLE_DURATION;
    const remaining = Math.max(0, total - elapsed);
    const t = setTimeout(markSettled, remaining);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, skipped, shouldPlayCinematic, appBackgrounded]);

  // Resting "alive" loop: Memora breathes (subtle scale + glow),
  // Sagous's spark flickers on a slow random-feeling cadence. Both
  // pause when the keyboard is open or motion is disabled, and the
  // signup-only welcome wave fires on settle.
  useEffect(() => {
    if (!settled) return; // wait until cinematic ends
    const allowMotion =
      breathingEnabled &&
      reduceMotion === false &&
      !paused &&
      !appBackgrounded &&
      !IS_WEB;

    cancelAnimation(memGlow);
    cancelAnimation(sagSpark);
    cancelAnimation(sagWave);

    if (!allowMotion) {
      memGlow.value = withTiming(0.6, { duration: 200 });
      sagSpark.value = withTiming(0.7, { duration: 200 });
      sagWave.value = withTiming(0, { duration: 200 });
      return;
    }

    memGlow.value = withRepeat(
      withSequence(
        withTiming(0.85, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.55, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    sagSpark.value = withRepeat(
      withSequence(
        withTiming(1.0, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.55, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );

    if (mode === "signup" && !signupWavePlayedThisSession) {
      // Small "welcome" wave — one shot, ~600ms. The module-level
      // guard means toggling login↔signup or paused↔unpaused after
      // the first settle does NOT replay the wave (caught in code
      // review).
      signupWavePlayedThisSession = true;
      sagWave.value = withSequence(
        withTiming(1, { duration: 220, easing: EASING.out }),
        withTiming(-0.7, { duration: 200, easing: EASING.default }),
        withTiming(0.4, { duration: 200, easing: EASING.default }),
        withTiming(0, { duration: 200, easing: EASING.in }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breathingEnabled, reduceMotion, paused, appBackgrounded, mode, settled]);

  const handleSkip = (): void => {
    if (settledRef.current) return;
    // Flip the per-process one-shot flag synchronously so that even
    // if the user navigates away before SKIP_FADE elapses, the next
    // mount this session correctly skips the open (caught in code
    // review). Forgot-mode never burns the flag.
    if (shouldPlayCinematic) {
      cinematicPlayedThisSession = true;
    }
    setSkipped(true);
  };

  // Imperative skip — used by the full-screen tap-to-skip overlay in
  // login.tsx so taps OUTSIDE the stage bounds drive the same skip
  // pathway (collapsing the timeline, marking played) instead of
  // letting the stage's internal timer keep running.
  useImperativeHandle(ref, () => ({ skip: handleSkip }), [
    shouldPlayCinematic,
  ]);

  // ---- Animated styles ---------------------------------------------------
  const memWrapStyle = useAnimatedStyle(() => ({
    opacity: memOpacity.value,
    transform: [
      { translateX: memX.value },
      { translateY: memY.value },
      { scale: memScale.value },
    ],
  }));
  const memGlowStyle = useAnimatedStyle(() => ({
    opacity: memGlow.value,
    transform: [{ scale: 0.95 + memGlow.value * 0.25 }],
  }));
  const sagWrapStyle = useAnimatedStyle(() => ({
    opacity: sagOpacity.value,
    transform: [
      { translateX: sagX.value },
      { translateY: sagY.value },
      { rotate: `${sagWave.value * 14}deg` },
    ],
  }));
  const sagSparkStyle = useAnimatedStyle(() => ({
    opacity: sagSpark.value,
    transform: [{ scale: 0.9 + sagSpark.value * 0.3 }],
  }));

  // Forgot-password gets a smaller, dimmer Memora — softer expression
  // is provided by the underlying art (Memora dark-variant) plus the
  // reduced glow.
  const characterSize = mode === "forgot" ? 140 : 180;
  const memVariant = mode === "forgot" ? "memora-fullbody-dark" : "memora-fullbody";

  return (
    <Pressable
      onPress={handleSkip}
      accessibilityRole="button"
      accessibilityLabel={
        shouldPlayCinematic && !settledRef.current
          ? "Skip intro animation"
          : undefined
      }
      style={[styles.container, { height }, style]}
      testID="auth-cinematic-stage"
    >
      {/* Memora — left side, slightly elevated */}
      <Animated.View style={[styles.memSlot, memWrapStyle]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              width: characterSize * 1.3,
              height: characterSize * 1.3,
              borderRadius: characterSize * 0.65,
              backgroundColor: "#7ec8ff",
            },
            memGlowStyle,
          ]}
        />
        <BrandHero variant={memVariant} size={characterSize} decorative />
      </Animated.View>

      {/* Sagous — right side, slightly forward (skipped on forgot) */}
      {mode !== "forgot" && (
        <Animated.View style={[styles.sagSlot, sagWrapStyle]}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.glow,
              {
                width: characterSize * 1.1,
                height: characterSize * 1.1,
                borderRadius: characterSize * 0.55,
                backgroundColor: "#ffb74d",
              },
              sagSparkStyle,
            ]}
          />
          <BrandHero variant="sagous-fullbody" size={characterSize} decorative />
        </Animated.View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  memSlot: {
    position: "absolute",
    left: "18%",
    top: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  sagSlot: {
    position: "absolute",
    right: "18%",
    top: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  glow: {
    position: "absolute",
    opacity: 0.4,
  },
});
