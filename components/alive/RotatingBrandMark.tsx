import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import SvgRaw, {
  Circle as CircleRaw,
  Ellipse as EllipseRaw,
  G as GRaw,
  Line as LineRaw,
  type CircleProps,
  type EllipseProps,
  type GProps,
  type LineProps,
  type SvgProps,
} from "react-native-svg";

// react-native-svg exports class components whose constructor signatures
// don't satisfy React 19's tightened `JSX.ElementClass extends Component<any>`
// constraint. Re-cast them to function-component types at the import boundary
// so JSX usage below typechecks cleanly without changing runtime behavior.
const Svg = SvgRaw as unknown as React.ComponentType<SvgProps>;
const Circle = CircleRaw as unknown as React.ComponentType<CircleProps>;
const Ellipse = EllipseRaw as unknown as React.ComponentType<EllipseProps>;
const G = GRaw as unknown as React.ComponentType<GProps>;
const Line = LineRaw as unknown as React.ComponentType<LineProps>;

import { useBreathingEnabled } from "@/lib/aliveUI";

// Slowly rotating brand mark + opacity pulse, modeled on Mercury's
// 404 turntable glyph (research §3.2). Sits behind the paywall hero
// and onboarding chat backdrop, on top of `GradientBackground` +
// `AmbientBlobs`. The whole layer is `pointerEvents="none"` so it
// never intercepts touches against content sitting above it.
//
// Animation:
//   - Rotation: 60 s per full turn, linear, infinite.
//   - Opacity pulse: 0.92 → 1.0 and back, 4 s period with sin
//     easing (matches `BreatheCard`'s cadence so the mark breathes
//     with the rest of the alive UI).
//
// Gating mirrors `AmbientBlobs` / `GradientBackground`:
//   - `useBreathingEnabled()` (the existing `useFrameMonitor` flag)
//     freezes the mark when the device has shown sustained slow
//     frames.
//   - `AccessibilityInfo.isReduceMotionEnabled()` freezes it when
//     the OS-level reduce-motion preference is on.
// In either case we still render the static mark (so the screen
// looks the same), we just skip the animation.
//
// Web is short-circuited to a static mark for the same reason
// `GradientBackground` and `AmbientBlobs` are: the Reanimated web
// shim is not a reliable target for continuous transform-driven
// SVG animation, and the static mark still reads as the Mercury
// signature backdrop.
//
// Per Mercury §3.2's perf note, the SVG path is pre-flattened on a
// fixed 100×100 viewBox and the parent `Animated.View` carries the
// rotation transform — we never re-render the SVG itself, only its
// containing transform, which keeps the cost on the UI thread.

type Props = {
  style?: StyleProp<ViewStyle>;
  size?: number;
  color?: string;
  // Faint base opacity of the mark itself, before the pulse is
  // applied. Multiplied by the live pulse value, so the on-screen
  // peak is `baseOpacity * MAX_PULSE`. Defaults to a soft 0.08 so
  // the mark reads as an atmospheric glyph rather than a logo.
  baseOpacity?: number;
};

const IS_WEB = Platform.OS === "web";

const ROTATION_PERIOD_MS = 60_000;
const PULSE_PERIOD_MS = 4_000;
const PULSE_HALF = PULSE_PERIOD_MS / 2;
const MIN_PULSE = 0.92;
const MAX_PULSE = 1.0;

const VIEW = 100;
const C = VIEW / 2;

const RING_OUTER_R = 44;
const RING_INNER_R = 26;
const CENTER_DOT_R = 3.2;
const TICK_OUTER_R = 47;
const TICK_INNER_R = 41;
const PETAL_RX = 5;
const PETAL_RY = 12;
const PETAL_OFFSET_R = 35;

const STROKE = 1.2;

const TICK_COUNT = 12;
const PETAL_COUNT = 6;

const TICKS: Array<{ x1: number; y1: number; x2: number; y2: number }> =
  Array.from({ length: TICK_COUNT }, (_, i) => {
    const a = (i * (360 / TICK_COUNT) * Math.PI) / 180;
    return {
      x1: C + Math.cos(a) * TICK_INNER_R,
      y1: C + Math.sin(a) * TICK_INNER_R,
      x2: C + Math.cos(a) * TICK_OUTER_R,
      y2: C + Math.sin(a) * TICK_OUTER_R,
    };
  });

const PETALS: Array<{ cx: number; cy: number; rotateDeg: number }> = Array.from(
  { length: PETAL_COUNT },
  (_, i) => {
    const angleDeg = i * (360 / PETAL_COUNT);
    const a = (angleDeg * Math.PI) / 180;
    return {
      cx: C + Math.cos(a) * PETAL_OFFSET_R,
      cy: C + Math.sin(a) * PETAL_OFFSET_R,
      // Petal long-axis points outward from center.
      rotateDeg: angleDeg + 90,
    };
  },
);

export function RotatingBrandMark({
  style,
  size = 320,
  color = "#B47AFF",
  baseOpacity = 0.08,
}: Props) {
  const breathingEnabled = useBreathingEnabled();
  const [reduceMotion, setReduceMotion] = useState(false);
  const rotation = useSharedValue(0);
  const pulse = useSharedValue(MAX_PULSE);

  useEffect(() => {
    if (IS_WEB) return;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((rm) => {
        if (!cancelled) setReduceMotion(rm);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (rm) => setReduceMotion(rm),
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const motionEnabled = !IS_WEB && breathingEnabled && !reduceMotion;

  useEffect(() => {
    if (!motionEnabled) {
      cancelAnimation(rotation);
      cancelAnimation(pulse);
      rotation.value = 0;
      pulse.value = MAX_PULSE;
      return;
    }
    rotation.value = 0;
    pulse.value = MAX_PULSE;
    rotation.value = withRepeat(
      withTiming(360, { duration: ROTATION_PERIOD_MS, easing: Easing.linear }),
      -1,
      false,
    );
    pulse.value = withRepeat(
      withSequence(
        withTiming(MIN_PULSE, {
          duration: PULSE_HALF,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(MAX_PULSE, {
          duration: PULSE_HALF,
          easing: Easing.inOut(Easing.sin),
        }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(rotation);
      cancelAnimation(pulse);
    };
  }, [motionEnabled]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
    opacity: baseOpacity * pulse.value,
  }));

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.container, style]}
    >
      <Animated.View
        style={[
          { width: size, height: size },
          animatedStyle,
        ]}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
          <G fill="none" stroke={color} strokeWidth={STROKE}>
            <Circle cx={C} cy={C} r={RING_OUTER_R} />
            <Circle cx={C} cy={C} r={RING_INNER_R} />
            {TICKS.map((t, i) => (
              <Line
                key={`tick-${i}`}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                strokeLinecap="round"
              />
            ))}
            {PETALS.map((p, i) => (
              <Ellipse
                key={`petal-${i}`}
                cx={p.cx}
                cy={p.cy}
                rx={PETAL_RX}
                ry={PETAL_RY}
                origin={`${p.cx}, ${p.cy}`}
                rotation={p.rotateDeg}
              />
            ))}
            <Circle cx={C} cy={C} r={CENTER_DOT_R} fill={color} stroke="none" />
          </G>
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
