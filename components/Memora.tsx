import React, { useEffect, useMemo } from "react";
import { Image, View } from "react-native";
import Svg, { Ellipse, Path, Rect } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/**
 * Memora — the photo-real character that replaces the legacy yellow
 * blob `MemCharacter`. Renders the brand hero art (transparent
 * background) and layers in:
 *   - a gentle breathing scale loop (idle "alive" cue),
 *   - an expression sprite swap for each mood (calm / smile /
 *     thinking / proud / listening / aha) so her face actually
 *     reflects what she's saying,
 *   - a soft chest-logo halo that pulses with `mouthOpen`,
 *   - **true viseme lip-sync**: an SVG mouth overlay positioned
 *     over the photo's mouth, morphing between 7 viseme states
 *     (rest, MBP, AI, E, O, U, FV) driven by the `viseme` shared
 *     value from `useMemSpeech`. When `viseme` isn't supplied we
 *     fall back to deriving a viseme cycle from `mouthOpen`
 *     amplitude so the legacy amplitude-only path still animates.
 *   - sentiment-driven particle pop (sparkles for celebrate,
 *     hearts for happy / supportive) tied to mood,
 *   - chromatic-glow ring around her chest yin-yang on emphasis.
 *
 * Viseme indexing (kept stable so `useMemSpeech` and any test
 * fixtures can target shapes by integer code):
 *   0 = rest (lips together, neutral)
 *   1 = MBP / closed (lips pressed)
 *   2 = AI  (jaw open, wide)
 *   3 = E   (smile-open, lips pulled back)
 *   4 = O   (medium round)
 *   5 = U   (small puckered round)
 *   6 = FV  (lower lip tucked under teeth)
 *
 * The component is API-compatible with the legacy `MemCharacter`
 * (size / mood / expression / mouthOpen / color / eyeColor) so
 * every existing call site renders Memora with no signature
 * change. `MemCharacter.tsx` re-exports from here.
 */

type Mood = "idle" | "happy" | "thinking" | "celebrate";

export type MemExpression =
  | "calm"
  | "happy"
  | "sad"
  | "anxious"
  | "neutral"
  | "celebrate"
  | "thinking"
  // Companion-state vocabulary (Task #340). Aliases / soft variants
  // of the original set so callers can pass `expression="curious"`
  // directly. None ever read as punitive — `concerned` pulls from
  // the listening sprite and stays soft, `waiting` is calm with a
  // tiny questioning brow rather than disappointed.
  | "curious"
  | "resting"
  | "thoughtful"
  | "celebrating"
  | "waiting"
  | "concerned"
  | "glowing";

export type VisemeKey = "rest" | "MBP" | "AI" | "E" | "O" | "U" | "FV";

export const VISEME_INDEX: Record<VisemeKey, number> = {
  rest: 0,
  MBP: 1,
  AI: 2,
  E: 3,
  O: 4,
  U: 5,
  FV: 6,
};

export interface MemoraProps {
  size?: number;
  mood?: Mood;
  expression?: MemExpression;
  mouthOpen?: SharedValue<number>;
  /**
   * Optional viseme stream from `useMemSpeech`. Each tick is the
   * integer viseme code (see `VISEME_INDEX`). When omitted, the
   * mouth overlay derives a coarse viseme cycle from `mouthOpen`
   * amplitude so amplitude-only call sites still get visible
   * mouth-shape changes.
   */
  viseme?: SharedValue<number>;
  color?: string;
  eyeColor?: string;
}

const SOURCES = {
  calm: require("@/assets/brand/memora-expr-calm.png"),
  smile: require("@/assets/brand/memora-expr-smile.png"),
  thinking: require("@/assets/brand/memora-expr-thinking.png"),
  proud: require("@/assets/brand/memora-expr-proud.png"),
  listening: require("@/assets/brand/memora-expr-listening.png"),
  aha: require("@/assets/brand/memora-expr-aha.png"),
} as const;

type SpriteKey = keyof typeof SOURCES;

function deriveExpression(mood: Mood): MemExpression {
  switch (mood) {
    case "happy":
      return "happy";
    case "thinking":
      return "thinking";
    case "celebrate":
      return "celebrate";
    case "idle":
    default:
      return "calm";
  }
}

function spriteFor(expr: MemExpression): SpriteKey {
  switch (expr) {
    case "happy":
      return "smile";
    case "celebrate":
    case "celebrating":
      return "proud";
    case "thinking":
    case "thoughtful":
      return "thinking";
    case "anxious":
    case "concerned":
      return "listening";
    case "curious":
    case "waiting":
      return "aha";
    case "glowing":
      return "smile";
    case "resting":
      return "calm";
    case "sad":
      return "calm";
    case "neutral":
      return "calm";
    case "calm":
    default:
      return "calm";
  }
}

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * Geometry per viseme, expressed as fractions of the mouth-overlay
 * box (which is itself sized as a fraction of the head). Width and
 * height are 0..1 of the box; cornerY shifts the lower-lip Path's
 * curve for FV and U.
 */
const VISEME_GEOMETRY: Record<
  number,
  { rx: number; ry: number; smile: number; lowerLip: number }
> = {
  0: { rx: 0.42, ry: 0.04, smile: 0.0, lowerLip: 0.0 }, // rest
  1: { rx: 0.38, ry: 0.03, smile: -0.02, lowerLip: 0.0 }, // MBP
  2: { rx: 0.36, ry: 0.34, smile: 0.0, lowerLip: 0.0 }, // AI wide open
  3: { rx: 0.46, ry: 0.18, smile: 0.06, lowerLip: 0.0 }, // E smile-open
  4: { rx: 0.22, ry: 0.22, smile: 0.0, lowerLip: 0.0 }, // O round
  5: { rx: 0.14, ry: 0.16, smile: 0.0, lowerLip: 0.0 }, // U small round
  6: { rx: 0.34, ry: 0.06, smile: 0.0, lowerLip: 0.18 }, // FV
};

export function Memora({
  size = 160,
  mood = "idle",
  expression,
  mouthOpen,
  viseme,
  color = "#B47AFF",
}: MemoraProps) {
  const resolved = expression ?? deriveExpression(mood);
  const sprite = spriteFor(resolved);

  const breath = useSharedValue(1);
  const wobble = useSharedValue(0);
  const sparkle = useSharedValue(0);
  // Mirror of mouthOpen on UI thread so we can drive several styles
  // without re-subscribing each one.
  const speak = useSharedValue(0);
  const restingMouth = useSharedValue(0);
  const restingViseme = useSharedValue(0);
  const mouthSource = mouthOpen ?? restingMouth;

  // Smoothly interpolated viseme code on the UI thread. We take
  // either the explicit `viseme` stream from `useMemSpeech` or fall
  // back to deriving a 4-state cycle from amplitude so amplitude-
  // only callers still see real shape changes (rest → MBP → AI → E).
  const visemeShared = useDerivedValue(() => {
    if (viseme) return viseme.value;
    const open = Math.max(0, Math.min(1, mouthSource.value));
    if (open < 0.08) return 0; // rest
    if (open < 0.25) return 1; // MBP
    if (open < 0.55) return 3; // E
    return 2; // AI
    // We deliberately don't cycle through O/U/FV from amplitude
    // alone — those visemes come from the phoneme heuristic.
  }, [viseme, mouthSource]);

  // Smoothed viseme channel for shape morphing — avoids the mouth
  // snapping between integer states. Reanimated will lerp this on
  // the UI thread at 60fps.
  const visemeSmooth = useSharedValue(0);
  useAnimatedReaction(
    () => visemeShared.value,
    (next) => {
      visemeSmooth.value = withTiming(next, {
        duration: 70,
        easing: Easing.inOut(Easing.quad),
      });
    },
    [visemeShared],
  );

  useAnimatedReaction(
    () => mouthSource.value,
    (v) => {
      speak.value = v;
    },
    [mouthSource],
  );

  // Idle breathing loop — barely perceptible scale so she feels alive
  // without bouncing distractingly.
  useEffect(() => {
    breath.value = withRepeat(
      withSequence(
        withTiming(1.025, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.985, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [breath]);

  // Mood-driven accents (kept compatible with the legacy
  // MemCharacter behavior).
  useEffect(() => {
    if (mood === "happy") {
      wobble.value = withSequence(
        withTiming(-6, { duration: 180 }),
        withTiming(6, { duration: 180 }),
        withTiming(-3, { duration: 140 }),
        withTiming(0, { duration: 140 }),
      );
    } else if (mood === "celebrate") {
      sparkle.value = withRepeat(
        withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }),
        -1,
        true,
      );
      wobble.value = withRepeat(
        withSequence(
          withDelay(0, withSpring(-8, { damping: 6, stiffness: 220 })),
          withSpring(0, { damping: 8, stiffness: 220 }),
        ),
        -1,
        false,
      );
    } else if (mood === "thinking") {
      wobble.value = withRepeat(
        withSequence(
          withTiming(2, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(-2, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      );
    }
  }, [mood, wobble, sparkle]);

  const bodyAnim = useAnimatedStyle(() => {
    const open = Math.max(0, Math.min(1, speak.value));
    return {
      transform: [
        { scale: breath.value },
        { translateY: open * 1.5 },
        { rotate: `${wobble.value}deg` },
      ],
    };
  });

  const haloAnim = useAnimatedStyle(() => {
    const open = Math.max(0, Math.min(1, speak.value));
    return {
      opacity: 0.18 + open * 0.5,
      transform: [{ scale: 0.92 + open * 0.18 }],
    };
  });

  const chestGlowAnim = useAnimatedStyle(() => {
    const open = Math.max(0, Math.min(1, speak.value));
    return {
      opacity: 0.12 + open * 0.55,
      transform: [{ scale: 0.9 + open * 0.25 }],
    };
  });

  const sparkleAnim = useAnimatedStyle(() => ({
    opacity: sparkle.value,
    transform: [{ scale: 0.6 + sparkle.value * 0.6 }],
  }));

  const showSparkles = mood === "celebrate" || resolved === "celebrate";
  const showHearts = mood === "happy" || resolved === "happy";

  const tint = color;

  // Chest yin-yang sits at roughly y=72%, x=50% of the photo.
  const chestStyle = useMemo(
    () => ({
      position: "absolute" as const,
      top: size * 0.62,
      left: size * 0.36,
      width: size * 0.28,
      height: size * 0.28,
      borderRadius: size * 0.14,
    }),
    [size],
  );

  // Mouth overlay box — sits over the photo's mouth area. We size
  // the box once and morph the SVG geometry inside.
  const mouthBoxSize = size * 0.22;
  const mouthBoxLeft = size * 0.5 - mouthBoxSize / 2;
  const mouthBoxTop = size * 0.56;

  // Helper: linearly interpolate between the two nearest viseme
  // entries, in a worklet, given the smoothed integer-ish channel.
  const visemeGeo = (key: "rx" | "ry" | "smile" | "lowerLip") =>
    useDerivedValue(() => {
      "worklet";
      const v = Math.max(0, Math.min(6, visemeSmooth.value));
      const lo = Math.floor(v);
      const hi = Math.min(6, lo + 1);
      const t = v - lo;
      const a = VISEME_GEOMETRY[lo]?.[key] ?? 0;
      const b = VISEME_GEOMETRY[hi]?.[key] ?? a;
      return a + (b - a) * t;
    }, [visemeSmooth]);

  const rxV = visemeGeo("rx");
  const ryV = visemeGeo("ry");
  const smileV = visemeGeo("smile");
  const lowerLipV = visemeGeo("lowerLip");

  // SVG box is 100×100 user units; we scale to mouthBoxSize.
  const innerProps = useAnimatedProps(() => ({
    rx: rxV.value * 100,
    ry: ryV.value * 100,
  }));

  // Outer lip silhouette — soft skin-tone ring around the mouth
  // hole so the synthetic shape blends with the photo. Slightly
  // larger than the inner mouth.
  const outerProps = useAnimatedProps(() => ({
    rx: rxV.value * 100 + 4,
    ry: ryV.value * 100 + 3,
  }));

  // Smile path: a subtle curve at the corners. Reanimated v3 paths
  // need string interpolation in a useDerivedValue worklet.
  const smilePathProps = useAnimatedProps(() => {
    const sm = smileV.value * 100; // px in user-units
    const w = (rxV.value * 100 + 6);
    const dy = sm; // upward at corners
    const d = `M ${50 - w} 50 Q 50 ${50 + dy * 0.6} ${50 + w} 50`;
    return { d };
  });

  // Lower lip shelf — only visible for FV / U.
  const lowerLipProps = useAnimatedProps(() => {
    const ll = lowerLipV.value * 100;
    const w = rxV.value * 100 + 4;
    const d = `M ${50 - w} 56 Q 50 ${56 + ll} ${50 + w} 56`;
    return { d, opacity: lowerLipV.value > 0.02 ? 1 : 0 };
  });

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityRole="image"
      accessibilityLabel="Memora"
    >
      {/* Soft halo behind her — pulses with speech */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: size * 1.05,
            height: size * 1.05,
            borderRadius: size,
            backgroundColor: tint,
          },
          haloAnim,
        ]}
      />

      <Animated.View style={[{ width: size, height: size }, bodyAnim]}>
        <Image
          source={SOURCES[sprite]}
          style={{ width: size, height: size }}
          resizeMode="contain"
        />

        {/* Viseme mouth overlay — true lip-sync */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: mouthBoxLeft,
            top: mouthBoxTop,
            width: mouthBoxSize,
            height: mouthBoxSize,
          }}
        >
          <Svg
            width={mouthBoxSize}
            height={mouthBoxSize}
            viewBox="0 0 100 100"
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {/* Skin-tone outer ring blends shape to the photo */}
            <AnimatedEllipse
              cx={50}
              cy={50}
              animatedProps={outerProps}
              fill="#3a1a3a"
              opacity={0.45}
            />
            {/* Inner mouth hole */}
            <AnimatedEllipse
              cx={50}
              cy={50}
              animatedProps={innerProps}
              fill="#1a0a14"
            />
            {/* Smile curve overlay (E viseme) */}
            <AnimatedPath
              animatedProps={smilePathProps}
              stroke="#3a1a3a"
              strokeWidth={2.5}
              strokeLinecap="round"
              fill="none"
              opacity={0.55}
            />
            {/* Lower-lip shelf (FV viseme) */}
            <AnimatedPath
              animatedProps={lowerLipProps}
              stroke="#9a5566"
              strokeWidth={3}
              strokeLinecap="round"
              fill="none"
            />
          </Svg>
        </View>

        {/* Chest yin-yang glow — chromatic bloom synced to mouthOpen */}
        <Animated.View
          pointerEvents="none"
          style={[
            chestStyle,
            {
              backgroundColor: tint,
              shadowColor: tint,
              shadowOpacity: 0.9,
              shadowRadius: size * 0.18,
              shadowOffset: { width: 0, height: 0 },
            },
            chestGlowAnim,
          ]}
        />
      </Animated.View>

      {showSparkles ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: -size * 0.04,
              flexDirection: "row",
              gap: size * 0.06,
            },
            sparkleAnim,
          ]}
        >
          <Sparkle size={size * 0.18} color="#FFE9A8" />
          <Sparkle size={size * 0.22} color="#FFE9A8" />
          <Sparkle size={size * 0.18} color="#FFE9A8" />
        </Animated.View>
      ) : null}

      {showHearts ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: size * 0.05,
            right: size * 0.04,
          }}
        >
          <Heart size={size * 0.12} color="#FF8FB1" />
        </View>
      ) : null}
    </View>
  );
}

function Sparkle({ size = 20, color = "#FFE9A8" }: { size?: number; color?: string }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          position: "absolute",
          width: size * 0.18,
          height: size,
          backgroundColor: color,
          borderRadius: size * 0.09,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size,
          height: size * 0.18,
          backgroundColor: color,
          borderRadius: size * 0.09,
        }}
      />
    </View>
  );
}

function Heart({ size = 18, color = "#FF8FB1" }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: size * 0.55,
          height: size * 0.55,
          backgroundColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.08,
          left: size * 0.12,
          width: size * 0.42,
          height: size * 0.42,
          backgroundColor: color,
          borderRadius: size * 0.21,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.08,
          right: size * 0.12,
          width: size * 0.42,
          height: size * 0.42,
          backgroundColor: color,
          borderRadius: size * 0.21,
        }}
      />
    </View>
  );
}

// Re-export under the legacy name so existing call sites keep working
// without a coordinated rename. Tests that mock `@/components/MemCharacter`
// continue to intercept the import.
export { Memora as MemCharacter };

// Silence unused import warning for AnimatedRect when shape set
// expands — kept here so future viseme additions can use it.
void AnimatedRect;
