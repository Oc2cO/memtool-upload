import React, { useEffect } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  withSequence,
  Easing,
} from "react-native-reanimated";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const NUM_PIECES = 40;
const COLORS = ["#a78bfa", "#5eead4", "#f472b6"];

interface PieceProps {
  index: number;
}

function ConfettiPiece({ index }: PieceProps) {
  const startX = useSharedValue(SCREEN_WIDTH / 2);
  const startY = useSharedValue(-50);
  const translateY = useSharedValue(-50);
  const translateX = useSharedValue(SCREEN_WIDTH / 2);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    const randomX = Math.random() * SCREEN_WIDTH;
    const randomY = SCREEN_HEIGHT + Math.random() * 200;
    const randomDrift = (Math.random() - 0.5) * 200;
    const randomRotate = Math.random() * 720 - 360;
    const delay = Math.random() * 500;
    const duration = 2000 + Math.random() * 1000;

    translateY.value = withDelay(delay, withTiming(randomY, { duration, easing: Easing.out(Easing.quad) }));
    translateX.value = withDelay(delay, withTiming(randomX + randomDrift, { duration, easing: Easing.out(Easing.quad) }));
    rotate.value = withDelay(delay, withTiming(randomRotate, { duration, easing: Easing.linear }));
    opacity.value = withDelay(delay + duration - 500, withTiming(0, { duration: 500 }));
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));

  const size = 8 + Math.random() * 8;
  const color = COLORS[index % COLORS.length];

  return (
    <Animated.View
      style={[
        styles.piece,
        style,
        {
          width: size,
          height: size * 1.5,
          backgroundColor: color,
        },
      ]}
    />
  );
}

export function Confetti() {
  const pieces = Array.from({ length: NUM_PIECES }, (_, i) => i);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((i) => (
        <ConfettiPiece key={i} index={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: {
    position: "absolute",
    top: 0,
    left: 0,
  },
});
