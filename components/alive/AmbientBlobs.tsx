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
  withTiming,
} from "react-native-reanimated";

import { useBreathingEnabled } from "@/lib/aliveUI";

// Two-blob ambient layer modeled after Mercury's homepage hero
// (research §3.1 + §7.3 Recipe B). Two soft circular shapes drift on
// independent slow Lissajous-style loops (18 s and 22 s) over the
// gradient wash. The whole layer is `pointerEvents="none"` so it
// never intercepts touches.
//
// Gating mirrors the rest of the alive UI:
//   - `useBreathingEnabled()` (the existing `useFrameMonitor` flag)
//     freezes the blobs when the device has shown sustained slow
//     frames.
//   - `AccessibilityInfo.isReduceMotionEnabled()` freezes them when
//     the OS-level reduce-motion preference is on.
// In either of those cases we still render the static blob shapes
// (so the screen looks the same), we just skip the animation.
//
// Web is short-circuited to a static layer for the same reason
// `GradientBackground` does on web — Reanimated's web shim is not a
// reliable target for continuous transform-driven animations from a
// Lissajous loop, and a frame-by-frame translate would just cause
// re-layout on every tick. Static gradient + static blobs still
// reads as Mercury's signature backdrop.
//
// Edge softening (the "blurred circle" look from CSS `filter: blur`)
// is simulated by stacking four concentric circles per blob, each
// progressively larger and at a lower alpha. This gives a smooth
// radial alpha falloff that reads as a soft atmospheric light rather
// than a crisp disc. We deliberately avoid `expo-blur`, Skia, and
// SVG `RadialGradient` here because the task forbids new
// dependencies — the multi-ring trick stays within `react-native`
// + `react-native-reanimated` only and is essentially free at two
// blobs.

type BlobColors = {
  a: string;
  b: string;
};

type Props = {
  style?: StyleProp<ViewStyle>;
  colors?: BlobColors;
  // Allow callers to nudge size for tighter cards (e.g. paywall hero
  // is narrower than the home header). Defaults match the Mercury
  // observation of ~280–320 px circles.
  sizeA?: number;
  sizeB?: number;
};

const DEFAULT_COLORS: BlobColors = {
  a: "#9cb4e8",
  b: "#fc92b4",
};

const IS_WEB = Platform.OS === "web";

const PERIOD_A_MS = 18000;
const PERIOD_B_MS = 22000;

// Concentric ring stack used to simulate a Gaussian-style blur edge
// without requiring `expo-blur`. Each entry is `[scale, alpha]`: the
// inner ring is the smallest at the highest alpha, and each outer
// ring grows by ~33% while losing ~half its alpha. The compounding
// alpha of the overlapping rings near the centre stays under ~0.35
// (well within the Mercury reference's ~0.4 peak), and the falloff
// reaches near-zero by the outermost ring so the edge fades cleanly
// into the gradient backdrop. Four rings is the sweet spot — fewer
// shows banding, more is wasted overdraw on a static backdrop.
const RING_LAYERS: ReadonlyArray<readonly [number, number]> = [
  [1.0, 0.16],
  [1.35, 0.1],
  [1.7, 0.06],
  [2.05, 0.03],
];

function SoftBlobRings({ size, color }: { size: number; color: string }) {
  return (
    <>
      {RING_LAYERS.map(([scale, alpha], i) => {
        const ringSize = size * scale;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              top: (size - ringSize) / 2,
              left: (size - ringSize) / 2,
              backgroundColor: color,
              opacity: alpha,
            }}
          />
        );
      })}
    </>
  );
}

export function AmbientBlobs({
  style,
  colors = DEFAULT_COLORS,
  sizeA = 280,
  sizeB = 320,
}: Props) {
  const breathingEnabled = useBreathingEnabled();
  const [reduceMotion, setReduceMotion] = useState(false);
  const tA = useSharedValue(0);
  const tB = useSharedValue(0);

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
      cancelAnimation(tA);
      cancelAnimation(tB);
      tA.value = 0;
      tB.value = 0;
      return;
    }
    tA.value = 0;
    tB.value = 0;
    tA.value = withRepeat(
      withTiming(1, { duration: PERIOD_A_MS, easing: Easing.linear }),
      -1,
      false,
    );
    tB.value = withRepeat(
      withTiming(1, { duration: PERIOD_B_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(tA);
      cancelAnimation(tB);
    };
  }, [motionEnabled]);

  // Independent Lissajous-style loops. The two phase ratios (1.0/0.7
  // for A, 0.8/1.1 for B) keep the two blobs from ever syncing into
  // a perceivable repeating beat, which is what makes the drift feel
  // organic rather than mechanical.
  const blobAStyle = useAnimatedStyle(() => {
    const phase = tA.value * 2 * Math.PI;
    return {
      transform: [
        { translateX: Math.sin(phase) * 18 },
        { translateY: Math.cos(phase * 0.7) * 14 },
      ],
    };
  });
  const blobBStyle = useAnimatedStyle(() => {
    const phase = tB.value * 2 * Math.PI;
    return {
      transform: [
        { translateX: Math.cos(phase * 0.8) * 22 },
        { translateY: Math.sin(phase * 1.1) * 16 },
      ],
    };
  });

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.container, style]}
    >
      <Animated.View
        style={[
          styles.blobAnchor,
          {
            width: sizeA,
            height: sizeA,
            top: -sizeA * 0.25,
            left: -sizeA * 0.15,
          },
          blobAStyle,
        ]}
      >
        <SoftBlobRings size={sizeA} color={colors.a} />
      </Animated.View>
      <Animated.View
        style={[
          styles.blobAnchor,
          {
            width: sizeB,
            height: sizeB,
            bottom: -sizeB * 0.3,
            right: -sizeB * 0.2,
          },
          blobBStyle,
        ]}
      >
        <SoftBlobRings size={sizeB} color={colors.b} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  blobAnchor: {
    position: "absolute",
  },
});
