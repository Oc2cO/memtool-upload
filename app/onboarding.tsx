import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  Platform,
} from "react-native";
import { isWeb } from "@/lib/platform";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withSpring,
  withDelay,
  Easing,
  runOnJS,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";

import { useVideoPlayer, VideoView } from "expo-video";

import { useAuth } from "@/context/AuthContext";
import { MemCharacter } from "@/components/MemCharacter";
import { BrandHero } from "@/components/BrandHero";
import { ChaosLetters } from "@/components/ChaosLetters";
import { useHaptics } from "@/lib/haptics";
import colors from "@/constants/colors";

const INTRO_VIDEO_SOURCE = require("@/assets/videos/intro.mp4");

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/**
 * Brand palette for the onboarding flow.
 * Dark base + vibrant accents = "organized chaos" theme:
 *   - bg: deep near-black with a hint of purple
 *   - mem: warm gold (the friendly companion)
 *   - hot: magenta-purple highlight
 *   - cool: cyan accent
 *   - text: soft off-white (never pure white — feels gentler)
 *
 * The actual hex values live in `constants/colors.ts` under
 * `onboarding` — onboarding-chat reads from the same token group, so
 * the two screens cannot drift.
 */
const PALETTE = colors.dark.onboarding;

type Stage = "video" | "meet" | "capture" | "train" | "reflect";

const STAGE_ORDER: Stage[] = ["video", "meet", "capture", "train", "reflect"];

const VALID_RESUME: ReadonlySet<Stage> = new Set([
  "meet",
  "capture",
  "train",
  "reflect",
]);

export default function OnboardingScreen() {
  const params = useLocalSearchParams<{ resume?: string }>();
  const { user, hasSeenOnboarding } = useAuth();

  if (hasSeenOnboarding) {
    if (!user) return <Redirect href="/login" />;
    return <Redirect href="/(app)/(tabs)" />;
  }

  const rawResume = typeof params.resume === "string" ? params.resume : "";
  const resumeStage = VALID_RESUME.has(rawResume as Stage)
    ? (rawResume as Stage)
    : "video";

  return <OnboardingFlow resumeStage={resumeStage} />;
}

function OnboardingFlow({ resumeStage }: { resumeStage: Stage }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { completeOnboarding } = useAuth();

  const [stage, setStage] = useState<Stage>(resumeStage);
  const advancedFromVideo = useRef(resumeStage !== "video");
  const haptics = useHaptics();

  // Pre-baked OC2CO splash MP4 (Task #343). The mp4 carries
  // Memora's voiceover + burned-in captions; same asset replays
  // from Settings → "Watch intro again" so first launch and the
  // replay surface stay byte-identical.
  const introPlayer = useVideoPlayer(INTRO_VIDEO_SOURCE, (p) => {
    p.loop = false;
    p.muted = true;
    p.play();
  });


  // After the OC2CO splash scene ends we hand off to the chat route
  // (Task #46). The visual tour resumes when chat completes via
  // `router.replace('/onboarding?resume=meet')`.
  const handoffToChat = useCallback(() => {
    if (advancedFromVideo.current) return;
    advancedFromVideo.current = true;
    router.replace("/onboarding-chat");
  }, [router]);

  // Hard cap: callback failure or anything else must never
  // strand the user on a frozen splash.
  useEffect(() => {
    if (stage !== "video") return;
    const hardCap = setTimeout(handoffToChat, 23000);
    return () => clearTimeout(hardCap);
  }, [stage, handoffToChat]);

  // Advance to the chat handoff when the intro mp4 finishes
  // playing. `useVideoPlayer` always returns a stable controller
  // (even after we've moved past the video stage) so the listener
  // can be subscribed unconditionally.
  useEffect(() => {
    if (stage !== "video") return;
    const sub = introPlayer.addListener("playToEnd", () => {
      handoffToChat();
    });
    return () => sub?.remove();
  }, [introPlayer, stage, handoffToChat]);

  const advance = useCallback(async () => {
    Haptics.selectionAsync();
    const idx = STAGE_ORDER.indexOf(stage);
    const next = STAGE_ORDER[idx + 1];
    if (next) {
      setStage(next);
    } else {
      // Final stage → complete onboarding. Use the "capture" verb so the
      // save-style success matches every other "we got it" moment in the
      // app (login, profile save, memory save).
      haptics.play("capture");
      await completeOnboarding();
    }
  }, [stage, completeOnboarding, haptics]);

  const skip = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await completeOnboarding();
  }, [completeOnboarding]);

  const stageIndex = STAGE_ORDER.indexOf(stage);
  const totalStages = STAGE_ORDER.length - 1; // exclude video from progress dots

  return (
    <View style={[styles.container, { backgroundColor: PALETTE.bg }]}>
      {/* OC2CO SPLASH STAGE — pre-baked MP4 (Task #343). First
          launch and the Settings → "Watch intro again" replay
          play the SAME `assets/videos/intro.mp4` asset so the
          two surfaces stay byte-identical. The mp4 carries
          Memora's voiceover + burned-in captions; meaning is
          carried by characters + motion + spoken tagline. */}
      {stage === "video" && (
        <Animated.View
          entering={isWeb ? undefined : FadeIn.duration(200)}
          exiting={isWeb ? undefined : FadeOut.duration(400)}
          style={StyleSheet.absoluteFill}
        >
          <VideoView
            player={introPlayer}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            nativeControls={false}
            testID="onboarding-intro-video"
          />
          {/* Subtle gradient at bottom so the skip button is always readable */}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.6)"]}
            style={[StyleSheet.absoluteFill, { top: SCREEN_HEIGHT * 0.7 }]}
          />
          <Pressable
            onPress={handoffToChat}
            style={[styles.skipPill, { top: insets.top + 12, right: 16 }]}
          >
            <BlurView intensity={30} tint="dark" style={styles.skipPillInner}>
              <Text style={styles.skipText}>Skip intro</Text>
            </BlurView>
          </Pressable>
        </Animated.View>
      )}

      {/* MEET MEM — chaos letters reveal MemTool, character entrance */}
      {stage === "meet" && <MeetMemStage onTap={advance} />}

      {/* CAPTURE — thought bubbles fly into Mem */}
      {stage === "capture" && <CaptureStage onTap={advance} />}

      {/* TRAIN — playful cards/digits in chaos */}
      {stage === "train" && <TrainStage onTap={advance} />}

      {/* REFLECT — final celebrate + Let's Begin CTA */}
      {stage === "reflect" && <ReflectStage onComplete={advance} />}

      {/* PERSISTENT FOOTER — only on non-video stages */}
      {stage !== "video" && (
        <View
          pointerEvents="box-none"
          style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}
        >
          <View style={styles.dotsRow}>
            {STAGE_ORDER.slice(1).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    width: i === stageIndex - 1 ? 24 : 6,
                    backgroundColor:
                      i === stageIndex - 1 ? PALETTE.hot : "rgba(255,255,255,0.25)",
                  },
                ]}
              />
            ))}
          </View>

          <Pressable onPress={skip} style={styles.skipBottom} hitSlop={12}>
            <Text style={[styles.skipBottomText, { color: PALETTE.textMuted }]}>
              Skip
            </Text>
          </Pressable>

          <Text style={[styles.byline, { color: "rgba(255,255,255,0.20)" }]}>
            by O.C.2.C.O
          </Text>
        </View>
      )}
    </View>
  );
}

/* ───────────────────────────── STAGE 1: MEET ───────────────────────────── */
function MeetMemStage({ onTap }: { onTap: () => void }) {
  const insets = useSafeAreaInsets();
  const taglineOpacity = useSharedValue(0);
  const memScale = useSharedValue(0);
  const tapHintOpacity = useSharedValue(0);

  useEffect(() => {
    // Mem appears AFTER letters have settled (~1.4s)
    memScale.value = withDelay(
      1400,
      withSpring(1, { damping: 10, stiffness: 90 }),
    );
    taglineOpacity.value = withDelay(2200, withTiming(1, { duration: 600 }));
    tapHintOpacity.value = withDelay(
      3200,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 800 }),
          withTiming(0.3, { duration: 800 }),
        ),
        -1,
        true,
      ),
    );
  }, []);

  const memAnim = useAnimatedStyle(() => ({
    transform: [{ scale: memScale.value }],
  }));
  const taglineAnim = useAnimatedStyle(() => ({ opacity: taglineOpacity.value }));
  const tapHintAnim = useAnimatedStyle(() => ({ opacity: tapHintOpacity.value }));

  return (
    <Pressable style={styles.fill} onPress={onTap}>
      <Animated.View
        entering={isWeb ? undefined : FadeIn.duration(500)}
        exiting={isWeb ? undefined : FadeOut.duration(400)}
        style={[styles.fill, { paddingTop: insets.top + 60 }]}
      >
        <BackgroundOrbs />

        <View style={styles.stageBody}>
          <View style={{ marginTop: 40 }}>
            <ChaosLetters word="MemTool" size={56} color={PALETTE.text} delay={300} />
          </View>

          {/* Memora reveal: photo-style hero introduces the real character
              the user designed. The vector MemCharacter floats above as
              the live, animated companion in her `curious` greeting state
              (Task #340 — Mem is interested in *you*, not the task), so
              the very first meeting reads as nurturing eye contact rather
              than a static product shot. The photo still carries the
              brand identity below. */}
          <Animated.View style={[{ marginTop: 24, alignItems: "center" }, memAnim]}>
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ marginBottom: 8 }}
            >
              <MemCharacter size={96} expression="curious" color={PALETTE.mem} />
            </View>
            <BrandHero variant="memora-fullbody" size={260} />
          </Animated.View>

          <Animated.Text
            style={[styles.tagline, { color: PALETTE.text }, taglineAnim]}
          >
            Hi, I'm Memora.
          </Animated.Text>
          <Animated.Text
            style={[styles.subtagline, { color: PALETTE.textMuted }, taglineAnim]}
          >
            I help you organize the chaos in your head.
          </Animated.Text>
        </View>

        <Animated.View
          style={[
            { position: "absolute", bottom: 110, alignSelf: "center" },
            tapHintAnim,
          ]}
        >
          <Text style={{ color: PALETTE.textMuted, fontSize: 13 }}>
            Tap anywhere to continue
          </Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/* ─────────────────────────── STAGE 2: CAPTURE ─────────────────────────── */
function CaptureStage({ onTap }: { onTap: () => void }) {
  const insets = useSafeAreaInsets();
  const headlineOpacity = useSharedValue(0);

  useEffect(() => {
    headlineOpacity.value = withDelay(400, withTiming(1, { duration: 500 }));
  }, []);

  const headlineAnim = useAnimatedStyle(() => ({ opacity: headlineOpacity.value }));

  return (
    <Pressable style={styles.fill} onPress={onTap}>
      <Animated.View
        entering={isWeb ? undefined : FadeIn.duration(500)}
        exiting={isWeb ? undefined : FadeOut.duration(400)}
        style={[styles.fill, { paddingTop: insets.top + 60 }]}
      >
        <BackgroundOrbs />

        <View style={styles.stageBody}>
          <Animated.Text
            style={[styles.headline, { color: PALETTE.text }, headlineAnim]}
          >
            Capture anything,
          </Animated.Text>
          <Animated.Text
            style={[styles.headline, { color: PALETTE.hot }, headlineAnim]}
          >
            instantly.
          </Animated.Text>

          <View style={{ marginTop: 36, height: 280, width: SCREEN_WIDTH, alignItems: "center", justifyContent: "center" }}>
            <ThoughtBubbles />
            <View style={{ position: "absolute" }}>
              <MemCharacter size={140} mood="thinking" expression="thoughtful" color={PALETTE.mem} />
            </View>
          </View>

          <Animated.Text
            style={[styles.body, { color: PALETTE.textMuted }, headlineAnim]}
          >
            Thoughts. Calls. Moods. Ideas.{"\n"}I keep them safe so you don't have to.
          </Animated.Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

/* ──────────────────────────── STAGE 3: TRAIN ──────────────────────────── */
function TrainStage({ onTap }: { onTap: () => void }) {
  const insets = useSafeAreaInsets();
  const headlineOpacity = useSharedValue(0);

  useEffect(() => {
    headlineOpacity.value = withDelay(400, withTiming(1, { duration: 500 }));
  }, []);

  const headlineAnim = useAnimatedStyle(() => ({ opacity: headlineOpacity.value }));

  return (
    <Pressable style={styles.fill} onPress={onTap}>
      <Animated.View
        entering={isWeb ? undefined : FadeIn.duration(500)}
        exiting={isWeb ? undefined : FadeOut.duration(400)}
        style={[styles.fill, { paddingTop: insets.top + 60 }]}
      >
        <BackgroundOrbs />

        <View style={styles.stageBody}>
          <Animated.Text
            style={[styles.headline, { color: PALETTE.text }, headlineAnim]}
          >
            Train your mind,
          </Animated.Text>
          <Animated.Text
            style={[styles.headline, { color: PALETTE.cool }, headlineAnim]}
          >
            playfully.
          </Animated.Text>

          <View style={{ marginTop: 24, height: 280, width: SCREEN_WIDTH, alignItems: "center", justifyContent: "center" }}>
            <FlippingCards />
            <View style={{ position: "absolute", top: 30 }}>
              <MemCharacter size={120} mood="happy" expression="celebrating" color={PALETTE.mem} />
            </View>
          </View>

          <Animated.Text
            style={[styles.body, { color: PALETTE.textMuted }, headlineAnim]}
          >
            Memory match. Quick math. Daily wins.{"\n"}A few minutes a day, and you'll feel sharper.
          </Animated.Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

/* ──────────────────────────── STAGE 4: REFLECT ─────────────────────────── */
function ReflectStage({ onComplete }: { onComplete: () => void }) {
  const insets = useSafeAreaInsets();
  const headlineOpacity = useSharedValue(0);
  const ctaScale = useSharedValue(0);

  useEffect(() => {
    headlineOpacity.value = withDelay(400, withTiming(1, { duration: 500 }));
    ctaScale.value = withDelay(
      1400,
      withSpring(1, { damping: 9, stiffness: 110 }),
    );
  }, []);

  const headlineAnim = useAnimatedStyle(() => ({ opacity: headlineOpacity.value }));
  const ctaAnim = useAnimatedStyle(() => ({
    transform: [{ scale: ctaScale.value }],
    opacity: ctaScale.value,
  }));

  return (
    <Animated.View
      entering={isWeb ? undefined : FadeIn.duration(500)}
      exiting={isWeb ? undefined : FadeOut.duration(400)}
      style={[styles.fill, { paddingTop: insets.top + 60 }]}
    >
      <BackgroundOrbs />

      <View style={styles.stageBody}>
        <Animated.Text
          style={[styles.headline, { color: PALETTE.text }, headlineAnim]}
        >
          Reflect, with AI
        </Animated.Text>
        <Animated.Text
          style={[styles.headline, { color: PALETTE.pink }, headlineAnim]}
        >
          that knows you.
        </Animated.Text>

        {/* Couple hero: Memora + Sagous together — the emotional close
            of onboarding. "We'll be here" without saying a word. */}
        <View style={{ marginTop: 24, alignItems: "center" }}>
          <BrandHero variant="couple-hero" size={300} />
        </View>

        <Animated.Text
          style={[styles.body, { color: PALETTE.textMuted, marginTop: 16 }, headlineAnim]}
        >
          Daily recaps. Mood patterns. Gentle nudges.{"\n"}Smart, never overbearing.
        </Animated.Text>

        <Animated.View style={[{ marginTop: 40 }, ctaAnim]}>
          <Pressable onPress={onComplete} style={styles.cta}>
            <LinearGradient
              colors={[PALETTE.hot, PALETTE.pink]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.ctaInner}
            >
              <Text style={styles.ctaText}>Let's begin</Text>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/* ───────────────────── DECORATIVE: BACKGROUND ORBS ───────────────────── */
function BackgroundOrbs() {
  const o1 = useSharedValue(0);
  const o2 = useSharedValue(0);
  const o3 = useSharedValue(0);

  useEffect(() => {
    o1.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 6000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 6000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    o2.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 8000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 8000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    o3.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 10000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 10000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, []);

  const a1 = useAnimatedStyle(() => ({
    transform: [{ translateY: o1.value * -40 }, { scale: 1 + o1.value * 0.15 }],
    opacity: 0.18 + o1.value * 0.12,
  }));
  const a2 = useAnimatedStyle(() => ({
    transform: [{ translateY: o2.value * 40 }, { scale: 1 + o2.value * 0.2 }],
    opacity: 0.14 + o2.value * 0.10,
  }));
  const a3 = useAnimatedStyle(() => ({
    transform: [{ translateX: o3.value * 30 }, { scale: 1 + o3.value * 0.18 }],
    opacity: 0.12 + o3.value * 0.10,
  }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          { position: "absolute", top: -80, left: -80, width: 320, height: 320, borderRadius: 160, backgroundColor: PALETTE.hot },
          a1,
        ]}
      />
      <Animated.View
        style={[
          { position: "absolute", top: SCREEN_HEIGHT * 0.45, right: -100, width: 360, height: 360, borderRadius: 180, backgroundColor: PALETTE.cool },
          a2,
        ]}
      />
      <Animated.View
        style={[
          { position: "absolute", bottom: -120, left: SCREEN_WIDTH * 0.2, width: 300, height: 300, borderRadius: 150, backgroundColor: PALETTE.pink },
          a3,
        ]}
      />
      {/* Soft dark vignette so the orbs don't overpower the content */}
      <LinearGradient
        colors={["rgba(10,6,18,0.4)", "rgba(10,6,18,0.85)"]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/* ───────────────────── DECORATIVE: THOUGHT BUBBLES ───────────────────── */
function ThoughtBubbles() {
  const items = [
    { word: "ideas", color: PALETTE.hot, x: -130, y: -90, delay: 200 },
    { word: "calls", color: PALETTE.cool, x: 120, y: -110, delay: 400 },
    { word: "memories", color: PALETTE.pink, x: -120, y: 80, delay: 600 },
    { word: "moods", color: PALETTE.mem, x: 130, y: 70, delay: 800 },
    { word: "names", color: PALETTE.cool, x: -10, y: -130, delay: 1000 },
    { word: "facts", color: PALETTE.hot, x: 0, y: 130, delay: 1200 },
  ];
  return (
    <>
      {items.map((it, i) => (
        <FlyingBubble key={i} {...it} />
      ))}
    </>
  );
}

function FlyingBubble({
  word,
  color,
  x,
  y,
  delay,
}: {
  word: string;
  color: string;
  x: number;
  y: number;
  delay: number;
}) {
  const tx = useSharedValue(x * 2);
  const ty = useSharedValue(y * 2);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 300 }));
    scale.value = withDelay(delay, withSpring(1, { damping: 12, stiffness: 100 }));
    tx.value = withDelay(
      delay,
      withSpring(x, { damping: 16, stiffness: 90 }),
    );
    ty.value = withDelay(
      delay,
      withSpring(y, { damping: 16, stiffness: 90 }),
    );
    // Then drift toward center after another delay
    tx.value = withDelay(
      delay + 1800,
      withTiming(0, { duration: 1500, easing: Easing.in(Easing.cubic) }),
    );
    ty.value = withDelay(
      delay + 1800,
      withTiming(0, { duration: 1500, easing: Easing.in(Easing.cubic) }),
    );
    opacity.value = withDelay(
      delay + 2800,
      withTiming(0, { duration: 600 }),
    );
  }, []);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Animated.View style={[{ position: "absolute" }, anim]}>
      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 20,
          backgroundColor: "rgba(0,0,0,0.45)",
          borderWidth: 1,
          borderColor: color,
        }}
      >
        <Text style={{ color, fontSize: 14, fontWeight: "600" }}>{word}</Text>
      </View>
    </Animated.View>
  );
}

/* ─────────────────── DECORATIVE: FLIPPING CARDS / DIGITS ─────────────────── */
function FlippingCards() {
  const icons = ["🧠", "✨", "🎯", "🃏", "🔢", "💡"];
  return (
    <>
      {icons.map((icon, i) => {
        const angle = (i / icons.length) * Math.PI * 2;
        const radius = 110;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        return <OrbitingCard key={i} icon={icon} x={x} y={y} delay={i * 150} />;
      })}
    </>
  );
}

function OrbitingCard({ icon, x, y, delay }: { icon: string; x: number; y: number; delay: number }) {
  const tx = useSharedValue(x * 3);
  const ty = useSharedValue(y * 3);
  const flip = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 300 }));
    tx.value = withDelay(delay, withSpring(x, { damping: 14, stiffness: 90 }));
    ty.value = withDelay(delay, withSpring(y, { damping: 14, stiffness: 90 }));
    flip.value = withDelay(
      delay + 800,
      withRepeat(
        withSequence(
          withTiming(180, { duration: 800, easing: Easing.inOut(Easing.cubic) }),
          withTiming(360, { duration: 800, easing: Easing.inOut(Easing.cubic) }),
        ),
        -1,
        false,
      ),
    );
  }, []);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotateY: `${flip.value}deg` },
    ],
  }));

  return (
    <Animated.View style={[{ position: "absolute" }, anim]}>
      <View
        style={{
          width: 56,
          height: 72,
          borderRadius: 12,
          backgroundColor: "rgba(180, 122, 255, 0.18)",
          borderWidth: 1.5,
          borderColor: PALETTE.cool,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 32 }}>{icon}</Text>
      </View>
    </Animated.View>
  );
}

/* ───────────────────────────── STYLES ───────────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1 },
  fill: { flex: 1 },
  stageBody: { flex: 1, alignItems: "center", paddingHorizontal: 24 },
  tagline: {
    fontSize: 32,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    marginTop: 32,
    textAlign: "center",
  },
  subtagline: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    marginTop: 10,
    textAlign: "center",
    paddingHorizontal: 24,
    lineHeight: 22,
  },
  headline: {
    fontSize: 36,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    lineHeight: 42,
  },
  body: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 24,
    marginTop: 24,
    paddingHorizontal: 24,
  },
  cta: {
    borderRadius: 32,
    overflow: "hidden",
    shadowColor: PALETTE.hot,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 10,
  },
  ctaInner: {
    paddingVertical: 18,
    paddingHorizontal: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  skipPill: {
    position: "absolute",
    borderRadius: 18,
    overflow: "hidden",
  },
  skipPillInner: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 18,
  },
  skipText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  skipBottom: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  skipBottomText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  byline: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    letterSpacing: 2,
    marginTop: 10,
  },
});
