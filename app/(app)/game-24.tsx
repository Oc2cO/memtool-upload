import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  View,
  Text,
  StyleSheet,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { useGameStats } from "@/context/GameStatsContext";
import { useSettings } from "@/context/SettingsContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { Confetti } from "@/components/Confetti";
import { LevelLadder } from "@/components/LevelLadder";
import { GradientButton } from "@/components/GradientButton";
import { LevelResultOverlay } from "@/components/LevelResultOverlay";
import { MilestoneToast } from "@/components/MilestoneToast";
import { MiniGameFrame, ScorePill } from "@/components/MiniGameFrame";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { solve24, getHint } from "@/lib/game24Solver";
import { useHaptics } from "@/lib/haptics";
import { useCognitiveAudio } from "@/lib/cognitiveAudio";
import {
  FREE_LEVEL_COUNT,
  LEVELS_PER_GAME,
  generateGame24Puzzle,
  getGame24Level,
  levelLockState,
  milestoneCrossedBy,
  versusLevelLockState,
  type Game24Operator,
  type LevelMilestone,
  type Stars,
} from "@/lib/gameLevels";
import { hasSeenMilestone, markMilestoneSeen } from "@/lib/milestonesSeen";
import {
  makeSeedableRng,
  pickMemLine,
  scheduleMemSubmission,
  type MemDifficulty,
  type SeedableRng,
} from "@/lib/memOpponent";
import { loadMemDifficulty, saveMemDifficulty } from "@/lib/memDifficulty";
import { DifficultyToggle } from "@/components/DifficultyToggle";

interface Card {
  id: string;
  value: number;
  expression: string;
  used: boolean;
}

interface GameState {
  cards: Card[];
  history: Card[][];
}

export default function Game24Screen() {
  const [activeLevel, setActiveLevel] = useState<number | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedOperator, setSelectedOperator] = useState<Game24Operator | null>(
    null,
  );
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isGameOver, setIsGameOver] = useState(false);
  const [resultState, setResultState] = useState<"win" | "fail" | "timeout" | null>(
    null,
  );
  const [resultStars, setResultStars] = useState<Stars | null>(null);
  const [pendingMilestone, setPendingMilestone] =
    useState<LevelMilestone | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [solution, setSolution] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number>(0);

  // Versus Mem (Task #321)
  type Mode = "solo" | "versus";
  type VersusOverlay = "versus-win" | "versus-loss" | "versus-draw";
  const [mode, setMode] = useState<Mode>("solo");
  const [pendingVersusLevel, setPendingVersusLevel] = useState<number | null>(
    null,
  );
  const [difficulty, setDifficulty] = useState<MemDifficulty>("normal");
  const difficultyRef = useRef<MemDifficulty>("normal");
  difficultyRef.current = difficulty;
  useEffect(() => {
    let cancelled = false;
    loadMemDifficulty("game24").then((d) => {
      if (!cancelled) setDifficulty(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const handleDifficultyChange = (d: MemDifficulty) => {
    setDifficulty(d);
    void saveMemDifficulty("game24", d);
  };
  const [memThinking, setMemThinking] = useState(false);
  const [memLine, setMemLine] = useState<string | null>(null);
  const [versusResult, setVersusResult] = useState<VersusOverlay | null>(null);
  const memRngRef = useRef<SeedableRng | null>(null);
  // `scheduleMemSubmission` returns a cancel fn that clears its own
  // timeout AND latches a `cancelled` flag so a setTimeout already in
  // flight can't fire onSubmit. Stash it here so every early-exit path
  // (back button, replay, mode switch, unmount) can stop a phantom
  // versus-loss from being recorded after the user leaves the match.
  const memCancelRef = useRef<(() => void) | null>(null);
  const lastMemLineRef = useRef<string | null>(null);
  const isGameOverRef = useRef(false);
  isGameOverRef.current = isGameOver;
  const modeRef = useRef<Mode>("solo");
  modeRef.current = mode;

  const colors = useColors();
  const router = useRouter();
  const {
    stats,
    recordGame24LevelResult,
    recordGame24LevelFail,
    recordGame24VersusResult,
  } = useGameStats();
  const { soundEnabled } = useSettings();
  const { status: subscriptionStatus } = useSubscription();
  const isPro = subscriptionStatus?.is_pro === true;
  const haptics = useHaptics();
  useCognitiveAudio("games");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const speakMem = (event: Parameters<typeof pickMemLine>[0]) => {
    const rng = memRngRef.current;
    if (!rng) return;
    const line = pickMemLine(event, rng, lastMemLineRef.current ?? undefined);
    lastMemLineRef.current = line;
    setMemLine(line);
  };

  const clearMemTimer = () => {
    if (memCancelRef.current) memCancelRef.current();
    memCancelRef.current = null;
    setMemThinking(false);
  };

  const startLevel = (level: number, nextMode: Mode = "solo") => {
    const cfg = getGame24Level(level);
    const nums = generateGame24Puzzle(level);
    const initialCards: Card[] = nums.map((n, i) => ({
      id: `card-${i}-${Date.now()}`,
      value: n,
      expression: n.toString(),
      used: false,
    }));

    setActiveLevel(level);
    setMode(nextMode);
    setGameState({ cards: initialCards, history: [initialCards] });
    setSelectedCardId(null);
    setSelectedOperator(null);
    setIsGameOver(false);
    setResultState(null);
    setResultStars(null);
    setHint(null);
    setSolution(null);
    setStartTime(Date.now());
    setVersusResult(null);
    setMemLine(null);
    lastMemLineRef.current = null;
    memRngRef.current = makeSeedableRng(level * 7919 + Date.now());

    if (timerRef.current) clearInterval(timerRef.current);
    if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    clearMemTimer();

    // Versus race timer: Mem actually solves the puzzle with the
    // shared `solve24` engine after a calibrated thinking delay. If
    // the solver returns null (shouldn't happen — generator guarantees
    // solvable, but stay safe), Mem doesn't submit and the round stays
    // open for the user. A "concede" roll stretches the delay so the
    // user has a fighting chance on tight hands.
    if (nextMode === "versus" && memRngRef.current) {
      const memSolution = solve24(nums);
      setMemThinking(true);
      const scheduled = scheduleMemSubmission({
        level,
        rng: memRngRef.current,
        difficulty: difficultyRef.current,
        onSubmit: () => {
          memCancelRef.current = null;
          setMemThinking(false);
          if (isGameOverRef.current) return;
          if (modeRef.current !== "versus") return;
          if (memSolution === null) {
            // Mem couldn't find an answer — keep the round open.
            return;
          }
          // Mem submits its solved expression — user loses the race.
          handleVersusOutcome(level, "loss");
        },
      });
      memCancelRef.current = scheduled.cancel;
    }

    // Untimed levels (timeLimitSec === null, i.e. levels 1-10) keep
    // timeLeft = null and do NOT start a countdown. Only timed levels
    // get an interval + timeout transition.
    if (cfg.timeLimitSec !== null) {
      const budget = cfg.timeLimitSec;
      setTimeLeft(budget);
      // Capture `level` from the startLevel argument — NOT from the
      // `activeLevel` state — so the timeout callback always reports
      // the correct level even if React state hasn't committed yet
      // (first level start from the level-select screen) or if the
      // user advanced via "Next Level" between intervals (band
      // boundary like 20 → 21 would otherwise reset the wrong legacy
      // bucket and miscount games-played).
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev === null) return prev;
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            handleTimeout(level);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setTimeLeft(null);
    }

    if ((cfg.timeLimitSec === null || cfg.timeLimitSec >= 75)) {
      hintTimeoutRef.current = setTimeout(() => {
        setHint(getHint(nums));
      }, 30000);
    }
  };

  // Centralized end-of-versus tally. Stops timers, records outcome,
  // and surfaces the right overlay/voice line so handleWin/handleTimeout
  // (and the Mem race timeout) all share one source of truth.
  const handleVersusOutcome = useCallback(
    async (level: number, outcome: "win" | "loss" | "draw") => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      clearMemTimer();
      setIsGameOver(true);
      const overlay: VersusOverlay =
        outcome === "win"
          ? "versus-win"
          : outcome === "loss"
          ? "versus-loss"
          : "versus-draw";
      setVersusResult(overlay);
      if (memRngRef.current) {
        const event =
          outcome === "win"
            ? "user-wins"
            : outcome === "loss"
            ? "mem-wins"
            : "draw";
        speakMem(event);
      }
      if (outcome === "win" && soundEnabled) haptics.play("streak-extended");
      if (outcome === "loss" && soundEnabled) haptics.play("error");
      await recordGame24VersusResult(level, outcome);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recordGame24VersusResult, soundEnabled],
  );

  const handleTimeout = async (level: number) => {
    if (modeRef.current === "versus") {
      // Per-level countdown ran out first in versus → user can't beat
      // the race regardless of Mem's submission timer; mark as loss.
      handleVersusOutcome(level, "loss");
      return;
    }
    setIsGameOver(true);
    setResultState("timeout");
    // Reset the legacy current streak for this level's difficulty
    // bucket so the level-based flow stays consistent with the old
    // preset flow on a loss. We accept `level` as a parameter (not
    // `activeLevel` from React state) because the interval that
    // calls us captured it at startLevel time — see the long
    // comment in startLevel for why.
    void recordGame24LevelFail(level);
    if (soundEnabled) haptics.play("error");
  };

  const handleWin = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    if (activeLevel == null) return;
    if (modeRef.current === "versus") {
      // User solved before Mem's submission timer fired → race win.
      handleVersusOutcome(activeLevel, "win");
      return;
    }
    const solveTime = Math.floor((Date.now() - startTime) / 1000);
    // Detect milestone-cross BEFORE recording the result — once
    // the level is stored as cleared, `milestoneCrossedBy` would
    // always return null and the celebration would never fire.
    const prevProgress = stats.game24Levels ?? {};
    const crossed = milestoneCrossedBy(prevProgress, activeLevel);
    const stored = await recordGame24LevelResult(activeLevel, solveTime);
    setResultStars(stored.stars);
    setIsGameOver(true);
    setResultState("win");
    if (soundEnabled) haptics.play("streak-extended");
    if (crossed) {
      const seen = await hasSeenMilestone("game24", crossed.level);
      if (!seen) {
        setPendingMilestone(crossed);
        await markMilestoneSeen("game24", crossed.level);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      if (memCancelRef.current) memCancelRef.current();
    };
  }, []);

  const handleCardPress = (id: string) => {
    if (isGameOver || !gameState) return;
    Haptics.selectionAsync();
    const card = gameState.cards.find((c) => c.id === id);
    if (!card || card.used) return;

    if (!selectedCardId) {
      setSelectedCardId(id);
      return;
    }
    if (selectedCardId === id) {
      setSelectedCardId(null);
      setSelectedOperator(null);
      return;
    }
    if (!selectedOperator) {
      setSelectedCardId(id);
      return;
    }

    const card1 = gameState.cards.find((c) => c.id === selectedCardId)!;
    const card2 = card;
    const v1 = card1.value;
    const v2 = card2.value;
    const exp1 = card1.expression.includes(" ")
      ? `(${card1.expression})`
      : card1.expression;
    const exp2 = card2.expression.includes(" ")
      ? `(${card2.expression})`
      : card2.expression;

    let result = 0;
    let expr = "";
    if (selectedOperator === "+") {
      result = v1 + v2;
      expr = `${exp1} + ${exp2}`;
    } else if (selectedOperator === "-") {
      result = v1 - v2;
      expr = `${exp1} - ${exp2}`;
    } else if (selectedOperator === "*") {
      result = v1 * v2;
      expr = `${exp1} × ${exp2}`;
    } else {
      if (v2 === 0) {
        haptics.play("error");
        setSelectedCardId(null);
        setSelectedOperator(null);
        return;
      }
      result = v1 / v2;
      expr = `${exp1} ÷ ${exp2}`;
    }

    const newCard: Card = {
      id: `card-new-${Date.now()}`,
      value: result,
      expression: expr,
      used: false,
    };
    const newCards = gameState.cards.map((c) =>
      c.id === card1.id || c.id === card2.id ? { ...c, used: true } : c,
    );
    newCards.push(newCard);
    const newHistory = [...gameState.history, newCards];
    setGameState({ cards: newCards, history: newHistory });
    setSelectedCardId(null);
    setSelectedOperator(null);

    if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    setHint(null);
    const cfg = getGame24Level(activeLevel ?? 1);
    if ((cfg.timeLimitSec === null || cfg.timeLimitSec >= 75)) {
      hintTimeoutRef.current = setTimeout(() => {
        setHint(getHint(newCards.filter((c) => !c.used).map((c) => c.value)));
      }, 30000);
    }

    const unused = newCards.filter((c) => !c.used);
    if (unused.length === 1) {
      if (Math.abs(unused[0].value - 24) < 1e-6) {
        handleWin();
      } else {
        haptics.play("error");
      }
    }
  };

  const handleOperatorPress = (op: Game24Operator) => {
    if (isGameOver || !selectedCardId) return;
    Haptics.selectionAsync();
    setSelectedOperator(op);
  };

  const handleUndo = () => {
    if (!gameState || gameState.history.length <= 1 || isGameOver) return;
    haptics.play("undo");
    const newHistory = gameState.history.slice(0, -1);
    const newCards = newHistory[newHistory.length - 1];
    setGameState({ cards: newCards, history: newHistory });
    setSelectedCardId(null);
    setSelectedOperator(null);
    setHint(null);
  };

  const handleReset = () => {
    if (!gameState || isGameOver) return;
    haptics.play("undo");
    const initialCards = gameState.history[0];
    setGameState({ cards: initialCards, history: [initialCards] });
    setSelectedCardId(null);
    setSelectedOperator(null);
    setHint(null);
  };

  const showFullSolution = () => {
    if (!gameState || isGameOver || activeLevel == null) return;
    const cfg = getGame24Level(activeLevel);
    if (!(cfg.timeLimitSec === null || cfg.timeLimitSec >= 75)) return;
    const initialNums = gameState.history[0].map((c) => c.value);
    const sol = solve24(initialNums);
    setSolution(sol);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };

  // -------------------- Pre-match (Versus) --------------------
  if (pendingVersusLevel != null) {
    const lvl = pendingVersusLevel;
    return (
      <MiniGameFrame
        title="Versus Mem"
        subtitle={`Level ${lvl}`}
        onBack={() => setPendingVersusLevel(null)}
      >
        <View style={styles.preMatch}>
          <Text style={[styles.preTitle, { color: colors.foreground }]}>
            Level {lvl} · Versus Mem
          </Text>
          <Text style={[styles.preBody, { color: colors.mutedForeground }]}>
            Race Mem to make 24. First to lock in the answer wins.
          </Text>
          <Text style={[styles.preBody, { color: colors.mutedForeground }]}>
            Mem gets faster on later levels.
          </Text>
          <DifficultyToggle
            value={difficulty}
            onChange={handleDifficultyChange}
            colors={colors}
          />
          <GradientButton
            title="Start Match"
            onPress={() => {
              setPendingVersusLevel(null);
              startLevel(lvl, "versus");
            }}
            style={{ marginTop: spacing.lg }}
          />
        </View>
      </MiniGameFrame>
    );
  }

  // -------------------- Level select --------------------
  if (activeLevel == null) {
    return (
      <MiniGameFrame title="24 Game" onBack={() => router.back()}>
        <View style={styles.levelGrid}>
          <LevelLadder
            progress={stats.game24Levels ?? {}}
            isPro={isPro}
            onSelect={(lvl, lockState) => {
              if (lockState === "pro-locked") {
                Haptics.selectionAsync();
                router.push("/subscription");
                return;
              }
              if (lockState === "locked") return;
              Haptics.selectionAsync();
              startLevel(lvl);
            }}
            onVersusSelect={(lvl, versusLock) => {
              if (versusLock === "pro-locked") {
                Haptics.selectionAsync();
                router.push("/subscription");
                return;
              }
              if (versusLock === "locked") {
                Alert.alert(
                  "Versus locked",
                  "Clear this level solo first to challenge Mem.",
                );
                return;
              }
              Haptics.selectionAsync();
              setPendingVersusLevel(lvl);
            }}
          />
          <Text style={[styles.gateHint, { color: colors.mutedForeground }]}>
            {isPro
              ? "Pro unlocks the full ladder."
              : `Free includes levels 1–${FREE_LEVEL_COUNT}. Pro unlocks the rest.`}
          </Text>
        </View>
      </MiniGameFrame>
    );
  }

  const cfg = getGame24Level(activeLevel);
  const unusedCards = gameState?.cards.filter((c) => !c.used) || [];
  // Next-level CTA must respect the same lock + Pro gating as the
  // level-select tiles — without this, a free user who clears
  // level 10 could tap "Next Level" and bypass the paywall straight
  // into level 11.
  const nextLevelLockState =
    activeLevel < LEVELS_PER_GAME
      ? levelLockState(activeLevel + 1, stats.game24Levels ?? {}, isPro)
      : "locked";
  const hasNextLevel =
    activeLevel < LEVELS_PER_GAME && nextLevelLockState !== "locked";
  const handleNextLevel = () => {
    if (activeLevel >= LEVELS_PER_GAME) return;
    if (nextLevelLockState === "pro-locked") {
      router.push("/subscription");
      return;
    }
    if (nextLevelLockState === "locked") return;
    startLevel(activeLevel + 1);
  };

  return (
    <View style={{ flex: 1 }}>
      <MiniGameFrame
        title={`Level ${activeLevel}`}
        subtitle={mode === "versus" ? "Versus Mem" : null}
        onBack={() => {
          if (timerRef.current) clearInterval(timerRef.current);
          if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
          // Cancel Mem's pending submission so leaving the match
          // never records a phantom versus loss after the user has
          // exited to the level select screen.
          clearMemTimer();
          setActiveLevel(null);
          setMode("solo");
        }}
        topRight={
          timeLeft !== null ? (
            <ScorePill label="Time" value={`${timeLeft}s`} />
          ) : undefined
        }
      >
      <View style={styles.gameArea}>
        {mode === "versus" ? (
          <Text
            style={[styles.threeStarHint, { color: colors.accent }]}
            accessibilityLiveRegion="polite"
          >
            {memThinking ? "Mem is thinking…" : "Race Mem to 24"}
          </Text>
        ) : (
          <Text
            style={[styles.threeStarHint, { color: colors.mutedForeground }]}
          >
            3★ if solved in ≤{cfg.threeStarTimeSec}s
          </Text>
        )}
        {mode === "versus" && memLine ? (
          <Text
            style={[styles.memLine, { color: colors.mutedForeground }]}
          >
            Mem: “{memLine}”
          </Text>
        ) : null}

        <View style={styles.cardsContainer}>
          {unusedCards.map((card) => {
            const isSelected = selectedCardId === card.id;
            return (
              <Pressable
                key={card.id}
                testID={`g24-card-${card.value}`}
                onPress={() => handleCardPress(card.id)}
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                  isSelected && styles.cardSelected,
                ]}
              >
                <Text style={[styles.cardValue, { color: colors.foreground }]}>
                  {Number.isInteger(card.value)
                    ? card.value
                    : card.value.toFixed(2)}
                </Text>
                {card.expression !== card.value.toString() && (
                  <Text
                    style={[styles.cardExpr, { color: colors.mutedForeground }]}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                  >
                    {card.expression}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.operatorsContainer}>
          {(cfg.operators as Game24Operator[]).map((op) => (
            <Pressable
              key={op}
              testID={`g24-op-${op}`}
              onPress={() => handleOperatorPress(op)}
              style={[
                styles.operatorBtn,
                { backgroundColor: colors.secondary },
                selectedOperator === op && { backgroundColor: colors.primary },
              ]}
              disabled={!selectedCardId || isGameOver}
            >
              <Text
                style={[
                  styles.operatorText,
                  {
                    color:
                      selectedOperator === op
                        ? colors.primaryForeground
                        : colors.primary,
                  },
                ]}
              >
                {op === "*" ? "×" : op === "/" ? "÷" : op}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.hintContainer}>
          {hint && !solution && (
            <View style={[styles.hintBox, { backgroundColor: colors.muted }]}>
              <Ionicons name="bulb-outline" size={16} color={colors.accent} />
              <Text style={[styles.hintText, { color: colors.foreground }]}>
                {hint}
              </Text>
            </View>
          )}
          {solution && (
            <View
              style={[styles.hintBox, { backgroundColor: colors.secondary }]}
            >
              <Text
                style={[
                  styles.hintText,
                  { color: colors.foreground, fontWeight: "bold" },
                ]}
              >
                Solution: {solution}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.controlsContainer}>
          <Pressable
            onPress={handleUndo}
            style={[
              styles.controlBtn,
              {
                opacity:
                  gameState && gameState.history.length > 1 ? 1 : 0.5,
              },
            ]}
            disabled={
              !gameState || gameState.history.length <= 1 || isGameOver
            }
          >
            <Ionicons name="arrow-undo" size={24} color={colors.foreground} />
            <Text style={[styles.controlText, { color: colors.foreground }]}>
              Undo
            </Text>
          </Pressable>

          <Pressable
            onPress={handleReset}
            style={[
              styles.controlBtn,
              {
                opacity:
                  gameState && gameState.history.length > 1 ? 1 : 0.5,
              },
            ]}
            disabled={
              !gameState || gameState.history.length <= 1 || isGameOver
            }
          >
            <Ionicons name="refresh" size={24} color={colors.foreground} />
            <Text style={[styles.controlText, { color: colors.foreground }]}>
              Reset
            </Text>
          </Pressable>

          {(cfg.timeLimitSec === null || cfg.timeLimitSec >= 75) && (
            <Pressable
              onPress={showFullSolution}
              style={[styles.controlBtn, { opacity: isGameOver ? 0.5 : 1 }]}
              disabled={isGameOver}
            >
              <Ionicons name="eye" size={24} color={colors.accent} />
              <Text style={[styles.controlText, { color: colors.accent }]}>
                Solve
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      </MiniGameFrame>

      {resultState === "win" && <Confetti />}

      <LevelResultOverlay
        visible={
          isGameOver && (resultState !== null || versusResult !== null)
        }
        state={
          mode === "versus"
            ? versusResult ?? "versus-draw"
            : resultState ?? "fail"
        }
        level={activeLevel}
        stars={mode === "versus" ? null : resultStars}
        hasNextLevel={mode === "versus" ? false : hasNextLevel}
        onNextLevel={handleNextLevel}
        nextLevelProLocked={nextLevelLockState === "pro-locked"}
        onReplay={() => startLevel(activeLevel, mode)}
        onExit={() => {
          clearMemTimer();
          setActiveLevel(null);
          setMode("solo");
        }}
      />

      <MilestoneToast
        milestone={pendingMilestone}
        onDismiss={() => setPendingMilestone(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
  },
  backButton: { padding: spacing.sm },
  headerRight: { width: 40, alignItems: "flex-end" },
  title: { ...text.sectionTitle },
  timer: {
    ...text.body,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  levelGrid: { paddingBottom: 40 },
  subtitle: {
    ...text.body,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  gateHint: {
    ...text.helperRegular,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  threeStarHint: {
    ...text.caption,
    textAlign: "center",
    marginVertical: spacing.sm,
  },
  gameArea: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    justifyContent: "space-between",
  },
  cardsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.base,
    justifyContent: "center",
    marginTop: spacing.base,
  },
  card: {
    width: "45%",
    aspectRatio: 1,
    borderRadius: radius.lg,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
  },
  cardSelected: {
    transform: [{ scale: 1.05 }],
    shadowColor: "#a78bfa",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
  },
  cardValue: { ...text.brand },
  cardExpr: {
    ...text.caption,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    marginTop: 4,
    textAlign: "center",
  },
  operatorsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginVertical: spacing.base,
  },
  operatorBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  operatorText: {
    fontSize: 28,
    fontWeight: "600",
  },
  hintContainer: { height: 60, justifyContent: "center" },
  hintBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
    borderRadius: radius.sm,
    gap: spacing.sm,
  },
  hintText: { ...text.helper, textAlign: "center" },
  controlsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: spacing.sm,
  },
  controlBtn: {
    alignItems: "center",
    padding: spacing.md,
    minWidth: 70,
  },
  controlText: {
    ...text.caption,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  preMatch: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    gap: spacing.md,
  },
  preTitle: {
    ...text.sectionTitle,
    textAlign: "center",
  },
  preBody: {
    ...text.body,
    textAlign: "center",
  },
  memLine: {
    ...text.helperRegular,
    textAlign: "center",
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    fontStyle: "italic",
  },
});
