import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAuth } from "./AuthContext";
import {
  apiGetGameStats,
  apiPutGameStats,
  defaultGameStats,
  mergeGameStats,
  newClientId,
  RegressionError,
  setLastKnownGoodBlob,
  type GameStats,
  type LevelProgress,
  type VersusRecord,
} from "@/lib/gameStats";
import {
  game24Stars,
  memoryMatchStars,
  mergeLevelResult,
} from "@/lib/gameLevels";

export type { GameStats } from "@/lib/gameStats";
export type { LevelProgress } from "@/lib/gameStats";
export type { VersusRecord } from "@/lib/gameStats";

export type VersusOutcome = "win" | "loss" | "draw";

interface GameStatsContextType {
  stats: GameStats;
  updateMemoryMatchScore: (
    difficulty: "easy" | "medium" | "hard",
    moves: number,
    timeSec: number,
  ) => Promise<void>;
  recordGame24Result: (
    difficulty: "easy" | "medium" | "hard",
    won: boolean,
    timeSec?: number,
  ) => Promise<void>;
  /**
   * Level-progression recorders (Task #320). Both compute a 1–3 star
   * rating from the level config + outcome, merge it into the per-game
   * level map, and forward to the same in-flight chain that handles
   * the legacy aggregate fields. Returns the LevelProgress that ended
   * up stored so callers can render "you got N stars" in the
   * end-of-level overlay without re-reading the context.
   */
  recordMemoryMatchLevelResult: (
    level: number,
    moves: number,
    timeSec: number,
  ) => Promise<LevelProgress>;
  recordGame24LevelResult: (
    level: number,
    solveTimeSec: number,
  ) => Promise<LevelProgress>;
  /**
   * Record a failed 24 Game level (timeout or give-up). Resets the
   * legacy current streak for that level's difficulty bucket so the
   * level-based flow stays consistent with the old preset flow.
   */
  recordGame24LevelFail: (level: number) => Promise<void>;
  /**
   * Versus Mem recorders (Task #321). Bump the per-level wins /
   * losses / draws counter for the named game, separate from solo
   * level progress. Returns the stored VersusRecord so callers can
   * render the running tally in the end-of-match overlay without
   * re-reading the context.
   */
  recordMemoryMatchVersusResult: (
    level: number,
    outcome: VersusOutcome,
  ) => Promise<VersusRecord>;
  recordGame24VersusResult: (
    level: number,
    outcome: VersusOutcome,
  ) => Promise<VersusRecord>;
  refreshStats: () => Promise<void>;
  isLoading: boolean;
}

const GameStatsContext = createContext<GameStatsContextType | null>(null);

const cacheKey = (email: string) => `gameStats_${email}`;
const clientIdKey = (email: string) => `gameStats_clientId_${email}`;

// Run the in-cache migration block from the previous AsyncStorage-only
// implementation BEFORE any merge logic runs, so inputs are normalized.
function migrateCachedStats(parsed: any): GameStats {
  const migratedBestScore = { ...(parsed?.memoryMatchBestScore || {}) };
  for (const diff of ["easy", "medium", "hard"] as const) {
    if (typeof migratedBestScore[diff] === "number") {
      migratedBestScore[diff] = { moves: migratedBestScore[diff], timeSec: null };
    }
  }
  const migratedCurrentStreak =
    typeof parsed?.game24CurrentStreak === "number"
      ? { easy: parsed.game24CurrentStreak, medium: 0, hard: 0 }
      : { ...defaultGameStats.game24CurrentStreak, ...(parsed?.game24CurrentStreak || {}) };
  const migratedBestStreak =
    typeof parsed?.game24LongestStreak === "number"
      ? { easy: parsed.game24LongestStreak, medium: 0, hard: 0 }
      : parsed?.game24BestStreak
      ? { ...defaultGameStats.game24BestStreak, ...parsed.game24BestStreak }
      : { ...defaultGameStats.game24BestStreak };
  return {
    ...defaultGameStats,
    ...(parsed || {}),
    memoryMatchBestScore: {
      easy: migratedBestScore.easy ?? null,
      medium: migratedBestScore.medium ?? null,
      hard: migratedBestScore.hard ?? null,
    },
    game24CurrentStreak: migratedCurrentStreak,
    game24BestStreak: migratedBestStreak,
    game24BestTime: {
      easy: parsed?.game24BestTime?.easy ?? null,
      medium: parsed?.game24BestTime?.medium ?? null,
      hard: parsed?.game24BestTime?.hard ?? null,
    },
    memoryMatchLevels:
      parsed?.memoryMatchLevels && typeof parsed.memoryMatchLevels === "object"
        ? parsed.memoryMatchLevels
        : {},
    game24Levels:
      parsed?.game24Levels && typeof parsed.game24Levels === "object"
        ? parsed.game24Levels
        : {},
    memoryMatchVersusLevels:
      parsed?.memoryMatchVersusLevels &&
      typeof parsed.memoryMatchVersusLevels === "object"
        ? parsed.memoryMatchVersusLevels
        : {},
    game24VersusLevels:
      parsed?.game24VersusLevels &&
      typeof parsed.game24VersusLevels === "object"
        ? parsed.game24VersusLevels
        : {},
    pendingSync: parsed?.pendingSync === true ? true : undefined,
  };
}

async function readCachedStats(email: string): Promise<GameStats> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(email));
    if (!raw) return defaultGameStats;
    const parsed = JSON.parse(raw);
    return migrateCachedStats(parsed);
  } catch {
    return defaultGameStats;
  }
}

async function writeCachedStats(email: string, stats: GameStats): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(email), JSON.stringify(stats));
  } catch {
    // ignore
  }
}

async function getOrCreateClientId(email: string): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(clientIdKey(email));
    if (existing) return existing;
    const fresh = newClientId();
    await AsyncStorage.setItem(clientIdKey(email), fresh);
    return fresh;
  } catch {
    return newClientId();
  }
}

function withoutPending(s: GameStats): GameStats {
  if (!s.pendingSync) return s;
  const { pendingSync: _drop, ...rest } = s;
  return rest as GameStats;
}

function withPending(s: GameStats): GameStats {
  return s.pendingSync ? s : { ...s, pendingSync: true };
}

export function GameStatsProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [stats, setStats] = useState<GameStats>(defaultGameStats);
  const [isLoading, setIsLoading] = useState(true);
  const clientIdRef = useRef<string | null>(null);
  // statsRef tracks the latest committed stats synchronously so that
  // back-to-back `update*` / `record*` calls in the same React tick can
  // compose against each other's results instead of all reading the
  // same stale `stats` closure (which would lose one game's increment
  // when two finishes land together — see Rule #6).
  const statsRef = useRef<GameStats>(defaultGameStats);
  // Single in-flight chain serializes BOTH the cache write and the POST
  // for every committed update, so writes can't reorder on the server
  // and the cache always reflects the most recent committed blob.
  const inFlightRef = useRef<Promise<unknown>>(Promise.resolve());
  // Session epoch — bumps every time the active account changes
  // (login, logout, switch). Queued writes capture the epoch at
  // enqueue time and only mutate live React state if the epoch is
  // still current; cache writes always use the captured `email` so
  // an in-flight write for account A can't poison account B's cache.
  const sessionEpochRef = useRef(0);

  // Apply a state update synchronously to the ref AND schedule it on
  // React's setState. Reading from `statsRef.current` immediately after
  // returns the value just committed.
  const commitStats = useCallback((next: GameStats) => {
    statsRef.current = next;
    setStats(next);
  }, []);

  // Bump the session epoch whenever the active account changes.
  // Effect runs after the user-change render commits, which is fine —
  // we only need new writes (made on the new session) to see the new
  // epoch. Old in-flight writes captured the old epoch and will skip
  // any live-state mutation when they finish.
  useEffect(() => {
    sessionEpochRef.current += 1;
  }, [user?.email]);

  const loadStats = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      commitStats(defaultGameStats);
      setLastKnownGoodBlob(null);
      clientIdRef.current = null;
      setIsLoading(false);
      return;
    }
    const email = user.email;
    // Capture the epoch at the START of this load. Every async boundary
    // re-checks this so a stale (logged-out or account-switched) load
    // can never (a) update the new session's React state, (b) write to
    // the new account's cache, or (c) issue a network call under the
    // new account's auth token. If the session changes mid-load, we
    // bail out cleanly and let the new session's loadStats run fresh.
    const epoch = sessionEpochRef.current;
    const isStale = () => sessionEpochRef.current !== epoch;
    setIsLoading(true);

    // Always seed from cache first so the UI never blanks during the
    // network round-trip.
    const cached = await readCachedStats(email);
    if (isStale()) return;
    commitStats(cached);

    // Make sure we have a stable per-user client_id before any write.
    if (!clientIdRef.current) {
      clientIdRef.current = await getOrCreateClientId(email);
    }
    if (isStale()) return;
    const clientId = clientIdRef.current;

    let serverStats: GameStats | null;
    try {
      // Re-check immediately before the network call so we don't issue
      // a request under a freshly-rotated auth token.
      if (isStale()) return;
      const result = await apiGetGameStats();
      if (isStale()) return; // Discard a response that crossed sessions.
      serverStats = result.stats;
    } catch (err) {
      if (isStale()) return;
      console.warn("[gameStats] API load failed, staying with cache", err);
      // Keep cached state AND keep the prior `lastKnownGoodBlob` (if any)
      // so a transient GET failure doesn't disable Rule #9 regression
      // protection until the next successful POST. The blob is reset to
      // null only on logout / account change at the top of loadStats.
      setIsLoading(false);
      return;
    }

    if (serverStats === null) {
      // Fresh user on the server — local cache is the source of truth.
      // Seed lastKnownGoodBlob to null so the very first POST is not
      // gated by the regression guard.
      setLastKnownGoodBlob(null);
      const seed = withoutPending(cached);
      commitStats(seed);
      await writeCachedStats(email, seed);
      if (isStale()) {
        await writeCachedStats(email, withPending(seed));
        return;
      }
      try {
        await apiPutGameStats(seed, clientId);
      } catch (err) {
        console.warn("[gameStats] initial push failed", err);
        await writeCachedStats(email, withPending(seed));
        if (!isStale()) commitStats(withPending(statsRef.current));
      }
      if (!isStale()) setIsLoading(false);
      return;
    }

    const merged = withoutPending(mergeGameStats(serverStats, cached));
    commitStats(merged);
    await writeCachedStats(email, merged);
    // Rule #9(a): seed regression guard with the post-merge blob the
    // context is about to push. The reconcile POST then trivially
    // satisfies the guard, and after it succeeds the guard advances
    // to that same blob (handled inside apiPutGameStats).
    setLastKnownGoodBlob(merged);
    if (isStale()) {
      await writeCachedStats(email, withPending(merged));
      return;
    }
    try {
      await apiPutGameStats(merged, clientId);
    } catch (err) {
      console.warn("[gameStats] reconcile push failed", err);
      await writeCachedStats(email, withPending(merged));
      if (!isStale()) commitStats(withPending(statsRef.current));
    }
    if (!isStale()) setIsLoading(false);
  }, [user, authLoading, commitStats]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Serialize cache writes + network POSTs through a single in-flight
  // chain so back-to-back game finishes can't land out of order on the
  // server and the cache always matches the most recent commit.
  //
  // ACCOUNT SAFETY: every write captures `newStats` + `email` + `epoch`
  // at enqueue time. The captured values are used for ALL AsyncStorage
  // writes so an in-flight write for account A can never poison
  // account B's cache, even if the user logs out / switches mid-write.
  // Live React state is only mutated when the session epoch is still
  // current — stale tasks from a previous session no-op silently.
  const persistAndPush = useCallback(
    (newStats: GameStats, email: string, clientId: string) => {
      const epoch = sessionEpochRef.current;
      const isStale = () => sessionEpochRef.current !== epoch;
      const next = inFlightRef.current.then(async () => {
        // If the session changed between enqueue and execution, do NOT
        // issue a network call — it would go out under the new
        // session's auth token and could overwrite a different
        // account's server blob. Persist the captured account's cache
        // as still-pending so the next session-load reconciliation
        // re-pushes it under the right auth.
        if (isStale()) {
          await writeCachedStats(email, withPending(newStats));
          return;
        }
        // Optimistic cache write of the committed blob (no pending yet).
        // Bound to the captured email — never `statsRef.current` which
        // may belong to a different account by the time we run.
        await writeCachedStats(email, withoutPending(newStats));
        // Final epoch re-check immediately before the network call —
        // any session change while writing the cache aborts here.
        if (isStale()) {
          await writeCachedStats(email, withPending(newStats));
          return;
        }
        try {
          await apiPutGameStats(newStats, clientId);
          // Successful sync. The cache already reflects the cleared
          // (no-pending) blob from the optimistic write above. Only
          // touch live state if we're still on the same session.
          if (!isStale() && statsRef.current.pendingSync) {
            commitStats(withoutPending(statsRef.current));
          }
        } catch (err) {
          // Flag the captured account's cache so the next session-load
          // reconciliation re-pushes the latest committed blob.
          await writeCachedStats(email, withPending(newStats));
          // Only mutate live state if we're still on the same session.
          if (!isStale()) {
            commitStats(withPending(statsRef.current));
          }
          if (err instanceof RegressionError) {
            console.warn(
              "[gameStats] write blocked by regression guard",
              err.field,
              { last: err.last, outgoing: err.outgoing },
            );
            return;
          }
          console.warn("[gameStats] write failed, kept locally", err);
        }
      });
      // Swallow rejections on the chain so one failure doesn't poison
      // every future write — each handler already logs its own errors.
      inFlightRef.current = next.catch(() => {});
      return next;
    },
    [commitStats],
  );

  const updateMemoryMatchScore = useCallback(
    async (
      difficulty: "easy" | "medium" | "hard",
      moves: number,
      timeSec: number,
    ) => {
      if (!user) return;
      // Read latest committed state from the ref — NOT the `stats`
      // closure — so a Memory Match finish that lands in the same
      // tick as a 24 Game finish composes against that increment
      // instead of overwriting it.
      const current = statsRef.current;
      const newStats: GameStats = {
        ...current,
        memoryMatchGamesPlayed: current.memoryMatchGamesPlayed + 1,
        memoryMatchBestScore: { ...current.memoryMatchBestScore },
      };
      const currentBest = newStats.memoryMatchBestScore[difficulty];
      if (currentBest === null) {
        newStats.memoryMatchBestScore[difficulty] = { moves, timeSec };
      } else {
        const updatedBest = { ...currentBest };
        if (moves < currentBest.moves) {
          updatedBest.moves = moves;
        }
        if (currentBest.timeSec === null || timeSec < currentBest.timeSec) {
          updatedBest.timeSec = timeSec;
        }
        newStats.memoryMatchBestScore[difficulty] = updatedBest;
      }
      // Optimistic commit synchronously — the next call in the same
      // tick will see this as `statsRef.current` and compose from it.
      commitStats(newStats);
      const email = user.email;
      const clientId = clientIdRef.current ?? (await getOrCreateClientId(email));
      clientIdRef.current = clientId;
      void persistAndPush(newStats, email, clientId);
    },
    [user, commitStats, persistAndPush],
  );

  const recordGame24Result = useCallback(
    async (
      difficulty: "easy" | "medium" | "hard",
      won: boolean,
      timeSec?: number,
    ) => {
      if (!user) return;
      const current = statsRef.current;
      const newStats: GameStats = {
        ...current,
        game24GamesPlayed: current.game24GamesPlayed + 1,
        game24CurrentStreak: { ...current.game24CurrentStreak },
        game24BestStreak: { ...current.game24BestStreak },
        game24BestTime: { ...current.game24BestTime },
      };
      if (won) {
        newStats.game24CurrentStreak[difficulty] += 1;
        if (
          newStats.game24CurrentStreak[difficulty] >
          newStats.game24BestStreak[difficulty]
        ) {
          newStats.game24BestStreak[difficulty] =
            newStats.game24CurrentStreak[difficulty];
        }
        if (timeSec !== undefined) {
          const currentBestTime = newStats.game24BestTime[difficulty];
          if (currentBestTime === null || timeSec < currentBestTime) {
            newStats.game24BestTime[difficulty] = timeSec;
          }
        }
      } else {
        newStats.game24CurrentStreak[difficulty] = 0;
      }
      commitStats(newStats);
      const email = user.email;
      const clientId = clientIdRef.current ?? (await getOrCreateClientId(email));
      clientIdRef.current = clientId;
      void persistAndPush(newStats, email, clientId);
    },
    [user, commitStats, persistAndPush],
  );

  // Map a 30-step level to the legacy 3-bucket difficulty so the
  // existing aggregate fields (best score, streak, best time) keep
  // updating from the new gameplay paths. 1-10 -> easy,
  // 11-20 -> medium, 21-30 -> hard.
  const legacyDifficultyForLevel = (
    level: number,
  ): "easy" | "medium" | "hard" =>
    level <= 10 ? "easy" : level <= 20 ? "medium" : "hard";

  const recordMemoryMatchLevelResult = useCallback(
    async (level: number, moves: number, timeSec: number): Promise<LevelProgress> => {
      const stars = memoryMatchStars(level, moves, timeSec);
      const result: LevelProgress = {
        stars,
        bestTimeSec: timeSec,
        bestMoves: moves,
      };
      if (!user) return result;
      const current = statsRef.current;
      const mergedLevels = mergeLevelResult(
        current.memoryMatchLevels ?? {},
        level,
        result,
      );
      const stored = mergedLevels[level];
      const difficulty = legacyDifficultyForLevel(level);
      // Compose the legacy aggregate update INLINE so it lands in the
      // same single newStats commit as the per-level map. Mirrors the
      // logic in updateMemoryMatchScore so both code paths produce
      // identical aggregate stats.
      const newBestScore = { ...current.memoryMatchBestScore };
      const currentBest = newBestScore[difficulty];
      if (currentBest === null) {
        newBestScore[difficulty] = { moves, timeSec };
      } else {
        const updatedBest = { ...currentBest };
        if (moves < currentBest.moves) updatedBest.moves = moves;
        if (currentBest.timeSec === null || timeSec < currentBest.timeSec) {
          updatedBest.timeSec = timeSec;
        }
        newBestScore[difficulty] = updatedBest;
      }
      const newStats: GameStats = {
        ...current,
        memoryMatchGamesPlayed: current.memoryMatchGamesPlayed + 1,
        memoryMatchBestScore: newBestScore,
        memoryMatchLevels: mergedLevels,
      };
      commitStats(newStats);
      const email = user.email;
      const clientId = clientIdRef.current ?? (await getOrCreateClientId(email));
      clientIdRef.current = clientId;
      void persistAndPush(newStats, email, clientId);
      return stored;
    },
    [user, commitStats, persistAndPush],
  );

  const recordGame24LevelResult = useCallback(
    async (level: number, solveTimeSec: number): Promise<LevelProgress> => {
      const stars = game24Stars(level, solveTimeSec);
      const result: LevelProgress = {
        stars,
        bestTimeSec: solveTimeSec,
      };
      if (!user) return result;
      const current = statsRef.current;
      const mergedLevels = mergeLevelResult(
        current.game24Levels ?? {},
        level,
        result,
      );
      const stored = mergedLevels[level];
      const difficulty = legacyDifficultyForLevel(level);
      // Same reason as the Memory Match recorder: maintain legacy
      // aggregate streaks/times alongside the per-level map.
      const nextCurrentStreak = { ...current.game24CurrentStreak };
      const nextBestStreak = { ...current.game24BestStreak };
      const nextBestTime = { ...current.game24BestTime };
      nextCurrentStreak[difficulty] += 1;
      if (nextCurrentStreak[difficulty] > nextBestStreak[difficulty]) {
        nextBestStreak[difficulty] = nextCurrentStreak[difficulty];
      }
      const prevBestTime = nextBestTime[difficulty];
      if (prevBestTime === null || solveTimeSec < prevBestTime) {
        nextBestTime[difficulty] = solveTimeSec;
      }
      const newStats: GameStats = {
        ...current,
        game24GamesPlayed: current.game24GamesPlayed + 1,
        game24CurrentStreak: nextCurrentStreak,
        game24BestStreak: nextBestStreak,
        game24BestTime: nextBestTime,
        game24Levels: mergedLevels,
      };
      commitStats(newStats);
      const email = user.email;
      const clientId = clientIdRef.current ?? (await getOrCreateClientId(email));
      clientIdRef.current = clientId;
      void persistAndPush(newStats, email, clientId);
      return stored;
    },
    [user, commitStats, persistAndPush],
  );

  // ----- Versus Mem recorders -----
  // Bumps the per-level (wins / losses / draws) counter for the named
  // game and forwards through the same in-flight chain so writes can't
  // reorder. Versus tallies live in their own map so the solo level
  // ladder stats stay clean.
  const mergeVersusOutcome = (
    map: Record<number, VersusRecord>,
    level: number,
    outcome: VersusOutcome,
  ): { next: Record<number, VersusRecord>; stored: VersusRecord } => {
    const prev: VersusRecord = map[level] ?? {
      wins: 0,
      losses: 0,
      draws: 0,
      currentStreak: 0,
      bestStreak: 0,
    };
    // Streaks (Task #329): a win extends the current win streak and may
    // promote bestStreak; a loss or draw resets the current streak. We
    // compute these client-side so the existing recordVersus payload
    // shape stays compatible — the new fields are additive JSON keys.
    const prevCurrent = prev.currentStreak ?? 0;
    const prevBest = prev.bestStreak ?? 0;
    const nextCurrent = outcome === "win" ? prevCurrent + 1 : 0;
    const nextBest = nextCurrent > prevBest ? nextCurrent : prevBest;
    const stored: VersusRecord = {
      wins: prev.wins + (outcome === "win" ? 1 : 0),
      losses: prev.losses + (outcome === "loss" ? 1 : 0),
      draws: prev.draws + (outcome === "draw" ? 1 : 0),
      currentStreak: nextCurrent,
      bestStreak: nextBest,
    };
    return { next: { ...map, [level]: stored }, stored };
  };

  const recordMemoryMatchVersusResult = useCallback(
    async (level: number, outcome: VersusOutcome): Promise<VersusRecord> => {
      const current = statsRef.current;
      const { next, stored } = mergeVersusOutcome(
        current.memoryMatchVersusLevels ?? {},
        level,
        outcome,
      );
      if (!user) return stored;
      const newStats: GameStats = {
        ...current,
        memoryMatchVersusLevels: next,
      };
      commitStats(newStats);
      const email = user.email;
      const clientId = clientIdRef.current ?? (await getOrCreateClientId(email));
      clientIdRef.current = clientId;
      void persistAndPush(newStats, email, clientId);
      return stored;
    },
    [user, commitStats, persistAndPush],
  );

  const recordGame24VersusResult = useCallback(
    async (level: number, outcome: VersusOutcome): Promise<VersusRecord> => {
      const current = statsRef.current;
      const { next, stored } = mergeVersusOutcome(
        current.game24VersusLevels ?? {},
        level,
        outcome,
      );
      if (!user) return stored;
      const newStats: GameStats = {
        ...current,
        game24VersusLevels: next,
      };
      commitStats(newStats);
      const email = user.email;
      const clientId = clientIdRef.current ?? (await getOrCreateClientId(email));
      clientIdRef.current = clientId;
      void persistAndPush(newStats, email, clientId);
      return stored;
    },
    [user, commitStats, persistAndPush],
  );

  const recordGame24LevelFail = useCallback(
    async (level: number): Promise<void> => {
      if (!user) return;
      const current = statsRef.current;
      const difficulty = legacyDifficultyForLevel(level);
      const nextCurrentStreak = { ...current.game24CurrentStreak };
      nextCurrentStreak[difficulty] = 0;
      const newStats: GameStats = {
        ...current,
        game24GamesPlayed: current.game24GamesPlayed + 1,
        game24CurrentStreak: nextCurrentStreak,
      };
      commitStats(newStats);
      const email = user.email;
      const clientId = clientIdRef.current ?? (await getOrCreateClientId(email));
      clientIdRef.current = clientId;
      void persistAndPush(newStats, email, clientId);
    },
    [user, commitStats, persistAndPush],
  );

  return (
    <GameStatsContext.Provider
      value={{
        stats,
        updateMemoryMatchScore,
        recordGame24Result,
        recordMemoryMatchLevelResult,
        recordGame24LevelResult,
        recordGame24LevelFail,
        recordMemoryMatchVersusResult,
        recordGame24VersusResult,
        refreshStats: loadStats,
        isLoading,
      }}
    >
      {children}
    </GameStatsContext.Provider>
  );
}

export const useGameStats = () => {
  const ctx = useContext(GameStatsContext);
  if (!ctx) throw new Error("useGameStats must be used within GameStatsProvider");
  return ctx;
};
