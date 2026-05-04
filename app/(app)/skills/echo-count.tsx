import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ChallengeResultOverlay } from "@/components/ChallengeResultOverlay";
import { MiniGameFrame, ScorePill } from "@/components/MiniGameFrame";
import { useColors } from "@/hooks/useColors";
import { useSkills } from "@/context/SkillsContext";
import {
  buildEchoCountRound,
  scoreEchoCount,
  type EchoCountRound,
} from "@/lib/skillScoring";
import { trackEvent } from "@/lib/analytics";
import {
  canPlaySkillRound,
  newRoundSeed,
  parseChallengeParams,
} from "@/lib/skillSession";
import { useSkillRoundShare } from "@/lib/useSkillRoundShare";
import { pickSkillReactionLine } from "@/lib/skillMemReactions";
import { playEchoChime, releaseSkillAudio } from "@/lib/skillAudio";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

type Phase = "idle" | "playing" | "guess" | "done";

/**
 * Echo Count plays a short procedurally-generated chime through
 * expo-audio (Task #355) for each beat in the round. The visual dot
 * pulse + counter remain as an accessibility fallback so players who
 * keep their phone in silent mode (or have audio disabled) can still
 * play by sight. The chime helper configures the audio session to
 * play in silent mode and duck other audio — see lib/skillAudio.ts.
 */
export default function EchoCountScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams();
  const challenge = useMemo(() => parseChallengeParams(params as never), [params]);
  const { owned } = useSkills();
  const share = useSkillRoundShare();

  const [seed, setSeed] = useState<number>(challenge.seed || newRoundSeed());
  const [round, setRound] = useState<EchoCountRound>(() => buildEchoCountRound(seed));
  const [phase, setPhase] = useState<Phase>("idle");
  const [pulse, setPulse] = useState<number>(0);
  const [guess, setGuess] = useState<string>("");
  const [score, setScore] = useState(0);
  const reaction = useMemo(() => {
    const state = score === 100 ? "win" : score >= 50 ? "ok" : "fail";
    return pickSkillReactionLine("echo_count", state, seed);
  }, [score, seed]);

  useEffect(() => {
    if (!canPlaySkillRound("echo_count", owned, challenge)) {
      router.replace({ pathname: "/skills/paywall", params: { skillId: "echo_count" } });
    }
  }, [owned, challenge, router]);

  useEffect(() => {
    return () => {
      releaseSkillAudio();
    };
  }, []);

  const begin = async () => {
    trackEvent("round_started", {
      skillId: "echo_count",
      isChallenge: challenge.isChallenge,
    });
    setPhase("playing");
    setGuess("");
    setScore(0);
    for (let i = 1; i <= round.count; i++) {
      setPulse(i);
      void playEchoChime();
      await new Promise((r) => setTimeout(r, round.intervalMs));
    }
    setPulse(0);
    setPhase("guess");
  };

  const submit = () => {
    const n = Number(guess);
    const final = scoreEchoCount({ round, guess: Number.isFinite(n) ? n : 0 });
    setScore(final);
    setPhase("done");
    trackEvent("round_finished", {
      skillId: "echo_count",
      score: final,
      isChallenge: challenge.isChallenge,
    });
  };

  const [overlayDismissed, setOverlayDismissed] = useState(false);

  const restart = () => {
    const s = newRoundSeed();
    setSeed(s);
    setRound(buildEchoCountRound(s));
    setPhase("idle");
    setGuess("");
    setScore(0);
    setOverlayDismissed(false);
  };

  const onShare = () => {
    void share({ skillId: "echo_count", skillTitle: "Echo Count", seed, score });
  };

  const onRematch = () => {
    trackEvent("challenge_rematched", { skillId: "echo_count", seed });
    setRound(buildEchoCountRound(seed));
    setPhase("idle");
    setGuess("");
    setScore(0);
    setOverlayDismissed(false);
  };

  const onSendBack = () => {
    trackEvent("challenge_returned", { skillId: "echo_count", score });
    void share({ skillId: "echo_count", skillTitle: "Echo Count", seed, score });
  };

  return (
    <>
    <MiniGameFrame
      title="Echo Count"
      subtitle={
        challenge.isChallenge && challenge.senderName
          ? `Challenge from ${challenge.senderName} · ${challenge.senderScore ?? 0} pts`
          : "Count the chimes"
      }
      topRight={<ScorePill label="Score" value={score} />}
      footer={
        phase === "done" ? (
          <>
            <Pressable
              onPress={restart}
              style={[styles.btn, { backgroundColor: colors.card, borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Play again"
            >
              <Text style={[text.bodySemibold, { color: colors.foreground }]}>Play again</Text>
            </Pressable>
            <Pressable
              onPress={onShare}
              style={[styles.btn, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Send challenge"
            >
              <Text style={[text.bodySemibold, { color: colors.primaryForeground ?? "#fff" }]}>
                Send challenge
              </Text>
            </Pressable>
          </>
        ) : phase === "idle" ? (
          <Pressable
            onPress={begin}
            style={[styles.btnFull, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Start round"
          >
            <Text style={[text.bodySemibold, { color: colors.primaryForeground ?? "#fff" }]}>
              Start round
            </Text>
          </Pressable>
        ) : phase === "guess" ? (
          <Pressable
            onPress={submit}
            disabled={guess.length === 0}
            style={[
              styles.btnFull,
              {
                backgroundColor: colors.primary,
                opacity: guess.length === 0 ? 0.5 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Submit guess"
          >
            <Text style={[text.bodySemibold, { color: colors.primaryForeground ?? "#fff" }]}>
              Submit
            </Text>
          </Pressable>
        ) : null
      }
    >
      <Text
        style={[text.helperRegular, { color: colors.mutedForeground, marginBottom: spacing.lg }]}
      >
        {phase === "playing"
          ? "Listen and count…"
          : phase === "guess"
            ? "How many chimes did you hear?"
            : phase === "done"
              ? `${reaction.text} (Actual: ${round.count})`
              : "Tap Start round to begin."}
      </Text>

      <View
        style={[
          styles.pulseWrap,
          { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md },
        ]}
      >
        <View
          style={[
            styles.pulse,
            {
              backgroundColor: pulse > 0 ? colors.primary : colors.muted ?? colors.border,
            },
          ]}
        />
        <Text style={[text.cardTitle, { color: colors.foreground, marginTop: spacing.md }]}>
          {phase === "playing" ? `· ${pulse} ·` : phase === "guess" ? "?" : ""}
        </Text>
      </View>

      {phase === "guess" ? (
        <TextInput
          value={guess}
          onChangeText={(t) => setGuess(t.replace(/[^0-9]/g, "").slice(0, 3))}
          keyboardType="number-pad"
          accessibilityLabel="Number of chimes"
          placeholder="Your count"
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.input,
            {
              borderColor: colors.border,
              color: colors.foreground,
              backgroundColor: colors.card,
              borderRadius: radius.sm,
            },
          ]}
        />
      ) : null}
    </MiniGameFrame>
    <ChallengeResultOverlay
      visible={
        phase === "done" && challenge.isChallenge && !overlayDismissed
      }
      senderName={challenge.senderName ?? "A friend"}
      senderScore={challenge.senderScore ?? 0}
      yourScore={score}
      onRematch={onRematch}
      onSendBack={onSendBack}
      onDone={() => setOverlayDismissed(true)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  pulseWrap: {
    paddingVertical: spacing.xl,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.lg,
  },
  pulse: { width: 80, height: 80, borderRadius: 40 },
  input: {
    padding: spacing.base,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 24,
    textAlign: "center",
  },
  btn: {
    flex: 1,
    padding: spacing.base,
    borderRadius: radius.md,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnFull: {
    flex: 1,
    padding: spacing.base,
    borderRadius: radius.md,
    alignItems: "center",
  },
});
