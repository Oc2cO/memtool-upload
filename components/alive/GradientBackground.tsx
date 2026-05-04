import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleProp,
  ViewStyle,
} from "react-native";
import {
  LinearGradient as LinearGradientRaw,
  type LinearGradientProps,
} from "expo-linear-gradient";

// expo-linear-gradient's LinearGradient is a class component whose
// constructor signature doesn't satisfy React 19's tightened
// `JSX.ElementClass extends Component<any>` constraint. Re-cast it to a
// function-component type at the import boundary so JSX usage below
// typechecks cleanly without changing runtime behavior.
const LinearGradient =
  LinearGradientRaw as unknown as React.ComponentType<LinearGradientProps>;
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolateColor,
  useDerivedValue,
  cancelAnimation,
} from "react-native-reanimated";

import { useBreathingEnabled } from "@/lib/aliveUI";
import { DURATIONS } from "@/lib/animationTokens";

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

type Props = {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  colors?: readonly [string, string, string, string];
  durationMs?: number;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
};

const DEFAULT_COLORS: readonly [string, string, string, string] = [
  "#0a0612",
  "#0d0820",
  "#0f0a1a",
  "#0a0612",
];

const IS_WEB = Platform.OS === "web";

export function GradientBackground({
  style,
  children,
  colors = DEFAULT_COLORS,
  durationMs = DURATIONS.ambient,
  start = { x: 0, y: 0 },
  end = { x: 1, y: 1 },
}: Props) {
  const breathingEnabled = useBreathingEnabled();
  const [reduceMotion, setReduceMotion] = useState(false);
  const t = useSharedValue(0);

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

  useEffect(() => {
    if (IS_WEB) return;
    if (!breathingEnabled || reduceMotion) {
      cancelAnimation(t);
      t.value = 0;
      return;
    }
    t.value = 0;
    t.value = withRepeat(
      withSequence(
        withTiming(1, { duration: durationMs, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: durationMs, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(t);
    };
  }, [breathingEnabled, reduceMotion, durationMs]);

  const c0 = useDerivedValue(() =>
    interpolateColor(t.value, [0, 0.5, 1], [colors[0], colors[1], colors[0]]),
  );
  const c1 = useDerivedValue(() =>
    interpolateColor(t.value, [0, 0.5, 1], [colors[1], colors[2], colors[1]]),
  );
  const c2 = useDerivedValue(() =>
    interpolateColor(t.value, [0, 0.5, 1], [colors[2], colors[3], colors[2]]),
  );

  const animatedProps = useAnimatedProps(
    () => ({
      colors: [c0.value, c1.value, c2.value] as unknown as readonly [string, string, string],
    }),
    [c0, c1, c2],
  );

  // On web, `expo-linear-gradient` is a function component that renders a
  // <View> with a CSS `background-image: linear-gradient(...)`. It does
  // not forward refs to the underlying DOM node, so when wrapped in
  // `Animated.createAnimatedComponent` the animated worklet's
  // `_updatePropsJS` falls into the legacy `_touchableNode` branch and
  // throws "Cannot read properties of undefined (reading 'setAttribute')",
  // crashing the whole web preview. Even if it didn't crash, animating a
  // CSS gradient frame-by-frame via React props doesn't actually produce
  // a smooth color transition in the browser — it would re-render the
  // backgroundImage string each tick. So on web we render a single static
  // gradient and skip the animation entirely.
  if (IS_WEB) {
    return (
      <LinearGradient
        colors={[colors[0], colors[1], colors[2]]}
        start={start}
        end={end}
        style={style}
      >
        {children}
      </LinearGradient>
    );
  }

  return (
    <AnimatedLinearGradient
      animatedProps={animatedProps}
      colors={[colors[0], colors[1], colors[2]]}
      start={start}
      end={end}
      style={style}
    >
      {children}
    </AnimatedLinearGradient>
  );
}
