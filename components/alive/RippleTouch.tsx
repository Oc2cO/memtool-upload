import React, { forwardRef, useImperativeHandle, useState, useCallback } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";

import { EASING } from "@/lib/animationTokens";

export type RippleTouchHandle = {
  trigger: (x: number, y: number) => void;
};

type RippleProps = {
  x: number;
  y: number;
  size: number;
  color: string;
  onDone: () => void;
};

const RIPPLE_DURATION_MS = 420;

function Ripple({ x, y, size, color, onDone }: RippleProps) {
  const progress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = withTiming(
      1,
      { duration: RIPPLE_DURATION_MS, easing: EASING.out },
      (finished) => {
        if (finished) runOnJS(onDone)();
      },
    );
  }, []);

  const style = useAnimatedStyle(() => {
    const scale = progress.value * 1.2;
    const opacity = (1 - progress.value) * 0.15;
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  // Pointer events are already disabled on the parent absoluteFill View
  // in `RippleTouch` below, so we don't repeat it here. Repeating it on
  // an Animated.View (either as a prop or inside the style array) is the
  // pattern that historically triggered the reanimated web
  // `_touchableNode is undefined` crash.
  return (
    <Animated.View
      style={[
        styles.ripple,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          left: x - size / 2,
          top: y - size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

type Props = {
  color?: string;
  containerSize?: { width: number; height: number };
};

export const RippleTouch = forwardRef<RippleTouchHandle, Props>(
  function RippleTouch({ color = "rgba(255, 255, 255, 0.45)", containerSize }, ref) {
    const [ripples, setRipples] = useState<
      Array<{ id: number; x: number; y: number; size: number }>
    >([]);

    const trigger = useCallback(
      (x: number, y: number) => {
        const w = containerSize?.width ?? 200;
        const h = containerSize?.height ?? 60;
        const dx = Math.max(x, w - x);
        const dy = Math.max(y, h - y);
        const radius = Math.sqrt(dx * dx + dy * dy);
        const size = Math.max(40, radius * 2);
        const id = Date.now() + Math.random();
        setRipples((prev) => [...prev, { id, x, y, size }]);
      },
      [containerSize?.height, containerSize?.width],
    );

    useImperativeHandle(ref, () => ({ trigger }), [trigger]);

    const handleDone = useCallback((id: number) => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, []);

    return (
      <View style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>
        {ripples.map((r) => (
          <Ripple
            key={r.id}
            x={r.x}
            y={r.y}
            size={r.size}
            color={color}
            onDone={() => handleDone(r.id)}
          />
        ))}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  ripple: {
    position: "absolute",
  },
});
