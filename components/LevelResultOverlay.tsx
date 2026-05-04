import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { GradientButton } from "@/components/GradientButton";
import { MemCharacter } from "@/components/MemCharacter";
import { useColors } from "@/hooks/useColors";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import type { Stars } from "@/lib/gameLevels";
import { useMemSpeech } from "@/lib/useMemSpeech";
import {
  pickMemReactionLine,
  type MemReactionGame,
  type MemReactionState,
} from "@/lib/memReactions";

export type LevelResultState =
  | "win"
  | "fail"
  | "timeout"
  // Versus Mem outcomes (Task #321). Folded into the same overlay so
  // copy / button rules stay in lockstep with solo states.
  | "versus-win"
  | "versus-loss"
  | "versus-draw";

export interface LevelResultOverlayProps {
  visible: boolean;
  state: LevelResultState;
  level: number;
  stars?: Stars | null;
  onNextLevel?: () => void;
  hasNextLevel?: boolean;
  /**
   * When true, the next level exists but is behind the Pro paywall.
   * The "Next Level" CTA is relabelled "Unlock Pro" and calling
   * onNextLevel is expected to route to /subscription rather than
   * starting the level. Required so a free user clearing level 10
   * can't bypass the paywall via this CTA.
   */
  nextLevelProLocked?: boolean;
  onReplay: () => void;
  onExit: () => void;
  /**
   * Mem coach reactions (Task #324). When supplied, the overlay
   * renders a small Mem avatar above the title and routes a
   * deterministic reaction line through the existing on-device
   * TTS pipeline (`useMemSpeech`). Omit `game` to keep the legacy
   * silent overlay behavior — the existing LevelResultOverlay
   * tests rely on this opt-in to avoid touching audio mocks.
   */
  game?: MemReactionGame;
  /** True when the user has muted Mem in Settings (default false). */
  memMuted?: boolean;
}

/**
 * Single end-of-level surface used by Memory Match and 24 Game.
 *
 * Folds in the Round 1 game-over copy follow-up: one casing rule
 * (Title Case for the title, sentence case for the body), one
 * punctuation rule (period at the end of the body line, no `!`),
 * and one set of buttons (Next level / Replay / Exit). Both games
 * import this so the previous three-different-rules drift can't
 * come back.
 *
 * Task #324: when `game` is provided, the overlay surfaces the Mem
 * coach (avatar + spoken reaction). Speech is routed through the
 * existing `useMemSpeech` hook so the user's chosen TTS voice and
 * Reduce-Motion behavior carry over from the AI Guide screen.
 */
export function LevelResultOverlay({
  visible,
  state,
  level,
  stars,
  onNextLevel,
  hasNextLevel,
  nextLevelProLocked,
  onReplay,
  onExit,
  game,
  memMuted,
}: LevelResultOverlayProps) {
  const colors = useColors();
  if (!visible) return null;

  const isWin = state === "win";
  const isVersusWin = state === "versus-win";
  const isVersusLoss = state === "versus-loss";
  const isVersusDraw = state === "versus-draw";
  const isVersus = isVersusWin || isVersusLoss || isVersusDraw;
  // Solo "win" earns stars; versus outcomes are a separate ledger and
  // never display the star row even if a `stars` prop is passed.
  const showStars = isWin && stars != null;
  const isPositive = isWin || isVersusWin || isVersusDraw;
  const title =
    state === "win"
      ? `Level ${level} Cleared`
      : state === "timeout"
      ? "Out of Time"
      : state === "versus-win"
      ? "You Beat Mem"
      : state === "versus-loss"
      ? "Mem Beat You"
      : state === "versus-draw"
      ? "It's a Draw"
      : "Level Failed";
  const body =
    state === "win"
      ? "Nice work."
      : state === "timeout"
      ? "Time ran out before you could finish."
      : state === "versus-win"
      ? "Mem will want a rematch."
      : state === "versus-loss"
      ? "Mem edged you out this round."
      : state === "versus-draw"
      ? "Neither of you blinked."
      : "Give it another shot.";
  const replayLabel = isVersus ? "Rematch" : "Replay";

  return (
    <View
      style={[styles.overlay, { backgroundColor: "rgba(10, 6, 18, 0.85)" }]}
      accessibilityViewIsModal
      accessibilityLabel={`${title}. ${body}`}
    >
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        {game ? (
          // Avatar + speech are extracted into a child component so
          // `useMemSpeech` is only called when the parent screen
          // actually opted in via the `game` prop. This keeps the
          // existing LevelResultOverlay test (which doesn't mock
          // expo-speech / reanimated speech state) green.
          <MemReactionPanel
            game={game}
            state={state}
            stars={stars ?? null}
            level={level}
            muted={memMuted === true}
          />
        ) : null}

        <Text
          style={[
            styles.title,
            { color: isPositive ? colors.primary : colors.destructive },
          ]}
        >
          {title}
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>{body}</Text>

        {showStars && stars != null && (
          <View style={styles.stars} accessibilityLabel={`${stars} of 3 stars`}>
            {[1, 2, 3].map((i) => (
              <Ionicons
                key={i}
                name={i <= stars ? "star" : "star-outline"}
                size={32}
                color={i <= stars ? colors.accent : colors.mutedForeground}
                style={styles.star}
              />
            ))}
          </View>
        )}

        {isWin && hasNextLevel && onNextLevel ? (
          <GradientButton
            title={nextLevelProLocked ? "Unlock Pro" : "Next Level"}
            onPress={onNextLevel}
            style={styles.primaryBtn}
          />
        ) : (
          <GradientButton
            title={replayLabel}
            onPress={onReplay}
            style={styles.primaryBtn}
          />
        )}

        {isWin && hasNextLevel && (
          <Pressable
            onPress={onReplay}
            style={styles.secondaryBtn}
            accessibilityRole="button"
            accessibilityLabel="Replay this level"
          >
            <Text style={[styles.secondaryText, { color: colors.foreground }]}>
              {replayLabel}
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={onExit}
          style={styles.secondaryBtn}
          accessibilityRole="button"
        >
          <Text
            style={[styles.secondaryText, { color: colors.mutedForeground }]}
          >
            Back to Levels
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

interface MemReactionPanelProps {
  game: MemReactionGame;
  state: LevelResultState;
  stars: Stars | null;
  level: number;
  muted: boolean;
}

function MemReactionPanel({
  game,
  state,
  stars,
  level,
  muted,
}: MemReactionPanelProps) {
  // Map versus-* outcomes onto the same three reaction buckets the
  // solo modes use (win/fail/timeout). Draws read closer to a fail
  // than a win — Mem doesn't celebrate a tie.
  const reactionState: MemReactionState =
    state === "win" || state === "versus-win"
      ? "win"
      : state === "timeout"
        ? "timeout"
        : "fail";
  const reaction = pickMemReactionLine(game, reactionState, stars, level);
  const speech = useMemSpeech({ muted });

  // Speak once per (level, state, stars) — the deps key changes only
  // when the overlay surfaces a new outcome. `stop()` on cleanup
  // makes a back-to-back replay snap silent before the new line.
  useEffect(() => {
    speech.speak(reaction.text);
    return () => {
      speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, state, stars, level]);

  return (
    <View style={styles.memWrap} accessibilityElementsHidden>
      <MemCharacter
        size={72}
        expression={reaction.expression}
        mouthOpen={speech.mouthOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    padding: spacing.lg,
  },
  card: {
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
    width: "100%",
  },
  memWrap: {
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  body: {
    ...text.body,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  stars: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  star: { marginHorizontal: 4 },
  primaryBtn: { width: "100%", marginTop: spacing.sm },
  secondaryBtn: {
    marginTop: spacing.base,
    paddingVertical: spacing.sm,
  },
  secondaryText: {
    ...text.helper,
    textAlign: "center",
  },
});
