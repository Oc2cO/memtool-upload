import React, { useMemo } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";

import { useMemories } from "@/context/MemoriesContext";

// Full-screen photo viewer (Task #386). Tapping a photo thumbnail in
// the Archive routes here. We always present the original
// `photoUrl` (not the 256x256 thumb the row uses), so the viewer
// closes the loop on attaching a real picture to a memory.
//
// Native (iOS/Android) gets the full kit:
//   • pinch-to-zoom (with focal-point following the gesture)
//   • double-tap to toggle 1x ↔ 2.5x
//   • swipe-down-to-dismiss when the image is at base scale
//   • tap-anywhere or close button to dismiss
//
// Web falls back to the same screen but without the gesture stack —
// just a centered image with a close affordance — because
// react-native-gesture-handler's pan/pinch on web is awkward and
// browsers already provide their own zoom.
//
// The screen reads its photo from MemoriesContext rather than route
// params so a deep-link or stale URL can't render an image the user
// no longer owns. If the memory or photo is missing we render a
// soft "photo unavailable" message with a back button — better than
// a blank black screen.
export default function PhotoViewerScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const router = useRouter();
  const { memories } = useMemories();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();

  const memory = useMemo(
    () => memories.find((m) => m.id === clientId),
    [memories, clientId],
  );
  const photoUrl = memory?.photoUrl ?? null;

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/archive" as never);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          contentStyle: { backgroundColor: "#000" },
        }}
      />
      <View style={styles.root}>
        {photoUrl ? (
          <PhotoZoomable
            uri={photoUrl}
            width={winW}
            height={winH}
            onDismiss={close}
          />
        ) : (
          <View style={styles.missingWrap}>
            <Ionicons
              name="image-outline"
              size={36}
              color="rgba(255,255,255,0.6)"
            />
            <Text style={styles.missingText}>Photo unavailable</Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          onPress={close}
          hitSlop={12}
          style={[styles.closeBtn, { top: insets.top + 12 }]}
        >
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>
      </View>
    </>
  );
}

interface PhotoZoomableProps {
  uri: string;
  width: number;
  height: number;
  onDismiss: () => void;
}

function PhotoZoomable({ uri, width, height, onDismiss }: PhotoZoomableProps) {
  // Web: skip the gesture stack. Browsers already provide pinch
  // zoom on the page itself and react-native-gesture-handler's
  // pinch implementation on web is jittery enough to feel worse
  // than a static image. Tap anywhere on the backdrop dismisses.
  if (Platform.OS === "web") {
    return (
      <Pressable style={styles.webBackdrop} onPress={onDismiss}>
        <Image
          source={{ uri }}
          style={{ width, height }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={150}
          accessibilityLabel="Memory photo"
        />
      </Pressable>
    );
  }

  // Reanimated shared values driving the image transform. We track
  // the committed scale/translation separately from the in-flight
  // pinch/pan so each new gesture composes on top of the previous
  // settled state instead of resetting it.
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  // Backdrop opacity follows the swipe-down gesture so the dismiss
  // feels physically connected to the user's finger.
  const backdropOpacity = useSharedValue(1);

  const MIN_SCALE = 1;
  const MAX_SCALE = 5;
  const DOUBLE_TAP_SCALE = 2.5;
  const DISMISS_THRESHOLD = 120; // pixels of vertical drag to commit dismiss

  const reset = () => {
    "worklet";
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE * 0.6, savedScale.value * e.scale),
      );
      scale.value = next;
    })
    .onEnd(() => {
      // Snap back to 1x if the user pinched below it (rubber-band
      // feel without leaving the image stuck at a sub-1 scale).
      if (scale.value < MIN_SCALE) {
        reset();
      } else {
        savedScale.value = scale.value;
      }
    });

  const pan = Gesture.Pan()
    .minDistance(4)
    .onUpdate((e) => {
      if (scale.value > 1.01) {
        // Zoomed in: free pan in both axes.
        translateX.value = savedX.value + e.translationX;
        translateY.value = savedY.value + e.translationY;
      } else {
        // At base scale: vertical drag drives the swipe-down dismiss
        // gesture (and a little horizontal slack so it feels alive).
        translateY.value = e.translationY;
        translateX.value = e.translationX * 0.3;
        const progress = Math.min(
          1,
          Math.abs(e.translationY) / (DISMISS_THRESHOLD * 2),
        );
        backdropOpacity.value = 1 - progress * 0.7;
      }
    })
    .onEnd((e) => {
      if (scale.value > 1.01) {
        savedX.value = translateX.value;
        savedY.value = translateY.value;
        return;
      }
      // Commit dismiss when the user drops the photo past the
      // threshold OR flicks it downward fast enough.
      if (
        e.translationY > DISMISS_THRESHOLD ||
        (e.velocityY > 800 && e.translationY > 40)
      ) {
        backdropOpacity.value = withTiming(0, { duration: 180 });
        translateY.value = withTiming(e.translationY + 400, { duration: 220 });
        runOnJS(onDismiss)();
        return;
      }
      // Otherwise, snap back to center and restore the backdrop.
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
      backdropOpacity.value = withTiming(1);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(250)
    .onEnd(() => {
      if (scale.value > 1.01) {
        reset();
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE);
        savedScale.value = DOUBLE_TAP_SCALE;
      }
    });

  // Single-tap dismisses, but only when not zoomed (otherwise a
  // user lifting their finger after a pan would inadvertently
  // close the viewer).
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDelay(250)
    .requireExternalGestureToFail(doubleTap)
    .onEnd(() => {
      if (scale.value <= 1.01) {
        runOnJS(onDismiss)();
      }
    });

  const composed = Gesture.Simultaneous(
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.center]}>
          <Animated.View style={imageStyle}>
            <Image
              source={{ uri }}
              style={{ width, height }}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={150}
              accessibilityLabel="Memory photo"
            />
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  backdrop: {
    backgroundColor: "#000",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  webBackdrop: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  missingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  missingText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    fontWeight: "500",
  },
});
