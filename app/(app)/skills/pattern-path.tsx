import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { ChallengeResultOverlay } from "@/components/ChallengeResultOverlay";
import { MiniGameFrame, ScorePill } from "@/components/MiniGameFrame";
import { useColors } from "@/hooks/useColors";
import { useSkills } from "@/context/SkillsContext";
import {
  buildPatternPathRound,
  scorePatternPath,
  type PathCell,
  type PatternPathRound,
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

type Phase = "idle" | "showing" | "trace" | "done";

export default function PatternPathScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams();
  const challenge = useMemo(() => parseChallengeParams(params as never), [params]);
  const { owned } = useSkills();
  const share = useSkillRoundShare();

  const [seed, setSeed] = useState<number>(challenge.seed || newRoundSeed());
  const [round, setRound] = useState<PatternPathRound>(() => buildPatternPathRound(seed));
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [trace, setTrace] = useState<PathCell[]>([]);
  const [score, setScore] = useState(0);
  const reaction = useMemo(() => {
    const max = round.path.length * 75 + 50;
    const state = score >= max * 0.9 ? "win" : score >= max * 0.5 ? "ok" : "fail";
    return pickSkillReactionLine("pattern_path", state, seed);
  }, [score, round.path.length, seed]);

  useEffect(() => {
    if (!canPlaySkillRound("pattern_path", owned, challenge)) {
      router.replace({ pathname: "/skills/paywall", params: { skillId: "pattern_path" } });
    }
  }, [owned, challenge, router]);

  const showPath = async () => {
    trackEvent("round_started", {
      skillId: "pattern_path",
      isChallenge: challenge.isChallenge,
    });
    setPhase("showing");
    setTrace([]);
    setScore(0);
    for (let i = 0; i < round.path.length; i++) {
      setActiveIdx(i);
      await new Promise((r) => setTimeout(r, 500));
    }
    setActiveIdx(-1);
    setPhase("trace");
  };

  const tapCell = (cell: PathCell) => {
    if (phase !== "trace") return;
    void Haptics.selectionAsync().catch(() => {});
    const next = [...trace, cell];
    setTrace(next);
    if (next.length >= round.path.length) {
      const final = scorePatternPath({ round, trace: next });
      setScore(final);
      setPhase("done");
      trackEvent("round_finished", {
        skillId: "pattern_path",
        score: final,
        isChallenge: challenge.isChallenge,
      });
    }
  };

  const [overlayDismissed, setOverlayDismissed] = useState(false);

  const restart = () => {
    const s = newRoundSeed();
    setSeed(s);
    setRound(buildPatternPathRound(s));
    setPhase("idle");
    setTrace([]);
    setScore(0);
    setOverlayDismissed(false);
  };

  const onShare = () => {
    void share({ skillId: "pattern_path", skillTitle: "Pattern Path", seed, score });
  };

  const onRematch = () => {
    trackEvent("challenge_rematched", { skillId: "pattern_path", seed });
    setRound(buildPatternPathRound(seed));
    setPhase("idle");
    setTrace([]);
    setScore(0);
    setOverlayDismissed(false);
  };

  const onSendBack = () => {
    trackEvent("challenge_returned", { skillId: "pattern_path", score });
    void share({ skillId: "pattern_path", skillTitle: "Pattern Path", seed, score });
  };

  const cellState = (row: number, col: number): "lit" | "trace-correct" | "trace-wrong" | "idle" => {
    if (phase === "showing") {
      if (activeIdx >= 0) {
        const cur = round.path[activeIdx];
        if (cur && cur.row === row && cur.col === col) return "lit";
      }
      return "idle";
    }
    if (phase === "trace" || phase === "done") {
      const idxInTrace = trace.findIndex((c) => c.row === row && c.col === col);
      if (idxInTrace >= 0) {
        const expected = round.path[idxInTrace];
        return expected && expected.row === row && expected.col === col
          ? "trace-correct"
          : "trace-wrong";
      }
    }
    return "idle";
  };

  const cellSize = Math.floor(280 / round.gridSize);

  return (
    <>
    <MiniGameFrame
      title="Pattern Path"
      subtitle={
        challenge.isChallenge && challenge.senderName
          ? `Challenge from ${challenge.senderName} · ${challenge.senderScore ?? 0} pts`
          : "Watch the path, then retrace it"
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
            onPress={showPath}
            style={[styles.btnFull, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Show the path"
          >
            <Text style={[text.bodySemibold, { color: colors.primaryForeground ?? "#fff" }]}>
              Show the path
            </Text>
          </Pressable>
        ) : null
      }
    >
      <Text
        style={[text.helperRegular, { color: colors.mutedForeground, marginBottom: spacing.lg }]}
      >
        {phase === "showing"
          ? "Memorise the path…"
          : phase === "trace"
            ? `Tap the cells in order (${trace.length}/${round.path.length})`
            : phase === "done"
              ? reaction.text
              : "Tap Show the path to begin."}
      </Text>
      <View style={[styles.gridWrap, { alignSelf: "center" }]}>
        {Array.from({ length: round.gridSize }).map((_, row) => (
          <View key={row} style={styles.row}>
            {Array.from({ length: round.gridSize }).map((_, col) => {
              const state = cellState(row, col);
              const bg =
                state === "lit"
                  ? colors.primary
                  : state === "trace-correct"
                    ? colors.primary
                    : state === "trace-wrong"
                      ? colors.destructive
                      : colors.card;
              return (
                <Pressable
                  key={col}
                  onPress={() => tapCell({ row, col })}
                  disabled={phase !== "trace"}
                  accessibilityRole="button"
                  accessibilityLabel={`Cell ${row + 1}, ${col + 1}`}
                  style={[
                    styles.cell,
                    {
                      width: cellSize,
                      height: cellSize,
                      backgroundColor: bg,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                    },
                  ]}
                />
              );
            })}
          </View>
        ))}
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
  gridWrap: { gap: spacing.xs },
  row: { flexDirection: "row", gap: spacing.xs },
  cell: { borderWidth: StyleSheet.hairlineWidth },
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
