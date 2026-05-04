import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  View,
  Text,
  StyleSheet,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  withTiming,
  Easing,
} from "react-native-reanimated";

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
import { pickIconSet } from "@/lib/memoryMatchIcons";
import { playPattern, HAPTIC_PATTERNS } from "@/lib/haptics";
import { useCognitiveAudio } from "@/lib/cognitiveAudio";
import {
  FREE_LEVEL_COUNT,
  LEVELS_PER_GAME,
  computeMemoryMatchCardSize,
  getMemoryMatchLevel,
  highestUnlockedLevel,
  isLevelCleared,
  levelLockState,
  milestoneCrossedBy,
  versusLevelLockState,
  type LevelMilestone,
  type LevelProgress,
  type Stars,
} from "@/lib/gameLevels";
import { hasSeenMilestone, markMilestoneSeen } from "@/lib/milestonesSeen";
import {
  chooseMemoryMatchPick,
  makeSeedableRng,
  memoryMatchRecallProbability,
  pickMemLine,
  type MemDifficulty,
  type SeedableRng,
} from "@/lib/memOpponent";
import { loadMemDifficulty, saveMemDifficulty } from "@/lib/memDifficulty";
import { DifficultyToggle } from "@/components/DifficultyToggle";

interface Card {
  id: string;
  icon: string;
  isFlipped: boolean;
  isMatched: boolean;
}

function useGameAudio() {
  const { soundEnabled } = useSettings();
  return {
    playFlip: () => {
      if (!soundEnabled) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    playMatch: () => {
      if (!soundEnabled) return;
      playPattern(HAPTIC_PATTERNS["link-formed"]);
    },
    playMismatch: () => {
      if (!soundEnabled) return;
      playPattern(HAPTIC_PATTERNS.error);
    },
    playWin: () => {
      if (!soundEnabled) return;
      playPattern(HAPTIC_PATTERNS["streak-extended"]);
    },
  };
}

function MemoryCard({
  card,
  onPress,
  size,
  testID,
}: {
  card: Card;
  onPress: () => void;
  size: number;
  testID?: string;
}) {
  const colors = useColors();
  const flip = useSharedValue(0);

  useEffect(() => {
    flip.value = withTiming(card.isFlipped || card.isMatched ? 180 : 0, {
      duration: 300,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    });
  }, [card.isFlipped, card.isMatched]);

  const frontStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(flip.value, [0, 180], [0, 180]);
    return {
      transform: [{ rotateY: `${rotateY}deg` }],
      backfaceVisibility: "hidden",
    };
  });

  const backStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(flip.value, [0, 180], [180, 360]);
    return {
      transform: [{ rotateY: `${rotateY}deg` }],
      backfaceVisibility: "hidden",
    };
  });

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={[styles.cardContainer, { width: size, height: size }]}
      disabled={card.isMatched}
    >
      <Animated.View
        style={[
          styles.cardFace,
          frontStyle,
          { backgroundColor: colors.secondary, borderColor: colors.border },
        ]}
      >
        <Ionicons name="help-outline" size={size * 0.4} color={colors.primary} />
      </Animated.View>
      <Animated.View
        style={[
          styles.cardFace,
          backStyle,
          {
            backgroundColor: card.isMatched ? colors.card : colors.primary,
            borderColor: card.isMatched ? colors.accent : colors.primary,
          },
        ]}
      >
        <Text style={{ fontSize: size * 0.5 }}>{card.icon}</Text>
      </Animated.View>
    </Pressable>
  );
}

export default function MemoryMatchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const { stats, recordMemoryMatchLevelResult, recordMemoryMatchVersusResult } =
    useGameStats();
  const { status: subscriptionStatus } = useSubscription();
  const isPro = subscriptionStatus?.is_pro === true;
  const audio = useGameAudio();
  useCognitiveAudio("games");

  const [activeLevel, setActiveLevel] = useState<number | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [moves, setMoves] = useState(0);
  const [timeSec, setTimeSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
  const [resultStars, setResultStars] = useState<Stars | null>(null);
  const [showWin, setShowWin] = useState(false);
  const [pendingMilestone, setPendingMilestone] =
    useState<LevelMilestone | null>(null);

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
    loadMemDifficulty("memoryMatch").then((d) => {
      if (!cancelled) setDifficulty(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const handleDifficultyChange = (d: MemDifficulty) => {
    setDifficulty(d);
    void saveMemDifficulty("memoryMatch", d);
  };
  const [versusTurn, setVersusTurn] = useState<"user" | "mem">("user");
  const [userPairs, setUserPairs] = useState(0);
  const [memPairs, setMemPairs] = useState(0);
  const [memThinking, setMemThinking] = useState(false);
  const [memLine, setMemLine] = useState<string | null>(null);
  const [versusResult, setVersusResult] = useState<VersusOverlay | null>(null);
  // Mem's memory of cards it has seen face-up (index → icon).
  const memSeenRef = useRef<Map<number, string>>(new Map());
  const memRngRef = useRef<SeedableRng | null>(null);
  const lastMemLineRef = useRef<string | null>(null);
  // Pending Mem-turn timeouts so we can cancel on exit / reset.
  const memTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const versusTurnRef = useRef<"user" | "mem">("user");
  const playingRef = useRef(false);
  // Synchronous mirrors of the per-side pair counters. setState batching
  // means handleEnd would otherwise read stale userPairs/memPairs when
  // the final match resolves; refs keep the score truthful.
  const userPairsRef = useRef(0);
  const memPairsRef = useRef(0);
  versusTurnRef.current = versusTurn;
  playingRef.current = isPlaying;

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracked separately from the play timer so an early "Back to
  // levels" press during the preview window properly cancels the
  // pending reveal — otherwise the timeout would fire after exit and
  // try to flip cards on a stale level.
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Mismatch un-flip timeouts. Same lifecycle concern: pending
  // un-flips after exit would mutate cards from the prior level.
  const mismatchTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearAllLevelTimers = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    previewTimeoutRef.current = null;
    for (const t of mismatchTimeoutsRef.current) clearTimeout(t);
    mismatchTimeoutsRef.current = [];
    for (const t of memTimeoutsRef.current) clearTimeout(t);
    memTimeoutsRef.current = [];
  };

  const startLevel = (level: number, nextMode: Mode = "solo") => {
    const cfg = getMemoryMatchLevel(level);
    const icons = pickIconSet(cfg.pairs, cfg.similarIcons);
    const gameCards: Card[] = [...icons, ...icons]
      .sort(() => 0.5 - Math.random())
      .map((icon) => ({
        id: Math.random().toString(36).substring(2, 11),
        icon,
        isFlipped: true,
        isMatched: false,
      }));
    setActiveLevel(level);
    setMode(nextMode);
    setCards(gameCards);
    setMoves(0);
    setTimeSec(0);
    setIsPlaying(false);
    setFlippedIndices([]);
    setResultStars(null);
    setShowWin(false);
    setVersusResult(null);
    setUserPairs(0);
    setMemPairs(0);
    userPairsRef.current = 0;
    memPairsRef.current = 0;
    setVersusTurn("user");
    setMemThinking(false);
    setMemLine(null);
    lastMemLineRef.current = null;
    memSeenRef.current = new Map();
    // Deterministic seed per (level, mode, time bucket) — varies enough
    // between matches that Mem doesn't feel scripted, but stable for a
    // given match so any debugging is reproducible.
    memRngRef.current = makeSeedableRng(level * 9301 + Date.now());
    clearAllLevelTimers();
    previewTimeoutRef.current = setTimeout(() => {
      previewTimeoutRef.current = null;
      setCards((prev) => prev.map((c) => ({ ...c, isFlipped: false })));
      setIsPlaying(true);
      timerRef.current = setInterval(() => setTimeSec((p) => p + 1), 1000);
    }, cfg.previewMs);
  };

  // Centralized turn resolver. In versus mode, ownership of a flip pair
  // is decided up-front by versusTurn so Mem can't accidentally inherit
  // a match from an in-flight user pair (or vice versa). Returns the
  // updated `cards` snapshot and the new score deltas.
  const resolveFlipPair = (
    snapshot: Card[],
    first: number,
    second: number,
    matcher: "user" | "mem",
  ): { next: Card[]; matched: boolean; finished: boolean } => {
    const isMatch = snapshot[first].icon === snapshot[second].icon;
    if (isMatch) {
      const next = snapshot.map((c, i) =>
        i === first || i === second ? { ...c, isMatched: true } : c,
      );
      const finished = next.every((c) => c.isMatched);
      if (matcher === "user") {
        userPairsRef.current += 1;
        setUserPairs(userPairsRef.current);
      } else {
        memPairsRef.current += 1;
        setMemPairs(memPairsRef.current);
      }
      return { next, matched: true, finished };
    }
    return { next: snapshot, matched: false, finished: false };
  };

  const speakMem = (event: Parameters<typeof pickMemLine>[0]) => {
    const rng = memRngRef.current;
    if (!rng) return;
    const line = pickMemLine(event, rng, lastMemLineRef.current ?? undefined);
    lastMemLineRef.current = line;
    setMemLine(line);
  };

  const handleCardPress = (index: number) => {
    if (
      !isPlaying ||
      flippedIndices.length >= 2 ||
      cards[index].isFlipped ||
      cards[index].isMatched
    )
      return;
    if (mode === "versus" && versusTurn !== "user") return;
    audio.playFlip();
    const newCards = [...cards];
    newCards[index].isFlipped = true;
    setCards(newCards);
    if (mode === "versus") memSeenRef.current.set(index, newCards[index].icon);
    const newFlipped = [...flippedIndices, index];
    setFlippedIndices(newFlipped);
    if (newFlipped.length === 2) {
      setMoves((m) => m + 1);
      const [first, second] = newFlipped;
      const matcher: "user" | "mem" = "user";
      const { next, matched, finished } = resolveFlipPair(
        newCards,
        first,
        second,
        matcher,
      );
      if (matched) {
        audio.playMatch();
        setCards(next);
        setFlippedIndices([]);
        if (mode === "versus") speakMem("user-match");
        if (finished) {
          handleEnd(moves + 1, next);
        }
      } else {
        const t = setTimeout(() => {
          mismatchTimeoutsRef.current = mismatchTimeoutsRef.current.filter(
            (x) => x !== t,
          );
          audio.playMismatch();
          setCards((prev) => {
            const reset = [...prev];
            reset[first] = { ...reset[first], isFlipped: false };
            reset[second] = { ...reset[second], isFlipped: false };
            return reset;
          });
          setFlippedIndices([]);
          if (mode === "versus") {
            speakMem("user-mismatch");
            setVersusTurn("mem");
          }
        }, 800);
        mismatchTimeoutsRef.current.push(t);
      }
    }
  };

  // Mem's turn loop. Picks two cards via the recall-aware opponent,
  // animates the flip, scores, then either keeps the turn (on a match)
  // or yields back to the user (on a miss).
  const runMemTurn = useCallback(() => {
    if (!playingRef.current || versusTurnRef.current !== "mem") return;
    const cfg = activeLevel != null ? getMemoryMatchLevel(activeLevel) : null;
    if (!cfg || !memRngRef.current) return;
    setMemThinking(true);
    const recall = memoryMatchRecallProbability(activeLevel ?? 1);
    const t1 = setTimeout(() => {
      memTimeoutsRef.current = memTimeoutsRef.current.filter((x) => x !== t1);
      if (!playingRef.current) return;
      setCards((prev) => {
        let availableCount = 0;
        for (let i = 0; i < prev.length; i++) {
          if (!prev[i].isMatched && !prev[i].isFlipped) availableCount++;
        }
        if (availableCount < 2) return prev;
        const matched = new Set<number>();
        const revealed = new Map<number, string>();
        for (let i = 0; i < prev.length; i++) {
          if (prev[i].isMatched) matched.add(i);
        }
        for (const [idx, icon] of memSeenRef.current.entries()) {
          if (!matched.has(idx)) revealed.set(idx, icon);
        }
        // recall is computed inside chooseMemoryMatchPick from level;
        // surface variable so tooling sees it as referenced.
        void recall;
        const pick = chooseMemoryMatchPick({
          revealed,
          matched,
          totalCards: prev.length,
          rng: memRngRef.current!,
          level: activeLevel ?? 1,
          difficulty: difficultyRef.current,
        });
        const next = prev.map((c, i) =>
          i === pick.first || i === pick.second
            ? { ...c, isFlipped: true }
            : c,
        );
        memSeenRef.current.set(pick.first, next[pick.first].icon);
        memSeenRef.current.set(pick.second, next[pick.second].icon);
        // Resolve after a brief flip-display window.
        const t2 = setTimeout(() => {
          memTimeoutsRef.current = memTimeoutsRef.current.filter(
            (x) => x !== t2,
          );
          if (!playingRef.current) return;
          setMoves((m) => m + 1);
          const { next: resolved, matched, finished } = resolveFlipPair(
            next,
            pick.first,
            pick.second,
            "mem",
          );
          if (matched) {
            audio.playMatch();
            setCards(resolved);
            speakMem("mem-match");
            if (finished) {
              handleEnd(moves + 1, resolved);
              setMemThinking(false);
              return;
            }
            // Keep Mem's turn — schedule another pick.
            const t3 = setTimeout(() => {
              memTimeoutsRef.current = memTimeoutsRef.current.filter(
                (x) => x !== t3,
              );
              setMemThinking(false);
              runMemTurn();
            }, 600);
            memTimeoutsRef.current.push(t3);
          } else {
            audio.playMismatch();
            const t3 = setTimeout(() => {
              memTimeoutsRef.current = memTimeoutsRef.current.filter(
                (x) => x !== t3,
              );
              setCards((p) => {
                const reset = [...p];
                reset[pick.first] = { ...reset[pick.first], isFlipped: false };
                reset[pick.second] = {
                  ...reset[pick.second],
                  isFlipped: false,
                };
                return reset;
              });
              speakMem("mem-mismatch");
              setMemThinking(false);
              setVersusTurn("user");
            }, 800);
            memTimeoutsRef.current.push(t3);
          }
        }, 600);
        memTimeoutsRef.current.push(t2);
        return next;
      });
    }, 700);
    memTimeoutsRef.current.push(t1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLevel, audio, moves]);

  // Drive Mem's turn when the turn flag flips to "mem".
  useEffect(() => {
    if (mode !== "versus") return;
    if (!isPlaying) return;
    if (versusTurn !== "mem") return;
    runMemTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isPlaying, versusTurn]);

  const handleEnd = async (finalMoves: number, finalCards: Card[]) => {
    clearAllLevelTimers();
    setIsPlaying(false);
    if (activeLevel == null) return;
    // Compute the milestone-crossed signal BEFORE recording the
    // result so `milestoneCrossedBy` can compare against the
    // pre-clear progress map. After the result is stored, level N
    // is "cleared" and the helper would always return null.
    const prevProgress = stats.memoryMatchLevels ?? {};
    const crossed = milestoneCrossedBy(prevProgress, activeLevel);

    if (mode === "solo") {
      audio.playWin();
      const stored = await recordMemoryMatchLevelResult(
        activeLevel,
        finalMoves,
        timeSec,
      );
      setResultStars(stored.stars);
      setShowWin(true);
      if (crossed) {
        const seen = await hasSeenMilestone("memoryMatch", crossed.level);
        if (!seen) {
          setPendingMilestone(crossed);
          await markMilestoneSeen("memoryMatch", crossed.level);
        }
      }
      return;
    }
    // Refs are updated synchronously inside resolveFlipPair, so they're
    // always current here (state setters can be stale due to batching).
    void finalCards;
    const user = userPairsRef.current;
    const mem = memPairsRef.current;
    const outcome: VersusOverlay =
      user > mem ? "versus-win" : mem > user ? "versus-loss" : "versus-draw";
    if (outcome === "versus-win") audio.playWin();
    setVersusResult(outcome);
    setShowWin(true);
    speakMem(
      outcome === "versus-win"
        ? "user-wins"
        : outcome === "versus-loss"
        ? "mem-wins"
        : "draw",
    );
    await recordMemoryMatchVersusResult(
      activeLevel,
      outcome === "versus-win"
        ? "win"
        : outcome === "versus-loss"
        ? "loss"
        : "draw",
    );
  };

  useEffect(() => {
    return () => {
      clearAllLevelTimers();
    };
  }, []);

  const formatTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // -------------------- Pre-match (Versus) --------------------
  if (pendingVersusLevel != null) {
    const lvl = pendingVersusLevel;
    const skill = Math.round(memoryMatchRecallProbability(lvl, difficulty) * 100);
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
            Take turns flipping cards. Match to score a pair and keep the
            turn. Most pairs at the end wins.
          </Text>
          <Text style={[styles.preBody, { color: colors.mutedForeground }]}>
            Mem's recall: {skill}%
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
      <MiniGameFrame title="Memory Match" onBack={() => router.back()}>
        <View style={styles.levelGrid}>
          <LevelLadder
            progress={stats.memoryMatchLevels ?? {}}
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

  // -------------------- In-level play --------------------
  const cfg = getMemoryMatchLevel(activeLevel);
  const horizontalPad = spacing.lg * 2;
  const gap = spacing.md;
  const boardWidth = windowWidth - horizontalPad;
  // Tall grids (e.g. 4×7, 4×8) on shorter devices would clip the
  // bottom rows if we sized cards by width alone. Constrain by the
  // visible board height too so every tile is reachable. The chrome
  // estimate covers the header, stats bar, vertical paddings, and
  // safe-area insets — it's intentionally conservative so cards
  // never overflow.
  const chromeAllowance =
    insets.top + insets.bottom + 60 /* header */ + 96 /* statsBar */ + 80; /* paddings + breathing room */
  const boardHeight = Math.max(120, windowHeight - chromeAllowance);
  const cardSize = computeMemoryMatchCardSize({
    level: activeLevel,
    boardWidth,
    boardHeight,
    gap,
  });
  // Next-level CTA must respect the same lock + Pro gating as the
  // level-select tiles — without this, a free user who clears
  // level 10 could tap "Next Level" and bypass the paywall straight
  // into level 11.
  const nextLevelLockState =
    activeLevel < LEVELS_PER_GAME
      ? levelLockState(activeLevel + 1, stats.memoryMatchLevels ?? {}, isPro)
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
          clearAllLevelTimers();
          setActiveLevel(null);
          setMode("solo");
        }}
        topRight={
          mode === "versus" ? (
            <ScorePill label="You · Mem" value={`${userPairs} · ${memPairs}`} />
          ) : (
            <ScorePill label="Moves" value={moves} />
          )
        }
      >
      <View
        style={[
          styles.statsBar,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        {mode === "versus" ? (
          <>
            <View style={styles.stat}>
              <Text
                style={[styles.statLabel, { color: colors.mutedForeground }]}
              >
                You
              </Text>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {userPairs}
              </Text>
            </View>
            <View style={styles.stat}>
              <Text
                style={[styles.statLabel, { color: colors.mutedForeground }]}
              >
                Turn
              </Text>
              <Text
                style={[
                  styles.statValue,
                  {
                    color:
                      versusTurn === "user" ? colors.primary : colors.accent,
                  },
                ]}
              >
                {versusTurn === "user"
                  ? "You"
                  : memThinking
                  ? "Mem…"
                  : "Mem"}
              </Text>
            </View>
            <View style={styles.stat}>
              <Text
                style={[styles.statLabel, { color: colors.mutedForeground }]}
              >
                Mem
              </Text>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {memPairs}
              </Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.stat}>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Moves
              </Text>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {moves}
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Time
              </Text>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {formatTime(timeSec)}
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                3★ in
              </Text>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                ≤{cfg.threeStarMoves} moves
              </Text>
            </View>
          </>
        )}
      </View>

      {mode === "versus" && memLine ? (
        <Text
          style={[styles.memLine, { color: colors.mutedForeground }]}
          accessibilityLiveRegion="polite"
        >
          Mem: “{memLine}”
        </Text>
      ) : null}

      <View style={[styles.gameBoard, { gap }]}>
        {cards.map((card, i) => (
          <MemoryCard
            key={card.id}
            card={card}
            onPress={() => handleCardPress(i)}
            size={cardSize}
            testID={`mem-card-${i}`}
          />
        ))}
      </View>
      </MiniGameFrame>

      {showWin && resultStars && resultStars >= 1 && <Confetti />}

      <LevelResultOverlay
        visible={showWin}
        state={mode === "versus" ? versusResult ?? "versus-draw" : "win"}
        level={activeLevel}
        stars={mode === "versus" ? null : resultStars}
        hasNextLevel={mode === "versus" ? false : hasNextLevel}
        onNextLevel={handleNextLevel}
        nextLevelProLocked={nextLevelLockState === "pro-locked"}
        onReplay={() => startLevel(activeLevel, mode)}
        onExit={() => {
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
    paddingBottom: spacing.base,
  },
  backButton: { padding: spacing.sm },
  title: { ...text.sectionTitle },
  levelGrid: { paddingBottom: 40 },
  subtitle: {
    ...text.body,
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
  statsBar: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "space-around",
    marginBottom: spacing.lg,
  },
  stat: { alignItems: "center" },
  statLabel: {
    ...text.caption,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    marginBottom: 4,
  },
  statValue: {
    ...text.body,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  gameBoard: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
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
    marginBottom: spacing.sm,
    fontStyle: "italic",
  },
  cardContainer: { aspectRatio: 1 },
  cardFace: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
