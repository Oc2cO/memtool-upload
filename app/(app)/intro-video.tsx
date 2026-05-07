import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";

const INTRO_SOURCE = require("@/assets/videos/intro.mp4");

/**
 * "Watch intro again" replay screen (Task #334, #343).
 *
 * Plays the pre-baked OC2CO splash MP4 (`assets/videos/intro.mp4`) —
 * a ~20s 1080×1920 cut featuring Sagous + Memora, the
 * organized-chaos arc, yin-yang fusion, and Memora speaking the
 * brand tagline with periodic mouth-flip lip-sync (mirrors the
 * runtime `useMemSpeech` amplitude trick). Captions are burned in
 * for accessibility per BRAND.md doctrine.
 *
 * UX:
 *   - Tap anywhere to pause / resume.
 *   - Long-press anywhere to skip and close.
 *   - Always-reachable Close pill (top right), Mute toggle (top
 *     left), and Replay pill (bottom center).
 *   - Auto-dismisses on `playToEnd`; a 23s hard cap guarantees
 *     the user is never trapped on the splash.
 */
export default function IntroVideoScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const closedRef = useRef(false);

  const close = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  const player = useVideoPlayer(INTRO_SOURCE, (p) => {
    p.loop = false;
    p.muted = muted;
    p.play();
  });

  // Keep the player's mute state in sync with the toggle.
  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  // Keep the player's playback state in sync with the pause toggle.
  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [player, paused]);

  // Auto-dismiss when the clip finishes so the user lands back on
  // Settings without having to tap Close.
  useEffect(() => {
    const sub = player.addListener("playToEnd", () => {
      close();
    });
    return () => sub?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, replayKey]);

  // Hard cap: if the OS never fires playToEnd (sandbox, codec
  // mismatch, etc.) auto-close after the clip's known duration +
  // buffer so the user is never trapped on the splash.
  useEffect(() => {
    const t = setTimeout(close, 23000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey]);

  const togglePause = () => setPaused((p) => !p);

  const handleReplay = () => {
    closedRef.current = false;
    setPaused(false);
    player.currentTime = 0;
    player.play();
    setReplayKey((k) => k + 1);
  };

  return (
    <View style={styles.container}>
      <VideoView
        key={`intro-${replayKey}`}
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        testID="intro-video-player"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={paused ? "Resume intro" : "Pause intro"}
        accessibilityHint="Long-press anywhere to skip the intro"
        onPress={togglePause}
        onLongPress={close}
        delayLongPress={400}
        style={StyleSheet.absoluteFill}
      >
        {paused ? (
          <View style={styles.pauseOverlay}>
            <BlurView intensity={40} tint="dark" style={styles.playBadge}>
              <Ionicons name="play" size={32} color="#fff" />
            </BlurView>
          </View>
        ) : null}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close intro"
        onPress={close}
        style={[styles.pill, { top: insets.top + 12, right: 16 }]}
        hitSlop={12}
      >
        <BlurView intensity={30} tint="dark" style={styles.pillInner}>
          <Ionicons name="close" size={20} color="#fff" />
          <Text style={styles.pillText}>Close</Text>
        </BlurView>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={muted ? "Unmute Memora" : "Mute Memora"}
        onPress={() => setMuted((m) => !m)}
        style={[styles.pill, { top: insets.top + 12, left: 16 }]}
        hitSlop={12}
      >
        <BlurView intensity={30} tint="dark" style={styles.pillInner}>
          <Ionicons
            name={muted ? "volume-mute" : "volume-high"}
            size={20}
            color="#fff"
          />
        </BlurView>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Replay intro from start"
        onPress={handleReplay}
        style={[styles.replay, { bottom: insets.bottom + 24 }]}
        hitSlop={12}
      >
        <BlurView intensity={30} tint="dark" style={styles.pillInner}>
          <Ionicons name="refresh" size={18} color="#fff" />
          <Text style={styles.pillText}>Replay</Text>
        </BlurView>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0612" },
  pill: {
    position: "absolute",
    overflow: "hidden",
    borderRadius: 999,
  },
  replay: {
    position: "absolute",
    alignSelf: "center",
    overflow: "hidden",
    borderRadius: 999,
  },
  pillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 6, 18, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  playBadge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
});
