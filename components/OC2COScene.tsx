import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, Image, StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { Memora } from "./Memora";
import { useMemSpeech } from "@/lib/useMemSpeech";

/**
 * OC2COScene — the **programmatic, re-renderable** OC2CO splash
 * (Task #334). Replaces the legacy yellow-blob intro and the
 * pre-baked `intro.mp4`. Builds the full "Organized Chaos →
 * Chaos Organized" arc live in React Native so it can be tweaked,
 * re-skinned, or A/B tested without re-rendering a video file.
 *
 * Beats (≈18s total):
 *   1. Chaos (0–4s)     — 14 glyph particles tumble across the
 *                          screen, off-axis. Sagous (the playful
 *                          chaos avatar) drifts in from the left.
 *   2. Encounter (4–7s) — Memora rises from the right; the two
 *                          characters lock eyes mid-stage.
 *   3. Fusion (7–11s)   — yin-yang ring forms between them; the
 *                          glyphs spiral inward and snap into a
 *                          tidy grid behind them.
 *   4. Tagline (11–18s) — Memora speaks the brand tagline aloud
 *                          (audio only — **no on-screen text
 *                          overlays**) with **true viseme
 *                          lip-sync** via `useMemSpeech` →
 *                          `<Memora viseme={...} />`. Meaning is
 *                          carried by characters + motion +
 *                          spoken voice; nothing is drawn as
 *                          captions or headlines inside the scene.
 *
 * Calls `onComplete` once Memora finishes the tagline so the host
 * screen can auto-dismiss.
 */

const TAGLINE = "Out of chaos, one calm thought.";

const GLYPHS = ["✦", "◆", "▲", "◯", "✶", "△", "✧", "◇", "▽", "✺", "◐", "❖", "✱", "❉"] as const;

interface OC2COSceneProps {
  onComplete?: () => void;
  muted?: boolean;
  /**
   * When true, freezes the scene's beat scheduler and silences any
   * in-flight tagline VO so the host screen's tap-to-pause overlay
   * matches reality. Toggling back to false resumes from the same
   * elapsed offset (Task #345).
   */
  paused?: boolean;
}

// Beat schedule in ms from scene start.
const BEAT_SCHEDULE: Array<{ at: number; beat: 1 | 2 | 3 }> = [
  { at: 4000, beat: 1 },
  { at: 7000, beat: 2 },
  { at: 11000, beat: 3 },
];

export function OC2COScene({ onComplete, muted = false, paused = false }: OC2COSceneProps) {
  const { width, height } = Dimensions.get("window");

  // Beat orchestrator (0..3 inclusive). Drives high-level fades.
  const [beat, setBeat] = useState<0 | 1 | 2 | 3>(0);
  const [tone, setTone] = useState<"thinking" | "happy" | "celebrate">("thinking");

  const speech = useMemSpeech({ muted });

  // Track elapsed scene time across pause/resume so beat 3's tagline
  // and the post-tagline auto-dismiss continue from where they were.
  const elapsedRef = useRef(0);
  const lastResumeRef = useRef<number | null>(null);
  const firedBeatsRef = useRef<Set<1 | 2 | 3>>(new Set());
  const taglineDoneRef = useRef(false);
  // Wall-clock at which the post-tagline auto-close should fire. Used
  // so a pause during the 1.4s hold can re-arm with the remaining time
  // on resume rather than dropping the auto-dismiss.
  const closeAtRef = useRef<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beatTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  // Latest callbacks pinned in refs so the pause/resume effect can
  // re-arm timers without re-subscribing to caller-controlled props.
  const onCompleteRef = useRef(onComplete);
  const speechRef = useRef(speech);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    speechRef.current = speech;
  }, [speech]);

  useEffect(() => {
    const clearBeatTimers = () => {
      beatTimersRef.current.forEach(clearTimeout);
      beatTimersRef.current = [];
    };

    if (paused) {
      // Snapshot elapsed and tear down anything pending so the scene
      // truly stops progressing while the user holds it.
      if (lastResumeRef.current != null) {
        elapsedRef.current += Date.now() - lastResumeRef.current;
        lastResumeRef.current = null;
      }
      clearBeatTimers();
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
        // Keep `closeAtRef` so resume can re-arm with the remaining
        // hold time instead of dropping the auto-dismiss entirely.
      }
      void speechRef.current.stop();
      return;
    }

    // (Re-)start the wall clock for this run segment.
    lastResumeRef.current = Date.now();

    const armCloseHold = (durationMs: number) => {
      closeAtRef.current = Date.now() + durationMs;
      closeTimerRef.current = setTimeout(() => {
        closeAtRef.current = null;
        onCompleteRef.current?.();
      }, durationMs);
    };

    const fireBeat3 = () => {
      setBeat(3);
      setTone("happy");
      // If the tagline already finished in a previous run segment we
      // skip straight to the close hold.
      if (taglineDoneRef.current) {
        setTone("celebrate");
        armCloseHold(1400);
        return;
      }
      speechRef.current.speak(TAGLINE, {
        onDone: () => {
          taglineDoneRef.current = true;
          setTone("celebrate");
          armCloseHold(1400);
        },
      });
    };

    // If a pause interrupted the post-tagline auto-dismiss hold, resume
    // with the remaining time so the screen still closes itself.
    if (taglineDoneRef.current && closeAtRef.current != null) {
      setTone("celebrate");
      const remaining = Math.max(0, closeAtRef.current - Date.now());
      // Replace stale wall-clock target; armCloseHold sets a fresh one.
      closeAtRef.current = null;
      armCloseHold(remaining);
    } else if (firedBeatsRef.current.has(3) && !taglineDoneRef.current) {
      // Beat 3 fired previously but the tagline VO was cut short by a
      // pause — re-speak so the scene can finish and auto-dismiss.
      fireBeat3();
    }

    for (const { at, beat: b } of BEAT_SCHEDULE) {
      if (firedBeatsRef.current.has(b)) continue;
      const remaining = Math.max(0, at - elapsedRef.current);
      const timer = setTimeout(() => {
        firedBeatsRef.current.add(b);
        if (b === 3) {
          fireBeat3();
        } else {
          setBeat(b);
        }
      }, remaining);
      beatTimersRef.current.push(timer);
    }

    return () => {
      clearBeatTimers();
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      void speechRef.current.stop();
    };
  }, [paused]);

  return (
    <View style={[styles.root, { width, height }]} accessibilityRole="summary">
      <BackgroundGradient beat={beat} />
      <ChaosField beat={beat} count={14} />
      <YinYangFusion beat={beat} size={Math.min(width * 0.42, 280)} />

      <View style={styles.stage} pointerEvents="none">
        <Sagous beat={beat} size={Math.min(width * 0.32, 180)} />
        <View style={{ width: Math.min(width * 0.36, 200) }}>
          <Memora
            size={Math.min(width * 0.38, 220)}
            mood={tone}
            mouthOpen={speech.mouthOpen}
            viseme={speech.viseme}
            color="#B47AFF"
          />
        </View>
      </View>

    </View>
  );
}

function BackgroundGradient({ beat }: { beat: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(beat, { duration: 900, easing: Easing.inOut(Easing.cubic) });
  }, [beat, t]);
  const style = useAnimatedStyle(() => {
    const hue = interpolate(t.value, [0, 1, 2, 3], [0.35, 0.55, 0.75, 1.0]);
    return {
      opacity: 1,
      backgroundColor: `hsl(${260 + hue * 30}, 55%, ${6 + hue * 4}%)`,
    };
  });
  return <Animated.View style={[StyleSheet.absoluteFill, style]} />;
}

function ChaosField({ beat, count }: { beat: number; count: number }) {
  const { width, height } = Dimensions.get("window");
  // Stable per-particle random params for the run.
  const params = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        glyph: GLYPHS[i % GLYPHS.length],
        startX: Math.random() * width,
        startY: Math.random() * height,
        targetX: width * (0.18 + (i / count) * 0.64),
        targetY: height * (0.22 + ((i * 53) % 6) * 0.04),
        size: 14 + Math.random() * 16,
        delay: i * 60,
      })),
    [count, width, height],
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {params.map((p, idx) => (
        <Glyph key={idx} {...p} beat={beat} />
      ))}
    </View>
  );
}

function Glyph({
  glyph,
  startX,
  startY,
  targetX,
  targetY,
  size,
  delay,
  beat,
}: {
  glyph: string;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  size: number;
  delay: number;
  beat: number;
}) {
  const x = useSharedValue(startX);
  const y = useSharedValue(startY);
  const rot = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (beat === 0) {
      // Chaos: tumble around starting positions.
      opacity.value = withDelay(delay, withTiming(1, { duration: 600 }));
      rot.value = withRepeat(
        withTiming(360, { duration: 4000, easing: Easing.linear }),
        -1,
        false,
      );
      x.value = withRepeat(
        withSequence(
          withTiming(startX + 30, { duration: 1200 }),
          withTiming(startX - 30, { duration: 1200 }),
        ),
        -1,
        true,
      );
      y.value = withRepeat(
        withSequence(
          withTiming(startY + 20, { duration: 900 }),
          withTiming(startY - 20, { duration: 900 }),
        ),
        -1,
        true,
      );
    } else if (beat >= 2) {
      // Fusion: spiral into tidy grid behind the characters.
      x.value = withTiming(targetX, { duration: 1100, easing: Easing.out(Easing.cubic) });
      y.value = withTiming(targetY, { duration: 1100, easing: Easing.out(Easing.cubic) });
      rot.value = withTiming(0, { duration: 1100 });
      opacity.value = withTiming(0.4, { duration: 800 });
    }
  }, [beat, delay, startX, startY, targetX, targetY, opacity, rot, x, y]);

  const style = useAnimatedStyle(() => ({
    position: "absolute",
    left: x.value,
    top: y.value,
    opacity: opacity.value,
    transform: [{ rotate: `${rot.value}deg` }],
  }));

  return (
    <Animated.Text style={[{ color: "#B47AFF", fontSize: size }, style]}>{glyph}</Animated.Text>
  );
}

function Sagous({ beat, size }: { beat: number; size: number }) {
  const tx = useSharedValue(-200);
  const opacity = useSharedValue(0);
  const wobble = useSharedValue(0);

  useEffect(() => {
    if (beat >= 1) {
      tx.value = withSpring(0, { damping: 9, stiffness: 90 });
      opacity.value = withTiming(1, { duration: 700 });
      wobble.value = withRepeat(
        withSequence(
          withTiming(4, { duration: 700 }),
          withTiming(-4, { duration: 700 }),
        ),
        -1,
        true,
      );
    }
    if (beat >= 3) {
      // Lean toward Memora during tagline.
      tx.value = withTiming(20, { duration: 800 });
    }
  }, [beat, tx, opacity, wobble]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: tx.value }, { rotate: `${wobble.value}deg` }],
  }));

  return (
    <Animated.View style={[{ width: size, height: size }, style]}>
      <Image
        source={require("@/assets/brand/oc2co-fullbody.png")}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

function YinYangFusion({ beat, size }: { beat: number; size: number }) {
  const { width, height } = Dimensions.get("window");
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.4);
  const rot = useSharedValue(0);
  useEffect(() => {
    if (beat >= 2) {
      opacity.value = withTiming(0.85, { duration: 900 });
      scale.value = withSpring(1, { damping: 8, stiffness: 80 });
      rot.value = withRepeat(
        withTiming(360, { duration: 14000, easing: Easing.linear }),
        -1,
        false,
      );
    }
  }, [beat, opacity, scale, rot]);
  const style = useAnimatedStyle(() => ({
    position: "absolute",
    left: width / 2 - size / 2,
    top: height / 2 - size / 2 - 20,
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { rotate: `${rot.value}deg` }],
  }));
  return (
    <Animated.View pointerEvents="none" style={style}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={48} stroke="#E5D8FF" strokeWidth={1.5} fill="none" />
        <Path d="M50 2 A48 48 0 0 1 50 98 A24 24 0 0 1 50 50 A24 24 0 0 0 50 2 Z" fill="#E5D8FF" />
        <Circle cx={50} cy={26} r={6} fill="#1a0a26" />
        <Circle cx={50} cy={74} r={6} fill="#E5D8FF" />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#0a0612",
    overflow: "hidden",
  },
  stage: {
    position: "absolute",
    top: "30%",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },
});
