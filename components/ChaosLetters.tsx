import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  Easing,
} from "react-native-reanimated";

interface ChaosLettersProps {
  word: string;
  size?: number;
  color?: string;
  delay?: number;
  /** Trigger key — change this value to replay the chaos→organize animation */
  triggerKey?: string | number;
  /** ms each letter takes to find its home */
  spread?: number;
}

/**
 * Tumbling letters that arrive in chaos, then snap into ordered formation.
 *
 * Used for the "MemTool" reveal moment in onboarding. Each letter starts
 * at a random off-screen position with rotation and scale, then springs
 * into its grid position one after another. Captures the brand promise:
 * "we organize the chaos."
 */
export function ChaosLetters({
  word,
  size = 56,
  color = "#FFFFFF",
  delay = 0,
  triggerKey,
  spread = 700,
}: ChaosLettersProps) {
  const letters = word.split("");

  return (
    <View style={styles.row}>
      {letters.map((letter, i) => (
        <ChaosLetter
          key={`${triggerKey ?? "k"}-${i}`}
          letter={letter}
          size={size}
          color={color}
          delay={delay + i * 90}
          spread={spread}
        />
      ))}
    </View>
  );
}

interface ChaosLetterProps {
  letter: string;
  size: number;
  color: string;
  delay: number;
  spread: number;
}

function ChaosLetter({ letter, size, color, delay, spread }: ChaosLetterProps) {
  const translateX = useSharedValue(randomInRange(-220, 220));
  const translateY = useSharedValue(randomInRange(-300, 300));
  const rotate = useSharedValue(randomInRange(-540, 540));
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 200 }));
    scale.value = withDelay(
      delay,
      withSpring(1, { damping: 12, stiffness: 120, mass: 0.9 }),
    );
    translateX.value = withDelay(
      delay,
      withSpring(0, { damping: 14, stiffness: 110, mass: 0.9 }),
    );
    translateY.value = withDelay(
      delay,
      withSpring(0, { damping: 14, stiffness: 110, mass: 0.9 }),
    );
    rotate.value = withDelay(
      delay,
      withTiming(0, { duration: spread, easing: Easing.out(Easing.cubic) }),
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
      { scale: scale.value },
    ],
  }));

  // Letters with descenders/ascenders need a slightly wider slot for visual balance
  const slotWidth = size * (letter === " " ? 0.4 : 0.62);

  return (
    <Animated.View style={[{ width: slotWidth, alignItems: "center" }, animStyle]}>
      <Text
        style={{
          // fontSize comes from the `size` prop so the letter slot stays
          // dynamic. 800-weight is a deliberate one-off — Inter only ships
          // up to 700 in the bundle, so the family stays pinned to
          // Inter_700Bold and the system synthesises the extra weight.
          fontSize: size,
          color,
          fontWeight: "800",
          fontFamily: "Inter_700Bold",
          textShadowColor: "rgba(180, 122, 255, 0.5)",
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: 24,
        }}
      >
        {letter}
      </Text>
    </Animated.View>
  );
}

function randomInRange(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
});
