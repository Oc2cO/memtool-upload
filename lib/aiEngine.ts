// MemTool AI engine (client orchestration). Server is the source of truth
// for vectors and the patterns envelope; this module batches embed
// requests, mirrors results into AsyncStorage for instant offline reads,
// and tracks per-memory embedding state via flags maintained on each
// Memory object (`pendingEmbedding` / `embeddingFailed` /
// `embeddingPermanentlyFailed`). The reaper gives a failed memory ONE
// more chance per day; if the retry fails it is marked permanently
// failed and never re-queued.

import {
  EMBEDDING_DAILY_CAP,
  loadEmbeddings,
  upsertEmbeddings,
  reserveDailyCap,
  loadDailyCap,
  loadStoredPatterns,
  writeStoredPatterns,
  loadPatternsMeta,
  writePatternsMeta,
  type EmbeddingMap,
} from "./aiEngineStorage";
import { resolveReplitApiBase } from "./config";
import type { MemoryFacets } from "./memories";

export const PATTERNS_REBUILD_NEW_THRESHOLD = 10;
export const PATTERNS_REBUILD_AGE_MS = 24 * 60 * 60 * 1000;
export const PATTERNS_COLD_START_MIN = 5;
export const SEARCH_TOP_K_MAX = 10;
export const EMBED_BATCH_MAX = 50;
export const EMBEDDING_MAX_RETRIES = 3;
export const EMBED_CALL_TIMEOUT_MS = 10_000;
export const EMBED_QUEUE_FLUSH_MS = 2_500;

export interface EngineMemoryInput {
  id: string;
  content: string;
  timestamp: string;
  kind?: "memory" | "call";
  tags?: string[];
  person?: string;
  /** Structured facets extracted on-device by the FoundationModels
   *  bridge (Task #195). When present, the patterns aggregator
   *  prefers `facets.tags` / `facets.theme` over the legacy
   *  `tags` keyword path so the home/recap surfaces reflect the
   *  model's higher-quality categorisation. Absent on legacy rows
   *  captured before the bridge shipped or on devices that cannot
   *  run the model — those rows fall back to `tags`. */
  facets?: MemoryFacets;
  embeddingFailed?: boolean;
  embeddingPermanentlyFailed?: boolean;
}

/**
 * Resolve the tag list this memory contributes to the patterns
 * aggregator.
 *
 * - When `facets` is present (any new memory captured by Task #195's
 *   on-device pipeline), use `facets.tags` and append `facets.theme`
 *   as an additional tag so the server's `tally` rolls recurring
 *   themes into both `tags_30d/90d` and (via top-tag promotion)
 *   `recurring_theme`. Empty strings are dropped; tags are
 *   lowercased so capitalisation differences across captures don't
 *   split a single concept into multiple low-count buckets.
 * - When `facets` is absent — legacy rows from before the bridge
 *   shipped, or rows from devices that can't run the model — fall
 *   back to the user-supplied `tags` keyword path so coverage on
 *   those rows is unchanged.
 */
export function derivePatternTags(memory: {
  tags?: string[];
  facets?: MemoryFacets;
}): string[] {
  if (memory.facets) {
    const out: string[] = [];
    const facetTags = Array.isArray(memory.facets.tags)
      ? memory.facets.tags
      : [];
    for (const t of facetTags) {
      if (typeof t !== "string") continue;
      const cleaned = t.trim().toLowerCase();
      if (cleaned) out.push(cleaned);
    }
    const theme =
      typeof memory.facets.theme === "string"
        ? memory.facets.theme.trim().toLowerCase()
        : "";
    if (theme) out.push(theme);
    return out;
  }
  if (!Array.isArray(memory.tags)) return [];
  const out: string[] = [];
  for (const t of memory.tags) {
    if (typeof t !== "string") continue;
    const cleaned = t.trim();
    if (cleaned) out.push(cleaned);
  }
  return out;
}

export interface PatternsTagCount {
  tag: string;
  count: number;
}
export interface PatternsPersonCount {
  person: string;
  count: number;
}
export interface PatternsKindCount {
  kind: string;
  count: number;
}

export interface PatternsData {
  cold_start: boolean;
  cold_start_min: number;
  memory_count: number;
  embedding_count: number;
  tags_30d: PatternsTagCount[];
  tags_90d: PatternsTagCount[];
  top_people: PatternsPersonCount[];
  recurring_kinds: PatternsKindCount[];
  weekday_mood: Record<string, number | null>;
  recurring_theme: string | null;
  mood_trend: string | null;
  today_centroid: number[] | null;
  centroid: number[] | null;
}

export interface PatternsEnvelope {
  version: number;
  generated_at: string;
  window_days: number;
  data: PatternsData;
}

export interface SearchResult {
  id: string;
  score: number;
}

export interface EngineMutator {
  setPending(ids: string[]): void;
  clearPending(ids: string[]): void;
  setEmbedded(ids: string[]): void;
  setFailed(ids: string[]): void;
  setPermanentlyFailed(ids: string[]): void;
}

let activeMutator: EngineMutator | null = null;
export function configureEngineMutator(m: EngineMutator | null): void {
  activeMutator = m;
}

interface EmbedResponse {
  model: string;
  dimension: number;
  embedded_ids: string[];
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export class EmbeddingQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingQuotaExceededError";
  }
}

async function postJson<T>(
  path: string,
  userId: string,
  body: unknown,
  timeoutMs: number = EMBED_CALL_TIMEOUT_MS,
): Promise<T> {
  const base = resolveReplitApiBase();
  const url = joinUrl(`${base}/api`, path);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mem-user-id": userId,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.status === 429) {
      throw new EmbeddingQuotaExceededError("Server-side daily quota exceeded");
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(
  path: string,
  userId: string,
  timeoutMs: number = EMBED_CALL_TIMEOUT_MS,
): Promise<T> {
  const base = resolveReplitApiBase();
  const url = joinUrl(`${base}/api`, path);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-mem-user-id": userId },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---- selection logic --------------------------------------------------

export function selectMemoriesForEmbedding(
  memories: EngineMemoryInput[],
  embeddings: EmbeddingMap,
): EngineMemoryInput[] {
  return memories.filter((m) => {
    if (!m.content || m.content.trim().length === 0) return false;
    if (embeddings[m.id]) return false;
    if (m.embeddingPermanentlyFailed) return false;
    return true;
  });
}

// ---- per-memory attempt counts (in-memory only; flags on Memory are
//      the durable record). Resets on app restart, which is fine — the
//      worst case is one extra retry after a process restart.
const attemptCounts = new Map<string, number>();
function bumpAttempt(id: string): number {
  const next = (attemptCounts.get(id) ?? 0) + 1;
  attemptCounts.set(id, next);
  return next;
}
function resetAttempts(ids: string[]): void {
  for (const id of ids) attemptCounts.delete(id);
}

// ---- embedding pipeline ----------------------------------------------

async function embedBatch(
  email: string,
  memories: EngineMemoryInput[],
): Promise<{ embedded: number; granted: number; failedIds: string[] }> {
  if (memories.length === 0) return { embedded: 0, granted: 0, failedIds: [] };
  const slice = memories.slice(0, EMBED_BATCH_MAX);
  const reservation = await reserveDailyCap(email, slice.length);
  if (!reservation.allowed || reservation.granted === 0) {
    return { embedded: 0, granted: 0, failedIds: [] };
  }
  const work = slice.slice(0, reservation.granted);
  const ids = work.map((m) => m.id);
  activeMutator?.setPending(ids);
  try {
    const resp = await postJson<EmbedResponse>("/ai/embed", email, {
      userId: email,
      items: work.map((m) => ({ id: m.id, text: m.content })),
    });
    if (
      !resp ||
      !Array.isArray(resp.embedded_ids) ||
      resp.embedded_ids.length !== work.length
    ) {
      throw new Error("Malformed embed response");
    }
    // The server owns the real embedding vectors (they stay server-side
    // for data-ownership safety and to avoid shipping large float arrays
    // over the wire on every request). What we write locally is a
    // zero-length "shadow" entry — `embedding: []` — whose only purpose
    // is to satisfy the cold-start gate in `pickInsightsView`:
    //   isColdStart = storedPatterns.cold_start (server-driven flag)
    //   OR vectorCount < COLD_START_MIN (local count gate)
    // Once an id appears in the local store, the count gate clears and
    // the patterns envelope (fetched separately) drives the view state.
    // The empty vector is never fed to any dot-product or distance math;
    // all ranking calls that need real vectors go through the server's
    // `/patterns` endpoint. This is intentional and correct for v1.0.
    await upsertEmbeddings(
      email,
      work.map((m) => ({ id: m.id, embedding: [], model: resp.model })),
    );
    activeMutator?.setEmbedded(ids);
    activeMutator?.clearPending(ids);
    resetAttempts(ids);
    return { embedded: work.length, granted: reservation.granted, failedIds: [] };
  } catch (err) {
    const failedIds: string[] = [];
    for (const id of ids) {
      const attempts = bumpAttempt(id);
      if (attempts >= EMBEDDING_MAX_RETRIES) failedIds.push(id);
    }
    activeMutator?.clearPending(ids);
    if (failedIds.length > 0) activeMutator?.setFailed(failedIds);
    if (err instanceof EmbeddingQuotaExceededError) throw err;
    return {
      embedded: 0,
      granted: reservation.granted,
      failedIds,
    };
  }
}

// ---- queue + retry orchestration -------------------------------------

interface EngineQueueState {
  pending: Map<string, EngineMemoryInput>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
}

const queues = new Map<string, EngineQueueState>();

function getQueue(email: string): EngineQueueState {
  let q = queues.get(email);
  if (!q) {
    q = { pending: new Map(), flushTimer: null, inFlight: false };
    queues.set(email, q);
  }
  return q;
}

function backoffMs(attempts: number): number {
  return Math.min(30_000, 500 * Math.pow(2, Math.max(0, attempts - 1)));
}

async function flushQueue(email: string): Promise<void> {
  const q = getQueue(email);
  q.flushTimer = null;
  if (q.inFlight || q.pending.size === 0) return;
  q.inFlight = true;
  try {
    const embeddings = await loadEmbeddings(email);
    const all = Array.from(q.pending.values());
    q.pending.clear();
    const toEmbed = selectMemoriesForEmbedding(all, embeddings);
    if (toEmbed.length === 0) return;
    let result;
    try {
      result = await embedBatch(email, toEmbed);
    } catch (err) {
      if (err instanceof EmbeddingQuotaExceededError) return;
      throw err;
    }
    if (result.embedded === 0 && result.failedIds.length < toEmbed.length) {
      const stillRetriable = toEmbed.filter(
        (m) => !result.failedIds.includes(m.id),
      );
      for (const m of stillRetriable) q.pending.set(m.id, m);
      const maxAttempts = stillRetriable.reduce(
        (acc, m) => Math.max(acc, attemptCounts.get(m.id) ?? 1),
        1,
      );
      scheduleFlush(email, backoffMs(maxAttempts));
    } else if (result.granted < toEmbed.length) {
      for (const m of toEmbed.slice(result.granted)) q.pending.set(m.id, m);
    }
  } finally {
    q.inFlight = false;
    if (q.pending.size > 0 && !q.flushTimer) {
      scheduleFlush(email, EMBED_QUEUE_FLUSH_MS);
    }
  }
}

function scheduleFlush(email: string, delayMs: number): void {
  const q = getQueue(email);
  if (q.flushTimer) return;
  q.flushTimer = setTimeout(() => {
    void flushQueue(email);
  }, delayMs);
}

export function enqueueMemoriesForEmbedding(
  email: string,
  memories: EngineMemoryInput[],
): void {
  if (!email || memories.length === 0) return;
  const q = getQueue(email);
  for (const m of memories) {
    if (!m || !m.id || !m.content) continue;
    if (m.embeddingPermanentlyFailed) continue;
    q.pending.set(m.id, m);
  }
  scheduleFlush(email, EMBED_QUEUE_FLUSH_MS);
}

export async function flushEmbeddingQueueNow(email: string): Promise<void> {
  const q = getQueue(email);
  if (q.flushTimer) {
    clearTimeout(q.flushTimer);
    q.flushTimer = null;
  }
  await flushQueue(email);
}

// ---- daily reaper -----------------------------------------------------
//
// On-app-foreground "daily reaper" replaces a missing nightly cron. It
// gives every `embeddingFailed` memory ONE more chance against the new
// day's fresh quota; if that retry also exhausts the 3-attempt budget
// the memory is marked `embeddingPermanentlyFailed` upstream and the
// reaper will never touch it again.

export async function runDailyReaper(
  email: string,
  failedMemories: EngineMemoryInput[],
): Promise<{ resetCount: number; capRemaining: number }> {
  const eligible = failedMemories.filter(
    (m) => m.embeddingFailed === true && m.embeddingPermanentlyFailed !== true,
  );
  if (eligible.length === 0) {
    const cap = await loadDailyCap(email);
    return {
      resetCount: 0,
      capRemaining: Math.max(0, EMBEDDING_DAILY_CAP - cap.used),
    };
  }
  const ids = eligible.map((m) => m.id);
  resetAttempts(ids);
  // Mark the next failure as terminal: bump the attempt floor so the
  // very next failed batch flips them to permanently failed.
  for (const id of ids) attemptCounts.set(id, EMBEDDING_MAX_RETRIES - 1);
  // Caller (MemoriesContext) is responsible for wiping `embeddingFailed`
  // off the Memory so selection picks them up again. Engine signals
  // intent via the mutator.
  activeMutator?.setPermanentlyFailed([]); // no-op; here for symmetry
  enqueueMemoriesForEmbedding(email, eligible);
  const cap = await loadDailyCap(email);
  return {
    resetCount: eligible.length,
    capRemaining: Math.max(0, EMBEDDING_DAILY_CAP - cap.used),
  };
}

// ---- retention window -------------------------------------------------

export function clampToVisibleWindow<T extends { timestamp: string }>(
  memories: T[],
  isPro: boolean,
  now: Date = new Date(),
): T[] {
  const days = isPro ? 31 : 7;
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return memories.filter((m) => {
    const t = new Date(m.timestamp).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

// ---- patterns ---------------------------------------------------------

export function shouldRebuildPatterns(
  totalMemories: number,
  meta: { last_built_at: string; memories_seen: number },
  now: Date = new Date(),
): boolean {
  if (!meta.last_built_at) return true;
  const newSince = totalMemories - meta.memories_seen;
  if (newSince >= PATTERNS_REBUILD_NEW_THRESHOLD) return true;
  const ageMs = now.getTime() - new Date(meta.last_built_at).getTime();
  if (Number.isFinite(ageMs) && ageMs >= PATTERNS_REBUILD_AGE_MS) return true;
  return false;
}

export async function refreshPatternsIfDue(
  email: string,
  isPro: boolean,
  memories: EngineMemoryInput[],
  moodHistory: { date: string; rating: number }[] = [],
): Promise<PatternsEnvelope | null> {
  const meta = await loadPatternsMeta(email);
  const due = shouldRebuildPatterns(memories.length, meta);
  if (!due) {
    return loadStoredPatterns<PatternsEnvelope>(email);
  }
  try {
    const env = await postJson<PatternsEnvelope>(
      "/ai/patterns/refresh",
      email,
      {
        userId: email,
        isPro,
        memories: memories.map((m) => ({
          id: m.id,
          timestamp: m.timestamp,
          kind: m.kind,
          tags: derivePatternTags(m),
          person: m.person,
        })),
        moodHistory,
      },
    );
    await writeStoredPatterns(email, env);
    await writePatternsMeta(email, {
      last_built_at: env.generated_at,
      memories_seen: memories.length,
    });
    return env;
  } catch {
    return loadStoredPatterns<PatternsEnvelope>(email);
  }
}

export async function fetchPatternsRecord(
  email: string,
): Promise<PatternsEnvelope | null> {
  try {
    return await getJson<PatternsEnvelope>("/ai/patterns", email);
  } catch {
    return loadStoredPatterns<PatternsEnvelope>(email);
  }
}

// Surface-level wrapper for screens that want to know when a fresh
// server fetch failed (e.g. so they can show a "Couldn't refresh"
// pill). Unlike fetchPatternsRecord, this does NOT swallow errors —
// callers are expected to catch and decide how to surface the
// failure. The local-cache fallback path is still available via
// loadStoredPatterns / fetchPatternsRecord for the silent-success
// path; this one is purely the "tell me if the network call failed"
// version.
export async function fetchPatternsFromServer(
  email: string,
): Promise<PatternsEnvelope | null> {
  return getJson<PatternsEnvelope>("/ai/patterns", email);
}

// ---- search (Pro-only) ------------------------------------------------

export async function semanticSearch(
  email: string,
  isPro: boolean,
  query: string,
  candidateIds: string[],
  topK: number = SEARCH_TOP_K_MAX,
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  if (!isPro) return [];
  const k = Math.min(SEARCH_TOP_K_MAX, Math.max(1, Math.floor(topK)));
  const reservation = await reserveDailyCap(email, 1);
  if (!reservation.allowed) {
    throw new EmbeddingQuotaExceededError(
      "Daily embedding cap reached; try again tomorrow",
    );
  }
  const resp = await postJson<{
    topK: number;
    candidate_count: number;
    matched_count: number;
    results: SearchResult[];
  }>("/ai/search", email, {
    userId: email,
    isPro,
    query: q,
    candidateIds,
    topK: k,
  });
  return Array.isArray(resp.results) ? resp.results : [];
}

// ---- exposed for tests / wiring --------------------------------------

export const _internals = {
  resolveReplitApiBase,
  embedBatch,
  flushQueue,
  attemptCounts,
};
