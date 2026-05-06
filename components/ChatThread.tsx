import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useKeyboardAnimation } from "@/lib/useKeyboardAnimation";

import { MemCharacter } from "@/components/MemCharacter";
import { FrostBackground } from "@/components/alive/FrostBackground";
import type { MemSpeechController } from "@/lib/useMemSpeech";
import { spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

/**
 * Reusable chat surface for Mem conversations.
 *
 * Owned by the *parent* (`onboarding-chat.tsx`, `ai-guide.tsx`).
 * The parent decides:
 *   - which messages exist on the thread,
 *   - which input mode (free-text / chips / none) is currently active,
 *   - what happens when the user submits,
 *   - what (if anything) renders above the composer (skip link, etc).
 *
 * `ChatThread` is purely presentational + accessibility plumbing.
 * It does not know about the profile, the API, or the script.
 *
 * The composer (`FreeTextInput` / `ChipsInput`) is the modern,
 * messenger-style pill: a single rounded surface containing the text
 * field with a circular send button tucked inside the right edge.
 * The send button reveals as the user types and tucks back away when
 * the field clears, mirroring iMessage / Messenger conventions.
 */

export interface ChatMessage {
  id: string;
  role: "mem" | "user";
  text: string;
  /**
   * When set, render this many words from `text` instead of the
   * whole string. Used by the talking-Mem stage (Task #283) to
   * stream Mem replies word-by-word in time with the spoken voice.
   * `accessibilityLabel` always carries the *full* text so VoiceOver
   * announces the entire sentence rather than the partial fragments.
   */
  visibleWordCount?: number;
}

interface PaletteShape {
  bg: string;
  bgDeep: string;
  mem: string;
  hot: string;
  cool: string;
  pink: string;
  text: string;
  textMuted: string;
  card: string;
  border: string;
}

interface FreeTextInputProps {
  placeholder?: string;
  /**
   * Kept for API compatibility. The composer no longer renders an
   * inline skip button — the parent screen is expected to render its
   * skip affordance above the composer via `ChatThread`'s
   * `aboveInput` slot. Leaving the prop in place so existing call
   * sites don't need a coordinated rename.
   */
  skippable: boolean;
  onSubmit: (value: string) => void;
  /** Same compatibility note as `skippable`. */
  onSkip?: () => void;
  palette: PaletteShape;
  disabled?: boolean;
}

interface ChipsInputProps {
  options: readonly string[];
  min: number;
  max: number;
  /** Compatibility-only — see {@link FreeTextInputProps.skippable}. */
  skippable: boolean;
  onSubmit: (selected: string[]) => void;
  /** Compatibility-only — see {@link FreeTextInputProps.skippable}. */
  onSkip?: () => void;
  palette: PaletteShape;
  disabled?: boolean;
}

// Base top padding inside the chat thread's scroll content. Kept as a
// module-level constant so screens that overlay the thread with an
// absolutely-positioned header (Task #96) can compute a correct
// combined `paddingTop` without depending on `StyleSheet.create`'s
// runtime field shape.
const THREAD_BASE_TOP_PADDING = spacing.base;

interface ChatThreadProps {
  messages: readonly ChatMessage[];
  /** When true, render the bouncing-dots typing indicator at the end. */
  showTyping: boolean;
  /** Optional inline input rendered below the thread. */
  input?: React.ReactNode;
  composerBottomInset?: number;
  /**
   * Optional node rendered just above the composer (e.g. a small
   * "Skip — Mem will learn as we go" link on onboarding). Kept as a
   * generic slot so the composer stays decoupled from any one
   * screen's chrome — the AI chat passes nothing here.
   */
  aboveInput?: React.ReactNode;
  palette: PaletteShape;
  /**
   * When false, the per-bubble Mem avatar (the tiny in-line head)
   * is hidden — used by the AI Guide screen (Task #283), where
   * Mem lives in a dedicated stage above the thread instead. The
   * onboarding chat continues to render the avatar (default true)
   * so its visuals are unchanged.
   */
  showAvatars?: boolean;
  /**
   * Optional scroll handler. Use `useAnimatedScrollHandler` to drive
   * the scroll-frosted header (Task #96) without bouncing the value
   * across the JS bridge. The thread switches to `Animated.ScrollView`
   * automatically when this prop is present.
   */
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /**
   * Extra top padding inside the scroll content. The screen passes
   * the measured header height here when overlaying an absolutely-
   * positioned frosted header so the first message bubble isn't
   * initially obscured.
   */
  contentTopInset?: number;
  /**
   * Optional scroll shared value driving a frosted-glass backdrop
   * behind the input area at the bottom of the thread (Task #110).
   * When provided, the input area mirrors the sticky-header recipe:
   * transparent at rest, ramping to the same frost intensity as the
   * user scrolls past `SCROLL_FROST_THRESHOLD`. Pass the *same*
   * shared value the screen feeds into the header's `<FrostBackground>`
   * so both surfaces stay visually in sync. Omit on screens (e.g.
   * onboarding) where the input should remain on a flat background.
   */
  scrollY?: SharedValue<number>;
  /**
   * Optional speech controller from `useMemSpeech`. When provided,
   * the in-bubble Mem avatar on the most recent Mem message
   * lip-syncs to the spoken reply via the same `mouthOpen` +
   * `viseme` stream that drives the dedicated stage Mem (Task
   * #334). Passing the same controller the parent uses to call
   * `speech.speak(...)` keeps the audio and the in-bubble lip
   * shapes perfectly synchronized — every AI reply rendered into
   * the thread is voiced and animated end-to-end without any
   * per-bubble TTS plumbing in the parent. Omit on screens that
   * don't speak (onboarding script, tests).
   */
  speech?: MemSpeechController;
}

export function ChatThread({
  messages,
  showTyping,
  input,
  composerBottomInset = 0,
  aboveInput,
  palette,
  showAvatars = true,
  onScroll,
  contentTopInset = 0,
  scrollY,
  speech,
}: ChatThreadProps) {
  const scrollRef = useRef<Animated.ScrollView>(null);

  // Auto-scroll to bottom whenever the message list grows or the
  // typing indicator/input toggles. setTimeout(0) gives RN one tick
  // to lay out the new bubble before we scroll.
  useEffect(() => {
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 0);
    return () => clearTimeout(t);
  }, [messages.length, showTyping, input != null]);

  const reduceMotion = useReduceMotion();
  const { progress } = useKeyboardAnimation();

  // Subtle keyboard-lift on the composer surface. Translates a few
  // pixels up + nudges shadow opacity as the keyboard opens. The
  // parent's `KeyboardAvoidingView` already keeps the composer above
  // the keyboard — this animation is purely the *polish* lift on top
  // of that, so the magnitudes are intentionally tiny.
  const surfaceAnim = useAnimatedStyle(() => {
    if (reduceMotion) return {};
    const p = progress.value;
    return {
      transform: [{ translateY: -p * 4 }],
      shadowOpacity: 0.04 + p * 0.14,
    };
  });

  const showInputArea = input != null || aboveInput != null;

  // Index of the most recent Mem message — only that bubble's
  // avatar gets the live `mouthOpen`/`viseme` stream so older
  // bubbles don't all flap their mouths at once when a new reply
  // is being spoken.
  const lastMemIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "mem") return i;
    }
    return -1;
  })();

  return (
    <View style={styles.threadWrap}>
      <Animated.ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.threadContent,
          // Hardcoded base matches `styles.threadContent.paddingTop`
          // below — `StyleSheet.create` may freeze/register values such
          // that reading a field back at runtime is unreliable, so we
          // re-state the constant here when applying the optional inset
          // for an absolutely-positioned parent header (Task #96).
          contentTopInset > 0
            ? { paddingTop: THREAD_BASE_TOP_PADDING + contentTopInset }
            : null,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={onScroll ? 16 : undefined}
      >
        {messages.map((m, i) => (
          <Bubble
            key={m.id}
            message={m}
            palette={palette}
            isFirst={i === 0 || messages[i - 1]?.role !== m.role}
            reduceMotion={reduceMotion}
            showAvatar={showAvatars}
            speech={i === lastMemIndex ? speech : undefined}
          />
        ))}
        {showTyping ? <TypingDots palette={palette} showAvatar={showAvatars} /> : null}
      </Animated.ScrollView>
      {showInputArea ? (
        <Animated.View
          testID="chat-composer-surface"
          style={[styles.inputAreaShadow, surfaceAnim]}
        >
          <View
            style={[
              styles.inputArea,
              composerBottomInset > 0
                ? { paddingBottom: spacing.md + composerBottomInset }
                : null,
            ]}
          >
            {scrollY ? (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <FrostBackground scrollY={scrollY} />
              </View>
            ) : null}
            {aboveInput != null ? (
              <View style={styles.aboveInput}>{aboveInput}</View>
            ) : null}
            {input}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * Returns whether the OS reduce-motion preference is on. Mirrors the
 * pattern used by `SettleOnMount` and `ProCelebrationOverlay` so the
 * fallback path is consistent app-wide. (Reanimated's
 * `useReducedMotion` isn't in the jest mock, so we use the bare
 * AccessibilityInfo plumbing to keep tests clean.)
 */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (!cancelled) setReduce(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v) => setReduce(Boolean(v)),
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
  return reduce;
}

function Bubble({
  message,
  palette,
  isFirst,
  reduceMotion,
  showAvatar,
  speech,
}: {
  message: ChatMessage;
  palette: PaletteShape;
  isFirst: boolean;
  reduceMotion: boolean;
  showAvatar: boolean;
  speech?: MemSpeechController;
}) {
  const isMem = message.role === "mem";

  // Streaming reveal: when `visibleWordCount` is set on a Mem
  // bubble, render only that many words from the front of the
  // text. The full text always lives in `accessibilityLabel` so
  // VoiceOver reads the whole sentence (per task brief).
  const renderedText =
    isMem && typeof message.visibleWordCount === "number"
      ? sliceWords(message.text, message.visibleWordCount)
      : message.text;

  // Modern messenger-style entrance: slide up + fade + tiny scale
  // spring, with a small horizontal "tail" offset (Mem from the left,
  // user from the right) so each bubble feels like it's emerging
  // from its speaker. Reduce Motion → plain fade.
  const opacity = useSharedValue(0);
  const ty = useSharedValue(reduceMotion ? 0 : 16);
  const tx = useSharedValue(reduceMotion ? 0 : isMem ? -8 : 8);
  const scale = useSharedValue(reduceMotion ? 1 : 0.96);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = withTiming(1, { duration: 220 });
      return;
    }
    opacity.value = withTiming(1, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
    ty.value = withSpring(0, { damping: 18, stiffness: 200, mass: 0.7 });
    tx.value = withSpring(0, { damping: 18, stiffness: 200, mass: 0.7 });
    scale.value = withSpring(1, { damping: 16, stiffness: 220, mass: 0.6 });
  }, [reduceMotion, opacity, ty, tx, scale]);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.bubbleRow,
        isMem ? styles.bubbleRowMem : styles.bubbleRowUser,
        { marginTop: isFirst ? 14 : 4 },
        anim,
      ]}
    >
      {isMem && showAvatar ? (
        <View style={styles.avatar}>
          {isFirst ? (
            <MemCharacter
              size={36}
              mood="happy"
              color={palette.mem}
              mouthOpen={speech?.mouthOpen}
              viseme={speech?.viseme}
            />
          ) : (
            <View style={{ width: 36, height: 36 }} />
          )}
        </View>
      ) : null}

      <View
        style={[
          styles.bubble,
          isMem
            ? {
                backgroundColor: palette.card,
                borderColor: palette.border,
                borderTopLeftRadius: isFirst ? 6 : 18,
              }
            : {
                backgroundColor: palette.hot,
                borderColor: palette.hot,
                borderTopRightRadius: isFirst ? 6 : 18,
              },
        ]}
      >
        <Text
          style={[
            styles.bubbleText,
            { color: isMem ? palette.text : "#FFFFFF" },
          ]}
          accessibilityLabel={`${isMem ? "Mem" : "You"} said: ${message.text}`}
        >
          {renderedText}
        </Text>
      </View>
    </Animated.View>
  );
}

/**
 * Take the first `count` whitespace-separated words from `text`.
 * Returns the full string when `count` is at or past the word
 * count, the empty string when `count <= 0`. Preserves the
 * trailing punctuation of the last visible word so a streamed
 * mid-sentence reveal reads naturally ("Hi —" not "Hi").
 */
export function sliceWords(text: string, count: number): string {
  if (count <= 0) return "";
  const words = text.split(/(\s+)/);
  let visible = 0;
  let out = "";
  for (const seg of words) {
    if (/^\s+$/.test(seg)) {
      if (visible < count) out += seg;
      continue;
    }
    if (seg.length === 0) continue;
    if (visible >= count) break;
    out += seg;
    visible += 1;
  }
  return out;
}

function TypingDots({
  palette,
  showAvatar = true,
}: {
  palette: PaletteShape;
  showAvatar?: boolean;
}) {
  const a = useSharedValue(0.35);
  const b = useSharedValue(0.35);
  const c = useSharedValue(0.35);
  // Faint ambient halo behind the dots — a gentle breathing bloom
  // that matches the slower dot cadence, hinting "Mem is thinking"
  // without being noisy.
  const halo = useSharedValue(0.08);

  useEffect(() => {
    // Slightly slower than the previous 420ms cadence — softer feel,
    // less "loading spinner" energy.
    const cfg = { duration: 540, easing: Easing.inOut(Easing.quad) };
    a.value = withRepeat(
      withSequence(withTiming(1, cfg), withTiming(0.35, cfg)),
      -1,
      true,
    );
    b.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: 180 }),
        withTiming(1, cfg),
        withTiming(0.35, cfg),
      ),
      -1,
      true,
    );
    c.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: 360 }),
        withTiming(1, cfg),
        withTiming(0.35, cfg),
      ),
      -1,
      true,
    );
    halo.value = withRepeat(
      withSequence(
        withTiming(0.18, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.06, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );
  }, [a, b, c, halo]);

  const dotA = useAnimatedStyle(() => ({ opacity: a.value }));
  const dotB = useAnimatedStyle(() => ({ opacity: b.value }));
  const dotC = useAnimatedStyle(() => ({ opacity: c.value }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: halo.value }));

  return (
    <View style={[styles.bubbleRow, styles.bubbleRowMem, { marginTop: 4 }]}>
      {showAvatar ? (
        <View style={styles.avatar}>
          <View style={{ width: 36, height: 36 }} />
        </View>
      ) : null}
      <View
        style={[
          styles.bubble,
          styles.typingBubble,
          { backgroundColor: palette.card, borderColor: palette.border },
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.typingHalo,
            { backgroundColor: palette.mem },
            haloStyle,
          ]}
        />
        <Animated.View
          style={[styles.typingDot, { backgroundColor: palette.text }, dotA]}
        />
        <Animated.View
          style={[styles.typingDot, { backgroundColor: palette.text }, dotB]}
        />
        <Animated.View
          style={[styles.typingDot, { backgroundColor: palette.text }, dotC]}
        />
      </View>
    </View>
  );
}

/**
 * Circular send button used by both `FreeTextInput` and `ChipsInput`.
 * Hidden when `visible` is false; fades + scales in with a small
 * spring when it becomes visible. While `busy` is true the icon
 * swaps to a tiny activity indicator so the user gets immediate
 * feedback that the send is in flight.
 */
function CircularSendButton({
  visible,
  busy,
  onPress,
  palette,
  accessibilityLabel,
  reduceMotion,
}: {
  visible: boolean;
  busy: boolean;
  onPress: () => void;
  palette: PaletteShape;
  accessibilityLabel: string;
  reduceMotion: boolean;
}) {
  const opacity = useSharedValue(visible ? 1 : 0);
  const scale = useSharedValue(visible ? 1 : 0.6);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = visible ? 1 : 0;
      scale.value = 1;
      return;
    }
    if (visible) {
      opacity.value = withTiming(1, {
        duration: 140,
        easing: Easing.out(Easing.cubic),
      });
      scale.value = withSpring(1, {
        damping: 14,
        stiffness: 240,
        mass: 0.5,
      });
    } else {
      opacity.value = withTiming(0, {
        duration: 120,
        easing: Easing.in(Easing.cubic),
      });
      scale.value = withTiming(0.6, { duration: 120 });
    }
  }, [visible, reduceMotion, opacity, scale]);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.sendBtnWrap, anim]}
    >
      <Pressable
        onPress={() => {
          if (!visible || busy) return;
          // Light selection haptic on tap. Parents may also fire
          // their own haptic on the resulting state change — iOS
          // dedupes back-to-back selection feedback so the small
          // overlap is harmless.
          Haptics.selectionAsync().catch(() => {});
          onPress();
        }}
        disabled={!visible || busy}
        style={[styles.sendBtn, { backgroundColor: palette.hot }]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: !visible || busy, busy }}
        hitSlop={6}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Feather name="arrow-up" size={18} color="#FFFFFF" />
        )}
      </Pressable>
    </Animated.View>
  );
}

export function FreeTextInput({
  placeholder,
  onSubmit,
  palette,
  disabled,
}: FreeTextInputProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const trimmed = value.trim();
  const hasText = trimmed.length > 0;
  const reduceMotion = useReduceMotion();

  const submit = () => {
    if (!hasText || disabled) return;
    const next = trimmed;
    onSubmit(next);
    setValue("");
  };

  return (
    <View style={styles.composerBar}>
      <View
        style={[
          styles.pill,
          {
            backgroundColor: palette.card,
            borderColor: focused ? palette.hot : palette.border,
          },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder={placeholder ?? "Type your answer…"}
          placeholderTextColor={palette.textMuted}
          editable={!disabled}
          multiline
          maxLength={500}
          style={[styles.pillInput, { color: palette.text }]}
          returnKeyType="send"
          // `blurOnSubmit` matters on Android only — on iOS multiline
          // inputs always insert a newline on Enter, and the hardware
          // "send" key fires `onSubmitEditing` independently.
          blurOnSubmit
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={submit}
          accessibilityLabel="Your answer to Mem"
          textBreakStrategy="simple"
        />
        <CircularSendButton
          visible={hasText}
          busy={!!disabled && hasText}
          onPress={submit}
          palette={palette}
          accessibilityLabel="Send your answer"
          reduceMotion={reduceMotion}
        />
      </View>
    </View>
  );
}

function Chip({
  label,
  active,
  disabled,
  onPress,
  palette,
  reduceMotion,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  palette: PaletteShape;
  reduceMotion: boolean;
}) {
  const scale = useSharedValue(1);

  const onPressIn = () => {
    if (reduceMotion) return;
    scale.value = withTiming(0.97, {
      duration: 80,
      easing: Easing.out(Easing.cubic),
    });
  };
  const onPressOut = () => {
    if (reduceMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withSpring(1, { damping: 14, stiffness: 260, mass: 0.5 });
  };

  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={anim}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        style={[
          styles.chip,
          {
            backgroundColor: active ? palette.hot : palette.card,
            borderColor: active ? palette.hot : palette.border,
            borderWidth: active ? 1 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`Trait ${label}`}
      >
        <Text
          style={[
            styles.chipText,
            { color: active ? "#FFFFFF" : palette.text },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function ChipsInput({
  options,
  min,
  max,
  onSubmit,
  palette,
  disabled,
}: ChipsInputProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const enough = selected.length >= min;
  const canSend = enough && !disabled;
  const reduceMotion = useReduceMotion();

  const toggle = (option: string) => {
    if (disabled) return;
    setSelected((prev) => {
      if (prev.includes(option)) {
        return prev.filter((p) => p !== option);
      }
      if (prev.length >= max) return prev;
      return [...prev, option];
    });
  };

  // The send button is rendered as a sibling of the chips inside the
  // wrapping `chipsRow` (Task #295) so it always sits next to the
  // last chip and stays in view alongside the selectable options —
  // even on long lists where a separate bottom action row could be
  // pushed below the keyboard. The wrapper is always mounted so
  // crossing the `min` threshold doesn't reflow the chip grid;
  // `CircularSendButton` fades/scales itself in via `visible`,
  // mirroring the free-text composer's send affordance.
  return (
    <View style={styles.composerBar}>
      <View style={styles.chipsRow}>
        {options.map((opt) => (
          <Chip
            key={opt}
            label={opt}
            active={selected.includes(opt)}
            disabled={disabled}
            onPress={() => toggle(opt)}
            palette={palette}
            reduceMotion={reduceMotion}
          />
        ))}
        <View style={styles.chipsInlineSend}>
          <CircularSendButton
            visible={enough}
            busy={!!disabled && enough}
            onPress={() => {
              if (canSend) onSubmit([...selected]);
            }}
            palette={palette}
            accessibilityLabel="Confirm trait selection"
            reduceMotion={reduceMotion}
          />
        </View>
      </View>
    </View>
  );
}

export function SubmittingOverlay({
  palette,
  message,
}: {
  palette: PaletteShape;
  message: string;
}) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      <View
        style={[
          styles.overlayCard,
          { backgroundColor: palette.bg, borderColor: palette.border },
        ]}
      >
        <ActivityIndicator color={palette.mem} />
        <Text style={[styles.overlayText, { color: palette.text }]}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  threadWrap: { flex: 1 },
  threadContent: {
    paddingHorizontal: spacing.base,
    paddingTop: THREAD_BASE_TOP_PADDING,
    paddingBottom: spacing.lg,
  },
  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  bubbleRowMem: { justifyContent: "flex-start" },
  bubbleRowUser: { justifyContent: "flex-end" },
  avatar: {
    width: 36,
    height: 36,
    marginRight: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  bubble: {
    maxWidth: "78%",
    borderWidth: 1,
    // 18: deliberate one-off — chat bubbles want a slightly softer
    // corner than radius.md (16) but a tight corner on the
    // first-of-run side (6) preserves the "speech tail" look.
    borderRadius: 18,
    // 14: deliberate one-off, between spacing.md (12) and spacing.base (16)
    // — bubble padding is intentionally tighter than card padding.
    paddingHorizontal: 14,
    // 10: deliberate one-off, between spacing.sm (8) and spacing.md (12).
    paddingVertical: 10,
  },
  bubbleText: {
    ...text.body,
    lineHeight: 22,
  },
  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    gap: 4,
    overflow: "hidden",
  },
  typingHalo: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 2,
  },
  // The composer surface is split into two layers so we get both an
  // iOS drop shadow (must NOT be clipped) AND the absolute-fill
  // FrostBackground (MUST be clipped on Android, where overflow
  // defaults to "visible"). The shadow lives on the outer
  // Animated.View; the frost lives inside the inner View whose
  // `overflow: hidden` clips just the BlurView.
  inputAreaShadow: {
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.06,
        shadowRadius: 16,
      },
      default: {},
    }),
  },
  inputArea: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.md,
    paddingTop: 6,
    overflow: "hidden",
  },
  aboveInput: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingBottom: 6,
    paddingRight: 4,
  },
  composerBar: {
    // 10: deliberate one-off, between spacing.sm (8) and spacing.md (12).
    gap: 10,
  },
  // The pill: single rounded surface that hosts the text field +
  // the circular send button. `alignItems: "flex-end"` keeps the send
  // button anchored to the bottom-right as the multiline TextInput
  // grows up to its 5-line cap.
  pill: {
    flexDirection: "row",
    alignItems: "flex-end",
    // 24: deliberate one-off — full-radius messenger-style pill.
    borderRadius: 24,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 48,
  },
  pillInput: {
    ...text.body,
    flex: 1,
    paddingTop: 8,
    paddingBottom: 8,
    paddingRight: 8,
    minHeight: 32,
    // 5 lines × ~22px lineHeight ≈ 110, capped at 120 then
    // multiline TextInput auto-scrolls internally.
    maxHeight: 120,
  },
  sendBtnWrap: {
    marginLeft: 4,
    marginBottom: 1,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    // `alignItems: "center"` keeps the inline send button (Task #295)
    // vertically centred against each chip line so it doesn't bottom-
    // hang when it shares a row with shorter chips.
    alignItems: "center",
    gap: spacing.sm,
  },
  chip: {
    // 20: deliberate one-off — softer pill chip; sits between
    // radius.sm (12) and radius.lg (24).
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
  },
  chipText: {
    ...text.helper,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  // Wraps the inline send button so it occupies a chip-sized cell in
  // the wrapping `chipsRow` (Task #295). The cell itself stays in
  // layout even when the button is hidden, so crossing the `min`
  // threshold doesn't reflow the chip grid; only the button's own
  // opacity/scale changes.
  chipsInlineSend: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  overlayCard: {
    paddingHorizontal: spacing.lg,
    // 22: deliberate one-off, between spacing.lgCard (20) and
    // spacing.lg (24); centres the spinner+text on a slightly squarer card.
    paddingVertical: 22,
    // 20: deliberate one-off, between radius.md (16) and radius.lg (24).
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  overlayText: {
    // 15: deliberate one-off, between text.helper (14) and text.body (16).
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
});
