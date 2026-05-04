import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { ChallengeResultOverlay } from "@/components/ChallengeResultOverlay";
import { MiniGameFrame, ScorePill } from "@/components/MiniGameFrame";
import { useColors } from "@/hooks/useColors";
import { useSkills } from "@/context/SkillsContext";
import {
  buildSignalSortRound,
  scoreSignalSort,
  type SignalBin,
  type SignalSortRound,
} from "@/lib/skillScoring";
import { trackEvent } from "@/lib/analytics";
import {
  canPlaySkillRound,
  newRoundSeed,
  parseChallengeParams,
} from "@/lib/skillSession";
import { useSkillRoundShare } from "@/lib/useSkillRoundShare";
import { pickSkillReactionLine } from "@/lib/skillMemReactions";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

type Phase = "idle" | "playing" | "done";

export default function SignalSortScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams();
  const challenge = useMemo(() => parseChallengeParams(params as never), [params]);
  const { owned } = useSkills();
  const share = useSkillRoundShare();

  const [seed, setSeed] = useState<number>(challenge.seed || newRoundSeed());
  const [round, setRound] = useState<SignalSortRound>(() => buildSignalSortRound(seed));
  const [phase, setPhase] = useState<Phase>("idle");
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<SignalBin[]>([]);
  const [score, setScore] = useState(0);
  const reaction = useMemo(() => {
    const max = round.signals.length * 50;
    const state = score >= max * 0.9 ? "win" : score >= max * 0.5 ? "ok" : "fail";
    return pickSkillReactionLine("signal_sort", state, seed);
  }, [score, round.signals.length, seed]);

  useEffect(() => {
    if (!canPlaySkillRound("signal_sort", owned, challenge)) {
      router.replace({ pathname: "/skills/paywall", params: { skillId: "signal_sort" } });
    }
  }, [owned, challenge, router]);

  const begin = () => {
    trackEvent("round_started", {
      skillId: "signal_sort",
      isChallenge: challenge.isChallenge,
    });
    setPhase("playing");
    setAnswers([]);
    setIdx(0);
    setScore(0);
  };

  const tap = (bin: SignalBin) => {
    if (phase !== "playing") return;
    void Haptics.selectionAsync().catch(() => {});
    const next = [...answers, bin];
    setAnswers(next);
    if (next.length >= round.signals.length) {
      const final = scoreSignalSort({ round, answers: next });
      setScore(final);
      setPhase("done");
      trackEvent("round_finished", {
        skillId: "signal_sort",
        score: final,
        isChallenge: challenge.isChallenge,
      });
    } else {
      setIdx(next.length);
    }
  };

  const [overlayDismissed, setOverlayDismissed] = useState(false);

  const restart = () => {
    const s = newRoundSeed();
    setSeed(s);
    setRound(buildSignalSortRound(s));
    setPhase("idle");
    setAnswers([]);
    setIdx(0);
    setScore(0);
    setOverlayDismissed(false);
  };

  const onShare = () => {
    void share({ skillId: "signal_sort", skillTitle: "Signal Sort", seed, score });
  };

  const onRematch = () => {
    trackEvent("challenge_rematched", { skillId: "signal_sort", seed });
    setRound(buildSignalSortRound(seed));
    setPhase("idle");
    setAnswers([]);
    setIdx(0);
    setScore(0);
    setOverlayDismissed(false);
  };

  const onSendBack = () => {
    trackEvent("challenge_returned", { skillId: "signal_sort", score });
    void share({ skillId: "signal_sort", skillTitle: "Signal Sort", seed, score });
  };

  const current = phase === "playing" ? round.signals[idx] : null;

  return (
    <>
    <MiniGameFrame
      title="Signal Sort"
      subtitle={
        challenge.isChallenge && challenge.senderName
          ? `Challenge from ${challenge.senderName} · ${challenge.senderScore ?? 0} pts`
          : "Sort each signal — left or right"
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
        ) : null
      }
    >
      <Text
        style={[
          text.helperRegular,
          { color: colors.mutedForeground, marginBottom: spacing.lg },
        ]}
      >
        {phase === "playing"
          ? `Signal ${idx + 1} of ${round.signals.length}`
          : phase === "done"
            ? reaction.text
            : "Tap Start round to begin."}
      </Text>

      {current ? (
        <View
          style={[
            styles.signalCard,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md },
          ]}
        >
          <Text style={[text.cardTitle, { color: colors.foreground }]}>{current.label}</Text>
        </View>
      ) : null}

      {phase === "playing" ? (
        <View style={styles.binRow}>
          <Pressable
            onPress={() => tap("left")}
            style={[styles.bin, { backgroundColor: "#3b82f6" }]}
            accessibilityRole="button"
            accessibilityLabel="Sort left"
          >
            <Text style={[text.cardLabel, { color: "#fff" }]}>← Left</Text>
          </Pressable>
          <Pressable
            onPress={() => tap("right")}
            style={[styles.bin, { backgroundColor: "#22c55e" }]}
            accessibilityRole="button"
            accessibilityLabel="Sort right"
          >
            <Text style={[text.cardLabel, { color: "#fff" }]}>Right →</Text>
          </Pressable>
        </View>
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
  signalCard: {
    padding: spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  binRow: { flexDirection: "row", gap: spacing.md },
  bin: {
    flex: 1,
    paddingVertical: spacing.xl,
    borderRadius: radius.md,
    alignItems: "center",
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
