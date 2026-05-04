// Per-user (per-email) AsyncStorage for the on-device AI engine cache.
// Server is the source of truth for vectors and the patterns envelope;
// the client mirrors them so screens can render instantly offline.
import AsyncStorage from "@react-native-async-storage/async-storage";

export const EMBEDDING_DAILY_CAP = 100;

export interface StoredEmbedding {
  v: number[];
  model: string;
  built_at: string;
}
export type EmbeddingMap = Record<string, StoredEmbedding>;

export interface DailyCapState {
  date: string;
  used: number;
}

export interface PatternsMeta {
  last_built_at: string;
  memories_seen: number;
}

const embeddingsKey = (email: string) => `memEmbeddings_${email}`;
const capKey = (email: string) => `memEmbeddingsCap_${email}`;
const patternsKey = (email: string) => `memPatterns_${email}`;
const patternsMetaKey = (email: string) => `memPatternsMeta_${email}`;

function utcDayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* engine is best-effort; never blocks UI */
  }
}

export function loadEmbeddings(email: string): Promise<EmbeddingMap> {
  return readJson<EmbeddingMap>(embeddingsKey(email), {});
}

export async function upsertEmbeddings(
  email: string,
  entries: { id: string; embedding: number[]; model: string }[],
): Promise<EmbeddingMap> {
  const map = await loadEmbeddings(email);
  const built_at = new Date().toISOString();
  for (const e of entries) {
    map[e.id] = { v: e.embedding, model: e.model, built_at };
  }
  await writeJson(embeddingsKey(email), map);
  return map;
}

export async function loadDailyCap(email: string): Promise<DailyCapState> {
  const today = utcDayKey();
  const state = await readJson<DailyCapState>(capKey(email), {
    date: today,
    used: 0,
  });
  if (state.date !== today) {
    const reset: DailyCapState = { date: today, used: 0 };
    await writeJson(capKey(email), reset);
    return reset;
  }
  return state;
}

export async function reserveDailyCap(
  email: string,
  cost: number,
  cap: number = EMBEDDING_DAILY_CAP,
): Promise<{ allowed: boolean; granted: number; remaining: number }> {
  const state = await loadDailyCap(email);
  const remaining = Math.max(0, cap - state.used);
  if (remaining === 0) return { allowed: false, granted: 0, remaining: 0 };
  const granted = Math.min(cost, remaining);
  state.used += granted;
  await writeJson(capKey(email), state);
  return {
    allowed: true,
    granted,
    remaining: Math.max(0, cap - state.used),
  };
}

export async function loadStoredPatterns<T>(email: string): Promise<T | null> {
  return readJson<T | null>(patternsKey(email), null);
}

export async function writeStoredPatterns<T>(
  email: string,
  patterns: T,
): Promise<void> {
  await writeJson(patternsKey(email), patterns);
}

export async function loadPatternsMeta(email: string): Promise<PatternsMeta> {
  return readJson<PatternsMeta>(patternsMetaKey(email), {
    last_built_at: "",
    memories_seen: 0,
  });
}

export async function writePatternsMeta(
  email: string,
  meta: PatternsMeta,
): Promise<void> {
  await writeJson(patternsMetaKey(email), meta);
}

/** Wipe every on-device AI cache key for a single user. The server
 *  retains its own copy of vectors and the patterns envelope, so this
 *  is a "forget locally and re-pull on next refresh" operation, not
 *  a destructive delete. Best-effort: storage failures are swallowed
 *  so the Settings UI can render a friendly success either way. */
export async function clearAiEngineCache(email: string): Promise<void> {
  if (!email) return;
  try {
    await AsyncStorage.multiRemove([
      embeddingsKey(email),
      capKey(email),
      patternsKey(email),
      patternsMetaKey(email),
    ]);
  } catch {
    /* swallow — caller is the Settings UI, which will refetch on focus */
  }
}

export const _internal = { utcDayKey };
