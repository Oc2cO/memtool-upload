import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { isWeb } from "@/lib/platform";

import { useAuth } from "@/context/AuthContext";
import {
  ChatThread,
  ChipsInput,
  FreeTextInput,
  SubmittingOverlay,
  type ChatMessage,
} from "@/components/ChatThread";
import { MemCharacter } from "@/components/MemCharacter";
import {
  CELEBRATION,
  ONBOARDING_SCRIPT,
  SKIP_ALL_LABEL,
  type Turn,
} from "@/lib/onboardingChat";
import { buildProfileFromAnswers } from "@/lib/profile";
import { useProfile } from "@/context/ProfileContext";
import { useHaptics } from "@/lib/haptics";
import { useBreathingEnabled } from "@/lib/aliveUI";
import { GradientBackground } from "@/components/alive/GradientBackground";
import { AmbientBlobs } from "@/components/alive/AmbientBlobs";
import { RotatingBrandMark } from "@/components/alive/RotatingBrandMark";
import colors from "@/constants/colors";

// Onboarding shares its palette with the visual tour in
// `app/onboarding.tsx`. Both screens read from the same token so a
// future tweak to the warm palette only needs to land in one file.
const PALETTE = colors.dark.onboarding;

const TYPING_GAP_MS = 600;

interface ChatState {
  cursor: number;
  messages: ChatMessage[];
  rawChipPicks: string[];
  freeText: string[];
  showTyping: boolean;
  promptedForCursor: number;
}

type Phase = "chat" | "saving" | "celebrate" | "done";

export default function OnboardingChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const { user, hasSeenOnboarding } = useAuth();
  const { save: saveProfileViaContext } = useProfile();
  const haptics = useHaptics();

  const [state, setState] = useState<ChatState>(() => ({
    cursor: 0,
    messages: [],
    rawChipPicks: [],
    freeText: [],
    showTyping: false,
    promptedForCursor: -1,
  }));
  const [phase, setPhase] = useState<Phase>("chat");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const advancingRef = useRef(false);
  useEffect(() => {
    advancingRef.current = false;
  }, [state.cursor]);

  const isResetFlow = params.from === "settings";

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const completeChat = useCallback(async () => {
    setPhase("saving");
    const input = buildProfileFromAnswers(state.rawChipPicks, state.freeText);
    let savedOk = false;
    try {
      if (user?.email) {
        await saveProfileViaContext(input);
        savedOk = true;
      }
    } catch (err) {
      if (__DEV__) console.log("[onboarding-chat] saveProfile failed", err);
    }
    if (cancelledRef.current) return;
    if (!savedOk && user?.email) {
      setErrorMsg("Couldn't save right now — you can re-do this from Settings.");
    }
    setPhase("celebrate");
  }, [state.rawChipPicks, state.freeText, user?.email, saveProfileViaContext]);

  useEffect(() => {
    if (phase !== "chat") return;
    const turn: Turn | undefined = ONBOARDING_SCRIPT[state.cursor];
    if (!turn) {
      void completeChat();
      return;
    }
    if (turn.kind !== "mem-say" && state.promptedForCursor === state.cursor) {
      if (state.showTyping) {
        setState((s) => ({ ...s, showTyping: false }));
      }
      return;
    }
    setState((s) => ({ ...s, showTyping: true }));
    const t = setTimeout(() => {
      if (cancelledRef.current) return;
      setState((s) => {
        if (s.cursor !== state.cursor) return s;
        const text = turn.kind === "mem-say" ? turn.text : turn.prompt;
        const bubbleId =
          turn.kind === "mem-say" ? turn.id : `${turn.id}-prompt`;
        const next: ChatState = {
          ...s,
          showTyping: false,
          messages: [
            ...s.messages,
            { id: bubbleId, role: "mem", text },
          ],
        };
        if (turn.kind === "mem-say") {
          next.cursor = s.cursor + 1;
        } else {
          next.promptedForCursor = s.cursor;
        }
        return next;
      });
    }, TYPING_GAP_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cursor, state.promptedForCursor, phase]);

  const currentTurn: Turn | undefined = ONBOARDING_SCRIPT[state.cursor];
  const promptVisible =
    !!currentTurn &&
    currentTurn.kind !== "mem-say" &&
    state.promptedForCursor === state.cursor;

  const submitFreeText = useCallback(
    (turn: Turn, value: string) => {
      if (turn.kind !== "ask-free-text") return;
      if (advancingRef.current) return;
      advancingRef.current = true;
      Haptics.selectionAsync();
      const userMsg: ChatMessage = {
        id: `${turn.id}-a`,
        role: "user",
        text: value,
      };
      setState((s) => ({
        ...s,
        messages: [...s.messages, userMsg],
        freeText: [...s.freeText, value],
        cursor: s.cursor + 1,
      }));
    },
    [],
  );

  const skipFreeText = useCallback((turn: Turn) => {
    if (turn.kind !== "ask-free-text") return;
    if (advancingRef.current) return;
    advancingRef.current = true;
    Haptics.selectionAsync();
    setState((s) => ({ ...s, cursor: s.cursor + 1 }));
  }, []);

  const submitChips = useCallback((turn: Turn, picked: string[]) => {
    if (turn.kind !== "ask-traits") return;
    if (advancingRef.current) return;
    advancingRef.current = true;
    Haptics.selectionAsync();
    const summary = picked.length === 0 ? "(skipped)" : picked.join(" · ");
    const userMsg: ChatMessage = {
      id: `${turn.id}-a`,
      role: "user",
      text: summary,
    };
    setState((s) => ({
      ...s,
      messages: [...s.messages, userMsg],
      rawChipPicks: [...s.rawChipPicks, ...picked],
      cursor: s.cursor + 1,
    }));
  }, []);

  const skipChips = useCallback((turn: Turn) => {
    if (turn.kind !== "ask-traits") return;
    if (advancingRef.current) return;
    advancingRef.current = true;
    Haptics.selectionAsync();
    setState((s) => ({ ...s, cursor: s.cursor + 1 }));
  }, []);

  const skipEverything = useCallback(async () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    Haptics.selectionAsync();
    setPhase("saving");
    const input = buildProfileFromAnswers([], []);
    try {
      if (user?.email) {
        await saveProfileViaContext(input);
      }
    } catch (err) {
      if (__DEV__) console.log("[onboarding-chat] skip saveProfile failed", err);
    }
    if (cancelledRef.current) return;
    if (isResetFlow || hasSeenOnboarding) {
      router.back();
    } else {
      router.replace({ pathname: "/onboarding", params: { resume: "meet" } });
    }
  }, [user?.email, isResetFlow, hasSeenOnboarding, router, saveProfileViaContext]);

  const handleCelebrationDone = useCallback(() => {
    setPhase("done");
    // Profile chat saved → use the "capture" verb so the
    // confirmation feels identical to other "we got it" moments
    // (login, memory save, settings save).
    haptics.play("capture");
    if (isResetFlow || hasSeenOnboarding) {
      router.back();
    } else {
      router.replace({ pathname: "/onboarding", params: { resume: "meet" } });
    }
  }, [isResetFlow, hasSeenOnboarding, router, haptics]);

  const inputNode = useMemo<React.ReactNode | null>(() => {
    if (phase !== "chat" || !currentTurn) return null;
    if (!promptVisible) return null;
    if (currentTurn.kind === "ask-free-text") {
      return (
        <FreeTextInput
          key={currentTurn.id}
          placeholder={currentTurn.placeholder}
          skippable={currentTurn.skippable}
          onSubmit={(v) => submitFreeText(currentTurn, v)}
          onSkip={() => skipFreeText(currentTurn)}
          palette={PALETTE}
        />
      );
    }
    if (currentTurn.kind === "ask-traits") {
      return (
        <ChipsInput
          key={currentTurn.id}
          options={currentTurn.options}
          min={currentTurn.min}
          max={currentTurn.max}
          skippable={currentTurn.skippable}
          onSubmit={(picked) => submitChips(currentTurn, picked)}
          onSkip={() => skipChips(currentTurn)}
          palette={PALETTE}
        />
      );
    }
    return null;
  }, [
    phase,
    currentTurn,
    promptVisible,
    submitFreeText,
    skipFreeText,
    submitChips,
    skipChips,
  ]);

  // Above-composer skip link (Task #284). The composer no longer
  // hosts its own skip button; the parent renders the skip
  // affordance here so it never competes visually with the send
  // button. We surface the same `SKIP_ALL_LABEL` ("Skip — Mem will
  // learn as we go") and route to `skipEverything` so the user has
  // one clear way to bow out of the whole tour.
  const aboveInputNode = useMemo<React.ReactNode | null>(() => {
    if (phase !== "chat") return null;
    return (
      <Pressable
        onPress={() => {
          void skipEverything();
        }}
        hitSlop={10}
        style={styles.aboveInputSkip}
        accessibilityRole="button"
        accessibilityLabel={SKIP_ALL_LABEL}
      >
        <Text
          style={[styles.aboveInputSkipText, { color: PALETTE.textMuted }]}
        >
          {SKIP_ALL_LABEL}
        </Text>
      </Pressable>
    );
  }, [phase, skipEverything]);

  if (!user) return <Redirect href="/login" />;

  return (
    <View style={[styles.container, { backgroundColor: PALETTE.bg }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <GradientBackground style={StyleSheet.absoluteFill} />
        <AmbientBlobs />
        <RotatingBrandMark size={420} color={PALETTE.hot} baseOpacity={0.07} />
      </View>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={[styles.headerTitle, { color: PALETTE.text }]}>
          A quick hello
        </Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ChatThread
          messages={state.messages}
          showTyping={state.showTyping}
          input={inputNode}
          aboveInput={aboveInputNode}
          palette={PALETTE}
        />
      </KeyboardAvoidingView>

      {phase === "saving" ? (
        <SubmittingOverlay palette={PALETTE} message="Saving…" />
      ) : null}

      {phase === "celebrate" ? (
        <LockedCelebration
          palette={PALETTE}
          errorMsg={errorMsg}
          onDone={handleCelebrationDone}
        />
      ) : null}
    </View>
  );
}

function LockedCelebration({
  palette,
  errorMsg,
  onDone,
}: {
  palette: typeof PALETTE;
  errorMsg: string | null;
  onDone: () => void;
}) {
  const breathing = useBreathingEnabled();
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduceMotion(v);
      })
      .catch(() => {
        if (mounted) setReduceMotion(false);
      });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v) => {
        if (mounted) setReduceMotion(Boolean(v));
      },
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const motionResolved = reduceMotion !== null;
  const animate = motionResolved && !reduceMotion && breathing;

  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const bgPulse = useSharedValue(0);

  useEffect(() => {
    if (!motionResolved) return;
    if (animate) {
      scale.value = 0.95;
      opacity.value = 0.6;
      scale.value = withSequence(
        withTiming(1.05, { duration: 200, easing: Easing.out(Easing.cubic) }),
        withTiming(1.0, { duration: 150, easing: Easing.out(Easing.quad) }),
      );
      opacity.value = withTiming(1, {
        duration: 250,
        easing: Easing.out(Easing.cubic),
      });
      bgPulse.value = withSequence(
        withTiming(1, {
          duration: Math.round(CELEBRATION.durationMs / 2),
          easing: Easing.out(Easing.cubic),
        }),
        withTiming(0, {
          duration: Math.round(CELEBRATION.durationMs / 2),
          easing: Easing.inOut(Easing.cubic),
        }),
      );
    } else {
      scale.value = 1;
      opacity.value = 1;
      bgPulse.value = 0;
    }
    const t = setTimeout(onDone, CELEBRATION.durationMs);
    return () => clearTimeout(t);
  }, [motionResolved, animate, onDone, opacity, scale, bgPulse]);

  const memAnim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const bgAnim = useAnimatedStyle(() => {
    if (isWeb) return { backgroundColor: palette.bgDeep };
    return {
      backgroundColor: interpolateColor(
        bgPulse.value,
        [0, 1],
        [palette.bgDeep, "#1a1030"],
      ),
    };
  });

  return (
    <Animated.View
      entering={animate && !isWeb ? FadeIn.duration(180) : undefined}
      exiting={animate && !isWeb ? FadeOut.duration(220) : undefined}
      style={[StyleSheet.absoluteFill, styles.celebrate, bgAnim]}
    >
      <LinearGradient
        colors={["rgba(180,122,255,0.15)", "rgba(255,213,111,0.10)"]}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={memAnim}>
        <MemCharacter size={160} mood="celebrate" color={palette.mem} />
      </Animated.View>
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.celebrateText, { color: palette.text }]}
      >
        {CELEBRATION.message}
      </Text>
      {errorMsg ? (
        <Text style={[styles.celebrateNote, { color: palette.textMuted }]}>
          {errorMsg}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  aboveInputSkip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  aboveInputSkipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  celebrate: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 24,
  },
  celebrateText: {
    fontSize: 22,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    lineHeight: 30,
  },
  celebrateNote: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: -8,
  },
});
