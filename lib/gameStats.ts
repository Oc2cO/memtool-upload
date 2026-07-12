import { authFetch } from "./auth";
import { newClientId } from "./mood";

/**
 * Polsia MemTool game-stats backend contract (verified Apr 28, 2026).
 *
 * Base: https://mem-tool.polsia.app/api/memtool (set in lib/config.ts).
 * Auth: Bearer token from AsyncStorage `mt_token` (handled by authFetch).
 *
 * - GET  /game-stats
 *     -> { stats: GameStats | null, updated_at?: ISO-string }
 * - POST /sync/game_stats
 *     body: { action: "create", payload: <full GameStats blob + client_id>, timestamp }
 *     -> { ok: true }
 *
 * Critical contract notes:
 * - Single blob per user. The server stores ONE stats object — no list,
 *   no per-game record, no per-game endpoints.
 * - Whole-object replace. Every write completely overwrites the server's
 *   stored blob. NEVER POST a partial blob — always send the full
 *   GameStats object (Memory Match + 24 Game fields together).
 * - Same { action, payload, timestamp } envelope as memories/mood.
 * - Server returns NO `server_id` — response is bare { ok: true }.
 *   The local→server reconciliation key is `client_id` carried inside
 *   the payload.
 * - Server does NO payload validation. Empty {} is silently accepted.
 *   The client must validate before sending.
 * - Read returns null when the user has never synced (fresh install).
 * - Out-of-bounds endpoints (do NOT call): /games/score, /games,
 *   /games/scores, /stats, /scores, /sync/game-stats, /game_stats —
 *   all 404.
 *
 * Pre-write regression guard (Rule #9):
 * - Module-level `lastKnownGoodBlob` snapshots the last server-confirmed
 *   stats object.
 * - Set on (a) successful apiGetGameStats with non-null stats — caller
 *   should call setLastKnownGoodBlob with the post-merge blob it pushes;
 *   (b) automatically inside apiPutGameStats after a successful POST.
 * - Compares only monotonic fields. game24CurrentStreak.* is excluded
 *   (wrong-answer reset is legitimate game behavior, not a regression).
 * - On regression, throws RegressionError BEFORE the network call so a
 *   buggy merge can't corrupt the server. Local state must NOT be
 *   rolled back — the user's screen never lies about what they earned.
 */

export interface MemoryMatchBest {
  moves: number;
  timeSec: number | null;
}

export interface GameStats {
  memoryMatchGamesPlayed: number;
  memoryMatchBestScore: {
    easy: MemoryMatchBest | null;
    medium: MemoryMatchBest | null;
    hard: MemoryMatchBest | null;
  };
  game24GamesPlayed: number;
  game24CurrentStreak: { easy: number; medium: number; hard: number };
  game24BestStreak: { easy: number; medium: number; hard: number };
  game24BestTime: {
    easy: number | null;
    medium: number | null;
    hard: number | null;
  };
  /**
   * Per-level progress maps for the new level ladders (Task #320).
   * Keyed by level number → { stars, bestTimeSec, bestMoves? }.
   * Empty object on first run; merged by the server like every other
   * GameStats field. Old aggregate fields above are kept for the
   * "best ever" summary stats and so existing streak math still works.
   */
  memoryMatchLevels: Record<number, LevelProgress>;
  game24Levels: Record<number, LevelProgress>;
  /**
   * Versus Mem per-level tallies (Task #321). Stored separately from
   * solo level progress so the solo ladder stats stay clean. Wins /
   * losses / draws keyed by level number.
   */
  memoryMatchVersusLevels: Record<number, VersusRecord>;
  game24VersusLevels: Record<number, VersusRecord>;
  /**
   * Single blob-level "this update never reached the server" flag.
   * Persisted in the AsyncStorage cache; stripped from outgoing POSTs.
   * Cleared automatically on the next successful `apiPutGameStats`.
   */
  pendingSync?: boolean;
}

export interface LevelProgress {
  stars: 1 | 2 | 3;
  bestTimeSec?: number | null;
  bestMoves?: number | null;
}

export interface VersusRecord {
  wins: number;
  losses: number;
  draws: number;
  /**
   * Current consecutive-win streak vs Mem at this level (Task #329).
   * Resets to 0 on a loss or draw. Optional so legacy blobs without
   * the field deserialize cleanly; the normalizer backfills 0.
   */
  currentStreak?: number;
  /**
   * Longest consecutive-win streak vs Mem ever seen at this level.
   * Monotonic; merged by max across server / local replays.
   */
  bestStreak?: number;
}

interface ServerGameStatsResponse {
  stats: GameStats | null;
  updated_at?: string;
}

interface SyncResponse {
  ok: boolean;
}

export interface GameStatsLoadResult {
  stats: GameStats | null;
  updatedAt?: string;
}

export class RegressionError extends Error {
  field: string;
  last: unknown;
  outgoing: unknown;
  constructor(field: string, last: unknown, outgoing: unknown) {
    super(`[gameStats] REGRESSION BLOCKED on ${field}`);
    this.name = "RegressionError";
    this.field = field;
    this.last = last;
    this.outgoing = outgoing;
  }
}

export const defaultGameStats: GameStats = {
  memoryMatchGamesPlayed: 0,
  memoryMatchBestScore: { easy: null, medium: null, hard: null },
  game24GamesPlayed: 0,
  game24CurrentStreak: { easy: 0, medium: 0, hard: 0 },
  game24BestStreak: { easy: 0, medium: 0, hard: 0 },
  game24BestTime: { easy: null, medium: null, hard: null },
  memoryMatchLevels: {},
  game24Levels: {},
  memoryMatchVersusLevels: {},
  game24VersusLevels: {},
};

export { newClientId };

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

// ---------------------------------------------------------------------
// Per-field merge reducer (Rule #3 from the plan).
// Used at session-load to reconcile server vs local cache.
// ---------------------------------------------------------------------
function maxN(a: number, b: number): number {
  return a > b ? a : b;
}
function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}
function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}
function mergeMemoryMatchBest(
  s: MemoryMatchBest | null,
  l: MemoryMatchBest | null,
): MemoryMatchBest | null {
  if (!s && !l) return null;
  if (!s) return l;
  if (!l) return s;
  return {
    moves: Math.min(s.moves, l.moves),
    timeSec: minNullable(s.timeSec, l.timeSec),
  };
}

export function mergeGameStats(server: GameStats, local: GameStats): GameStats {
  const mergedMM: GameStats["memoryMatchBestScore"] = {
    easy: null,
    medium: null,
    hard: null,
  };
  const mergedBestStreak = { easy: 0, medium: 0, hard: 0 };
  const mergedBestTime: GameStats["game24BestTime"] = {
    easy: null,
    medium: null,
    hard: null,
  };
  for (const d of DIFFICULTIES) {
    mergedMM[d] = mergeMemoryMatchBest(
      server.memoryMatchBestScore?.[d] ?? null,
      local.memoryMatchBestScore?.[d] ?? null,
    );
    mergedBestStreak[d] = maxN(
      server.game24BestStreak?.[d] ?? 0,
      local.game24BestStreak?.[d] ?? 0,
    );
    mergedBestTime[d] = minNullable(
      server.game24BestTime?.[d] ?? null,
      local.game24BestTime?.[d] ?? null,
    );
  }
  return {
    memoryMatchGamesPlayed: maxN(
      server.memoryMatchGamesPlayed ?? 0,
      local.memoryMatchGamesPlayed ?? 0,
    ),
    memoryMatchBestScore: mergedMM,
    game24GamesPlayed: maxN(
      server.game24GamesPlayed ?? 0,
      local.game24GamesPlayed ?? 0,
    ),
    // Rule #3: currentStreak — local wins (server can't observe resets).
    game24CurrentStreak: { ...local.game24CurrentStreak },
    game24BestStreak: mergedBestStreak,
    game24BestTime: mergedBestTime,
    memoryMatchLevels: mergeLevelMaps(
      server.memoryMatchLevels ?? {},
      local.memoryMatchLevels ?? {},
    ),
    game24Levels: mergeLevelMaps(
      server.game24Levels ?? {},
      local.game24Levels ?? {},
    ),
    memoryMatchVersusLevels: mergeVersusMaps(
      server.memoryMatchVersusLevels ?? {},
      local.memoryMatchVersusLevels ?? {},
    ),
    game24VersusLevels: mergeVersusMaps(
      server.game24VersusLevels ?? {},
      local.game24VersusLevels ?? {},
    ),
  };
}

function mergeVersusMaps(
  a: Record<number, VersusRecord>,
  b: Record<number, VersusRecord>,
): Record<number, VersusRecord> {
  // Versus tallies are monotonic counters per (level, outcome). Merge
  // by max per field so a server-or-local replay can never lose a win
  // the user already saw.
  const out: Record<number, VersusRecord> = {};
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[Number(k)];
    const bv = b[Number(k)];
    if (!av) {
      out[Number(k)] = bv;
      continue;
    }
    if (!bv) {
      out[Number(k)] = av;
      continue;
    }
    // bestStreak is monotonic (best ever) → merge by max so a sync
    // can't lose a streak the user already achieved. currentStreak
    // is local-truth (only the device that played the most recent
    // match knows whether a loss reset it), so prefer the local
    // value but fall back to whichever side has it.
    const localCurrent = bv.currentStreak;
    const serverCurrent = av.currentStreak;
    out[Number(k)] = {
      wins: maxN(av.wins ?? 0, bv.wins ?? 0),
      losses: maxN(av.losses ?? 0, bv.losses ?? 0),
      draws: maxN(av.draws ?? 0, bv.draws ?? 0),
      currentStreak:
        typeof localCurrent === "number"
          ? localCurrent
          : typeof serverCurrent === "number"
            ? serverCurrent
            : 0,
      bestStreak: maxN(av.bestStreak ?? 0, bv.bestStreak ?? 0),
    };
  }
  return out;
}

function mergeLevelMaps(
  a: Record<number, LevelProgress>,
  b: Record<number, LevelProgress>,
): Record<number, LevelProgress> {
  const out: Record<number, LevelProgress> = {};
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[Number(k)];
    const bv = b[Number(k)];
    if (!av) {
      out[Number(k)] = bv;
      continue;
    }
    if (!bv) {
      out[Number(k)] = av;
      continue;
    }
    out[Number(k)] = {
      stars: (Math.max(av.stars, bv.stars) as 1 | 2 | 3),
      bestTimeSec: minNullable(av.bestTimeSec ?? null, bv.bestTimeSec ?? null),
      bestMoves: minNullable(av.bestMoves ?? null, bv.bestMoves ?? null),
    };
  }
  return out;
}

// ---------------------------------------------------------------------
// Pre-write regression guard (Rule #9).
// ---------------------------------------------------------------------
let lastKnownGoodBlob: GameStats | null = null;

export function setLastKnownGoodBlob(stats: GameStats | null): void {
  lastKnownGoodBlob = stats ? deepCloneStats(stats) : null;
}

export function getLastKnownGoodBlob(): GameStats | null {
  return lastKnownGoodBlob ? deepCloneStats(lastKnownGoodBlob) : null;
}

function deepCloneStats(s: GameStats): GameStats {
  return JSON.parse(JSON.stringify(s));
}

/**
 * Detect a monotonic-field regression. Returns null if outgoing is
 * acceptable, or details of the first regression found.
 *
 * Excluded from check: game24CurrentStreak.* (legitimate resets).
 * `null` on LAST is never a regression (first-ever score).
 */
function detectRegression(
  last: GameStats,
  outgoing: GameStats,
): { field: string; last: unknown; outgoing: unknown } | null {
  if (outgoing.memoryMatchGamesPlayed < last.memoryMatchGamesPlayed) {
    return {
      field: "memoryMatchGamesPlayed",
      last: last.memoryMatchGamesPlayed,
      outgoing: outgoing.memoryMatchGamesPlayed,
    };
  }
  if (outgoing.game24GamesPlayed < last.game24GamesPlayed) {
    return {
      field: "game24GamesPlayed",
      last: last.game24GamesPlayed,
      outgoing: outgoing.game24GamesPlayed,
    };
  }
  for (const d of DIFFICULTIES) {
    const lastBM = last.memoryMatchBestScore?.[d] ?? null;
    const outBM = outgoing.memoryMatchBestScore?.[d] ?? null;
    if (lastBM) {
      if (!outBM) {
        return {
          field: `memoryMatchBestScore.${d}`,
          last: lastBM,
          outgoing: null,
        };
      }
      if (outBM.moves > lastBM.moves) {
        return {
          field: `memoryMatchBestScore.${d}.moves`,
          last: lastBM.moves,
          outgoing: outBM.moves,
        };
      }
      if (lastBM.timeSec !== null) {
        if (outBM.timeSec === null || outBM.timeSec > lastBM.timeSec) {
          return {
            field: `memoryMatchBestScore.${d}.timeSec`,
            last: lastBM.timeSec,
            outgoing: outBM.timeSec,
          };
        }
      }
    }
    const lastBS = last.game24BestStreak?.[d] ?? 0;
    const outBS = outgoing.game24BestStreak?.[d] ?? 0;
    if (outBS < lastBS) {
      return {
        field: `game24BestStreak.${d}`,
        last: lastBS,
        outgoing: outBS,
      };
    }
    const lastBT = last.game24BestTime?.[d] ?? null;
    const outBT = outgoing.game24BestTime?.[d] ?? null;
    if (lastBT !== null) {
      if (outBT === null || outBT > lastBT) {
        return {
          field: `game24BestTime.${d}`,
          last: lastBT,
          outgoing: outBT,
        };
      }
    }
  }
  // Per-level star counts are monotonic: a level the user has already
  // earned N stars on must never regress to fewer stars (or disappear
  // entirely) on a subsequent push. Bonus metrics (bestTimeSec,
  // bestMoves) are NOT guarded here — those are best-effort and can
  // be legitimately absent on older clients.
  const levelMapRegression = detectLevelMapRegression(
    "memoryMatchLevels",
    last.memoryMatchLevels ?? {},
    outgoing.memoryMatchLevels ?? {},
  );
  if (levelMapRegression) return levelMapRegression;
  const game24LevelRegression = detectLevelMapRegression(
    "game24Levels",
    last.game24Levels ?? {},
    outgoing.game24Levels ?? {},
  );
  if (game24LevelRegression) return game24LevelRegression;
  return null;
}

function detectLevelMapRegression(
  fieldPrefix: "memoryMatchLevels" | "game24Levels",
  last: Record<number, LevelProgress>,
  outgoing: Record<number, LevelProgress>,
): { field: string; last: unknown; outgoing: unknown } | null {
  for (const k of Object.keys(last)) {
    const lastEntry = last[Number(k)];
    if (!lastEntry) continue;
    const outEntry = outgoing[Number(k)];
    if (!outEntry) {
      return {
        field: `${fieldPrefix}.${k}`,
        last: lastEntry,
        outgoing: null,
      };
    }
    if (outEntry.stars < lastEntry.stars) {
      return {
        field: `${fieldPrefix}.${k}.stars`,
        last: lastEntry.stars,
        outgoing: outEntry.stars,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// API surface.
// ---------------------------------------------------------------------
function nowIso(): string {
  return new Date().toISOString();
}

function normalizeServerStats(raw: unknown): GameStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<GameStats> & Record<string, unknown>;
  // Defensive: backfill any missing structure with defaults so the
  // merge reducer doesn't dereference undefined.
  return {
    memoryMatchGamesPlayed:
      typeof r.memoryMatchGamesPlayed === "number"
        ? r.memoryMatchGamesPlayed
        : 0,
    memoryMatchBestScore: {
      easy: normalizeMM(r.memoryMatchBestScore?.easy),
      medium: normalizeMM(r.memoryMatchBestScore?.medium),
      hard: normalizeMM(r.memoryMatchBestScore?.hard),
    },
    game24GamesPlayed:
      typeof r.game24GamesPlayed === "number" ? r.game24GamesPlayed : 0,
    game24CurrentStreak: {
      easy: r.game24CurrentStreak?.easy ?? 0,
      medium: r.game24CurrentStreak?.medium ?? 0,
      hard: r.game24CurrentStreak?.hard ?? 0,
    },
    game24BestStreak: {
      easy: r.game24BestStreak?.easy ?? 0,
      medium: r.game24BestStreak?.medium ?? 0,
      hard: r.game24BestStreak?.hard ?? 0,
    },
    game24BestTime: {
      easy: r.game24BestTime?.easy ?? null,
      medium: r.game24BestTime?.medium ?? null,
      hard: r.game24BestTime?.hard ?? null,
    },
    memoryMatchLevels: normalizeLevelMap(r.memoryMatchLevels),
    game24Levels: normalizeLevelMap(r.game24Levels),
    memoryMatchVersusLevels: normalizeVersusMap(r.memoryMatchVersusLevels),
    game24VersusLevels: normalizeVersusMap(r.game24VersusLevels),
  };
}

function normalizeVersusMap(v: unknown): Record<number, VersusRecord> {
  if (!v || typeof v !== "object") return {};
  const src = v as Record<string, unknown>;
  const out: Record<number, VersusRecord> = {};
  for (const k of Object.keys(src)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1) continue;
    const entry = src[k] as Partial<VersusRecord> | undefined;
    if (!entry || typeof entry !== "object") continue;
    out[n] = {
      wins: typeof entry.wins === "number" ? entry.wins : 0,
      losses: typeof entry.losses === "number" ? entry.losses : 0,
      draws: typeof entry.draws === "number" ? entry.draws : 0,
      currentStreak:
        typeof entry.currentStreak === "number" ? entry.currentStreak : 0,
      bestStreak:
        typeof entry.bestStreak === "number" ? entry.bestStreak : 0,
    };
  }
  return out;
}

function normalizeLevelMap(v: unknown): Record<number, LevelProgress> {
  if (!v || typeof v !== "object") return {};
  const src = v as Record<string, unknown>;
  const out: Record<number, LevelProgress> = {};
  for (const k of Object.keys(src)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1) continue;
    const entry = src[k] as Partial<LevelProgress> | undefined;
    if (!entry || typeof entry !== "object") continue;
    const stars = entry.stars;
    if (stars !== 1 && stars !== 2 && stars !== 3) continue;
    out[n] = {
      stars,
      bestTimeSec:
        typeof entry.bestTimeSec === "number" ? entry.bestTimeSec : null,
      bestMoves: typeof entry.bestMoves === "number" ? entry.bestMoves : null,
    };
  }
  return out;
}

function normalizeMM(v: unknown): MemoryMatchBest | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<MemoryMatchBest>;
  if (typeof o.moves !== "number") return null;
  return {
    moves: o.moves,
    timeSec: typeof o.timeSec === "number" ? o.timeSec : null,
  };
}

export async function apiGetGameStats(): Promise<GameStatsLoadResult> {
  const data = (await authFetch("/game-stats", {
    method: "GET",
  })) as ServerGameStatsResponse;
  return {
    stats: normalizeServerStats(data?.stats),
    updatedAt: typeof data?.updated_at === "string" ? data.updated_at : undefined,
  };
}

export interface PutResult {
  ok: boolean;
  blocked?: boolean;
  field?: string;
}

/**
 * POST the full stats blob. Runs the Rule #9 regression guard BEFORE
 * the network call. On guard hit, throws RegressionError and does not
 * touch the server. On success, advances lastKnownGoodBlob.
 */
export async function apiPutGameStats(
  stats: GameStats,
  clientId: string,
): Promise<PutResult> {
  if (lastKnownGoodBlob !== null) {
    const reg = detectRegression(lastKnownGoodBlob, stats);
    if (reg) {
      console.warn("[gameStats] REGRESSION BLOCKED", reg);
      throw new RegressionError(reg.field, reg.last, reg.outgoing);
    }
  }
  // Strip the client-only `pendingSync` flag — the server has no use
  // for it and it would round-trip back through GET otherwise.
  const { pendingSync: _ignored, ...sanitized } = stats;
  const payload = { ...sanitized, client_id: clientId };
  const res = (await authFetch("/sync/game_stats", {
    method: "POST",
    body: JSON.stringify({
      action: "create",
      payload,
      timestamp: nowIso(),
    }),
  })) as SyncResponse;
  if (res?.ok) {
    setLastKnownGoodBlob(stats);
  }
  return { ok: !!res?.ok };
}
