import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { ChallengeResultOverlay } from "@/components/ChallengeResultOverlay";
import { MiniGameFrame, ScorePill } from "@/components/MiniGameFrame";
import { useColors } from "@/hooks/useColors";
import { useSkills } from "@/context/SkillsContext";
import {
  buildMemSaysRound,
  scoreMemSays,
  MEM_SAYS_COLORS,
  type MemSaysColor,
  type MemSaysRound,
} from "@/lib/skillScoring";
import { trackEvent } from "@/lib/analytics";
import { canPlaySkillRound, newRoundSeed, parseChallengeParams } from "@/lib/skillSession";
import { useSkillRoundShare } from "@/lib/useSkillRoundShare";
import { pickSkillReactionLine } from "@/lib/skillMemReactions";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

const COLOR_HEX: Record<MemSaysColor, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#eab308",
};

type Phase = "idle" | "showing" | "echo" | "done";

export default function MemSaysScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams();
  const challenge = useMemo(() => parseChallengeParams(params as never), [params]);
  const { owned } = useSkills();

  const [seed, setSeed] = useState<number>(challenge.seed || newRoundSeed());
  const [round, setRound] = useState<MemSaysRound>(() => buildMemSaysRound(seed));
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeStep, setActiveStep] = useState<number>(-1);
  const [echoed, setEchoed] = useState<MemSaysColor[]>([]);
  const [score, setScore] = useState<number>(0);
  const startRef = useRef<number>(0);
  const reaction = useMemo(
    () => pickSkillReactionLine("mem_says", score >= 100 ? (score >= round.sequence.length * 100 ? "win" : "ok") : "fail", seed),
    [score, seed, round.sequence.length],
  );
  const share = useSkillRoundShare();

  useEffect(() => {
    if (!canPlaySkillRound("mem_says", owned, challenge)) {
      router.replace({ pathname: "/skills/paywall", params: { skillId: "mem_says" } });
    }
  }, [owned, challenge, router]);

  const playSequence = async () => {
    trackEvent("round_started", { skillId: "mem_says", isChallenge: challenge.isChallenge });
    setPhase("showing");
    setEchoed([]);
    setScore(0);
    for (let i = 0; i < round.sequence.length; i++) {
      setActiveStep(i);
      await new Promise((r) => setTimeout(r, 500));
      setActiveStep(-1);
      await new Promise((r) => setTimeout(r, 200));
    }
    startRef.current = Date.now();
    setPhase("echo");
  };

  const onTap = (color: MemSaysColor) => {
    if (phase !== "echo") return;
    void Haptics.selectionAsync().catch(() => {});
    const next = [...echoed, color];
    setEchoed(next);
    if (next.length >= round.sequence.length) {
      const elapsedSec = (Date.now() - startRef.current) / 1000;
      const finalScore = scoreMemSays({ round, echoed: next, elapsedSec });
      setScore(finalScore);
      setPhase("done");
      trackEvent("round_finished", {
        skillId: "mem_says",
        score: finalScore,
        isChallenge: challenge.isChallenge,
      });
    }
  };

  const [overlayDismissed, setOverlayDismissed] = useState(false);

  const restart = () => {
    const s = newRoundSeed();
    setSeed(s);
    setRound(buildMemSaysRound(s));
    setPhase("idle");
    setEchoed([]);
    setScore(0);
    setOverlayDismissed(false);
  };

  const onShare = () => {
    void share({ skillId: "mem_says", skillTitle: "Mem Says", seed, score });
  };

  const onRematch = () => {
    trackEvent("challenge_rematched", { skillId: "mem_says", seed });
    setRound(buildMemSaysRound(seed));
    setPhase("idle");
    setEchoed([]);
    setScore(0);
    setOverlayDismissed(false);
  };

  const onSendBack = () => {
    trackEvent("challenge_returned", { skillId: "mem_says", score });
    void share({ skillId: "mem_says", skillTitle: "Mem Says", seed, score });
  };

  return (
    <>
    <MiniGameFrame
      title="Mem Says"
      subtitle={
        challenge.isChallenge && challenge.senderName
          ? `Challenge from ${challenge.senderName} · ${challenge.senderScore ?? 0} pts`
          : "Watch, then echo"
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
            onPress={playSequence}
            style={[styles.btnFull, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Watch the sequence"
          >
            <Text style={[text.bodySemibold, { color: colors.primaryForeground ?? "#fff" }]}>
              Show the pattern
            </Text>
          </Pressable>
        ) : null
      }
    >
      <Text style={[text.helperRegular, { color: colors.mutedForeground, marginBottom: spacing.lg }]}>
        {phase === "showing"
          ? "Watch closely…"
          : phase === "echo"
            ? `Echo the pattern (${echoed.length}/${round.sequence.length})`
            : phase === "done"
              ? reaction.text
              : "Tap Show the pattern to begin."}
      </Text>
      <View style={styles.grid}>
        {MEM_SAYS_COLORS.map((c, i) => {
          const isLit =
            phase === "showing" && activeStep >= 0 && round.sequence[activeStep] === c;
          return (
            <Pressable
              key={c}
              onPress={() => onTap(c)}
              disabled={phase !== "echo"}
              accessibilityRole="button"
              accessibilityLabel={`${c} button`}
              style={[
                styles.cell,
                {
                  backgroundColor: COLOR_HEX[c],
                  opacity: isLit ? 1 : phase === "echo" ? 0.85 : 0.55,
                  borderRadius: radius.md,
                },
              ]}
            >
              <Text style={[text.bodySemibold, { color: "#fff" }]}>{c}</Text>
            </Pressable>
          );
        })}
      </View>
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "center" },
  cell: { width: 140, height: 140, alignItems: "center", justifyContent: "center" },
  btn: { flex: 1, padding: spacing.base, borderRadius: radius.md, alignItems: "center", borderWidth: StyleSheet.hairlineWidth },
  btnFull: { flex: 1, padding: spacing.base, borderRadius: radius.md, alignItems: "center" },
});
