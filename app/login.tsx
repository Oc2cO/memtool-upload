import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Keyboard,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Redirect, useRouter } from "expo-router";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { DURATIONS, EASING } from "@/lib/animationTokens";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useHaptics } from "@/lib/haptics";
import { GradientButton } from "@/components/GradientButton";
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "@/lib/inputLimits";
import { SettleOnMount } from "@/components/alive/SettleOnMount";
import { LiftPress } from "@/components/alive/LiftPress";
import { GradientBackground } from "@/components/alive/GradientBackground";
import { AmbientBlobs } from "@/components/alive/AmbientBlobs";
import { RotatingBrandMark } from "@/components/alive/RotatingBrandMark";
import {
  AuthCinematicStage,
  type AuthCinematicStageHandle,
} from "@/components/alive/AuthCinematicStage";

// Hand-off glow timings: derived from DURATIONS so they live on
// the same scale as every other Mercury motion in the app. Full
// timing is `cinematic - instant` (~480ms) — long enough for the
// glow to read as an expand, short enough that the redirect feels
// instant. Reduced motion clamps to `base` (200ms).
const HANDOFF_DURATION_MS = DURATIONS.cinematic - DURATIONS.instant;
const HANDOFF_REDUCED_DURATION_MS = DURATIONS.base;

export default function LoginScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSlowHint, setShowSlowHint] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [cinematicSettled, setCinematicSettled] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const handoffTriggeredRef = useRef(false);
  const cinematicRef = useRef<AuthCinematicStageHandle | null>(null);

  // Form fade-up gated on the cinematic settling — keeps the
  // characters' choreography uncontested before the 2026 frosted card
  // animates in (Task #350 step 3).
  const formOpacity = useSharedValue(0);
  const formTranslate = useSharedValue(12);

  // Memora-glow expand on successful submit (Task #350 step 6) so the
  // auth screen doesn't snap-cut to the home tab.
  const handoffOpacity = useSharedValue(0);
  const handoffScale = useSharedValue(0.2);

  useEffect(() => {
    if (!submitting) {
      setShowSlowHint(false);
      return;
    }
    const timer = setTimeout(() => setShowSlowHint(true), 5000);
    return () => clearTimeout(timer);
  }, [submitting]);

  // Pause idle alive loops while the keyboard is up so input is never
  // visually contested by the breathing/spark loops.
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const sub1 = Keyboard.addListener(showEvt, () => setKeyboardOpen(true));
    const sub2 = Keyboard.addListener(hideEvt, () => setKeyboardOpen(false));
    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, []);

  // OS accessibility prefs — drive the reduce-motion handoff and the
  // FrostedCard transparency fallback (Task #350 a11y requirements).
  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((rm) => {
        if (!cancelled) setReduceMotion(rm);
      })
      .catch(() => {});
    const motionSub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (rm) => setReduceMotion(rm),
    );

    // `isReduceTransparencyEnabled` is iOS-only; on Android the call
    // resolves false. High-contrast mode (Android) routes through the
    // same fallback so the frosted blur never compromises legibility.
    const readTransparency = async () => {
      try {
        const a = AccessibilityInfo as unknown as {
          isReduceTransparencyEnabled?: () => Promise<boolean>;
          isHighTextContrastEnabled?: () => Promise<boolean>;
        };
        const rt = (await a.isReduceTransparencyEnabled?.()) ?? false;
        const hc = (await a.isHighTextContrastEnabled?.()) ?? false;
        if (!cancelled) setReduceTransparency(rt || hc);
      } catch {
        // ignore — fall back to frosted by default
      }
    };
    void readTransparency();

    return () => {
      cancelled = true;
      motionSub.remove();
    };
  }, []);

  // Wire the cinematic's settle into the form's fade-up. Reduce-motion
  // collapses both opacity + translate to a single short fade.
  const handleCinematicSettled = useCallback(() => {
    if (cinematicSettled) return;
    setCinematicSettled(true);
    if (reduceMotion) {
      formOpacity.value = withTiming(1, { duration: DURATIONS.fast });
      formTranslate.value = withTiming(0, { duration: DURATIONS.fast });
    } else {
      formOpacity.value = withTiming(1, { duration: DURATIONS.medium });
      formTranslate.value = withTiming(0, {
        duration: DURATIONS.medium,
        easing: EASING.out,
      });
    }
  }, [cinematicSettled, reduceMotion, formOpacity, formTranslate]);

  const formStyle = useAnimatedStyle(() => ({
    opacity: formOpacity.value,
    transform: [{ translateY: formTranslate.value }],
  }));

  const { login, signup, user, hasSeenOnboarding } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();
  const router = useRouter();

  // Hold the redirect for the brief glow-expand hand-off so the auth
  // screen doesn't snap-cut to the home tab. Once the glow finishes,
  // the underlying user state is still set so the redirect fires.
  if (user && !handoff) {
    if (!hasSeenOnboarding) return <Redirect href="/onboarding" />;
    return <Redirect href="/(app)/(tabs)" />;
  }

  const runHandoff = (): void => {
    if (handoffTriggeredRef.current) return;
    handoffTriggeredRef.current = true;
    setHandoff(true);
    // Reduce-motion gets a short plain fade instead of the 400ms
    // glow-expand so the redirect feels instant under that preference.
    const dur = reduceMotion ? HANDOFF_REDUCED_DURATION_MS : HANDOFF_DURATION_MS;
    handoffOpacity.value = withTiming(1, { duration: dur * 0.4 });
    handoffScale.value = withTiming(reduceMotion ? 1 : 14, {
      duration: dur,
      easing: reduceMotion ? Easing.linear : EASING.in,
    });
    setTimeout(() => {
      handoffOpacity.value = 0;
      handoffScale.value = 0.2;
      setHandoff(false);
    }, dur);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const cleanedEmail = email.trim();
    const cleanedDisplayName = displayName.trim();
    if (!cleanedEmail || !password) {
      setError("Please fill in all fields");
      return;
    }
    if (!isLogin && !cleanedDisplayName) {
      setError("Please enter your name");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      if (isLogin) {
        await login(cleanedEmail, password);
      } else {
        await signup(cleanedEmail, password, cleanedDisplayName);
      }
      haptics.play("capture");
      runHandoff();
    } catch (err: unknown) {
      haptics.play("error");
      setError(err instanceof Error ? err.message : "Something went wrong — please try again");
    } finally {
      setSubmitting(false);
    }
  };

  const handoffStyle = useAnimatedStyle(() => ({
    opacity: handoffOpacity.value,
    transform: [{ scale: handoffScale.value }],
  }));

  return (
    <SettleOnMount style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <GradientBackground style={StyleSheet.absoluteFill} />
        <AmbientBlobs />
        <RotatingBrandMark
          size={420}
          color={colors.primary}
          baseOpacity={0.07}
        />
      </View>

      <View style={styles.brandHeader}>
        <Text style={[styles.title, { color: colors.foreground }]}>MemTool</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Your notebook for the mind</Text>
      </View>

      <AuthCinematicStage
        ref={cinematicRef}
        mode={isLogin ? "login" : "signup"}
        paused={keyboardOpen}
        onSettle={handleCinematicSettled}
      />

      {/* Full-screen tap target while the cinematic plays so "tap
          anywhere to skip" works outside the stage bounds too. The
          form is pointerEvents="none" during this window, so this
          overlay reliably catches the tap. We forward the tap to the
          stage's imperative skip() so the timeline actually collapses
          (otherwise it would keep running while the form fades up). */}
      {!cinematicSettled ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip intro animation"
          testID="auth-cinematic-skip-overlay"
          style={StyleSheet.absoluteFill}
          onPress={() => {
            cinematicRef.current?.skip();
            handleCinematicSettled();
          }}
        />
      ) : null}

      <Animated.View
        style={formStyle}
        testID="auth-form-fade"
        // Hidden form must NOT swallow taps during the cinematic —
        // otherwise invisible inputs/buttons can fire submit/toggle
        // and "tap anywhere to skip" gets eaten before reaching the
        // cinematic stage. Restored to "auto" on settle.
        pointerEvents={cinematicSettled ? "auto" : "none"}
      >
      <FrostedCard
        backgroundColor={colors.card}
        borderColor={colors.border}
        reduceTransparency={reduceTransparency}
      >
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{isLogin ? "Welcome back" : "Create account"}</Text>

        {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}

        {!isLogin ? (
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Name"
            placeholderTextColor={colors.mutedForeground}
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
          />
        ) : null}

        <TextInput
          style={[styles.input, { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border }]}
          placeholder="Email"
          placeholderTextColor={colors.mutedForeground}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          maxLength={EMAIL_MAX_LENGTH}
        />

        <TextInput
          style={[styles.input, { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border }]}
          placeholder="Password"
          placeholderTextColor={colors.mutedForeground}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          maxLength={PASSWORD_MAX_LENGTH}
        />

        {/* CTA wrapped in LiftPress for the Mercury 2px lift on
            press. LiftPress carries no onPress here — GradientButton's
            internal AliveButton owns the actual handleSubmit dispatch
            and the scale-on-press feedback that already lives in the
            brand-gradient primitive. accessibilityRole="none" stops
            screen readers from announcing a duplicate "button"
            alongside the inner AliveButton, and the inner Pressable
            keeps responder ownership so handleSubmit fires exactly
            once per tap (no double-dispatch). */}
        <LiftPress
          accessibilityRole="none"
          style={styles.button}
        >
          <GradientButton
            title={submitting ? (isLogin ? "Signing in..." : "Creating...") : isLogin ? "Sign In" : "Sign Up"}
            onPress={handleSubmit}
            disabled={submitting}
          />
        </LiftPress>

        {showSlowHint ? (
          <Text
            style={[styles.slowHintText, { color: colors.mutedForeground }]}
          >
            Connection looks slow…
          </Text>
        ) : null}

        {isLogin ? (
          <Pressable
            style={[styles.toggleBtn, { marginTop: 12 }]}
            onPress={() => {
              if (submitting) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              router.push("/forgot-password");
            }}
            accessibilityRole="button"
            accessibilityLabel="Forgot password?"
            testID="forgot-password-link"
          >
            <Text style={[styles.toggleText, { color: colors.mutedForeground }]}>
              Forgot password?
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          style={styles.toggleBtn}
          onPress={() => {
            if (submitting) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setIsLogin(!isLogin);
            setError("");
          }}
        >
          <Text style={[styles.toggleText, { color: colors.primary }]}>
            {isLogin ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </Text>
        </Pressable>
      </FrostedCard>
      </Animated.View>

      {handoff ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.handoff, { backgroundColor: "#7ec8ff" }, handoffStyle]}
          testID="auth-handoff-glow"
        />
      ) : null}
    </SettleOnMount>
  );
}

/**
 * Frosted card surface — the 2026 layout per Task #350 step 3. Uses a
 * BlurView frost over the gradient on iOS/Android; falls back to a
 * solid card colour when reduce-transparency / high-contrast is on or
 * the platform doesn't render the blur natively (web).
 */
function FrostedCard({
  children,
  backgroundColor,
  borderColor,
  reduceTransparency,
}: {
  children: React.ReactNode;
  backgroundColor: string;
  borderColor: string;
  reduceTransparency: boolean;
}) {
  // Accessibility fallback: when the user has Reduce Transparency or
  // High Contrast on, drop the BlurView entirely and use a fully
  // opaque card. The frost is a "nice to have" — legibility wins.
  if (reduceTransparency) {
    return (
      <View
        style={[styles.cardWrap, { borderColor, backgroundColor }]}
        testID="auth-frosted-card-solid"
      >
        <View style={styles.cardInner}>{children}</View>
      </View>
    );
  }
  return (
    <View
      style={[styles.cardWrap, { borderColor }]}
      testID="auth-frosted-card-blur"
    >
      <BlurView
        intensity={Platform.OS === "android" ? 60 : 32}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor, opacity: 0.55 }]} />
      <View style={styles.cardInner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
    justifyContent: "center",
  },
  brandHeader: {
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 36,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
    opacity: 0.85,
  },
  cardWrap: {
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginTop: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
    elevation: 12,
  },
  cardInner: {
    padding: 22,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    marginBottom: 18,
    textAlign: "center",
    letterSpacing: -0.2,
  },
  input: {
    height: 54,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  button: {
    marginTop: 8,
  },
  toggleBtn: {
    marginTop: 18,
    alignItems: "center",
    padding: 8,
  },
  toggleText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  errorText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    marginBottom: 14,
    textAlign: "center",
  },
  slowHintText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    fontWeight: "400",
    textAlign: "center",
    marginTop: 12,
  },
  handoff: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    alignSelf: "center",
    top: "40%",
  },
});
