import AsyncStorage from "@react-native-async-storage/async-storage";
import { authFetch, AuthError, getToken } from "./auth";
import { apiFetchAnnotations } from "./annotations";
import { resolveAuthApiBase, resolveReplitApiBase } from "./config";
import {
  CaptureBlockedError,
  CaptureLimitReachedError,
  FREE_DAILY_CAPTURE_LIMIT,
  SERVER_CAPTURE_BLOCKED_CODE,
  SERVER_CAPTURE_LIMIT_CODE,
} from "./subscription";
import { getLocalDayKey } from "./captureLimits";

/**
 * Polsia MemTool backend contract (verified Apr 28, 2026).
 *
 * Base: https://mem-tool.polsia.app/api/memtool (set in lib/config.ts).
 * Auth: Bearer token from AsyncStorage `mt_token` (handled by authFetch).
 *
 * - GET  /memories?page=N&limit=N[&q=...]
 *     -> { memories: ServerMemory[], total, page, limit }
 *     `q` is server-side full-text filter on content.
 * - POST /sync/memories
 *     body: { action: "create"|"update"|"delete", payload, timestamp }
 *     create payload: { client_id, content, type, tags, mood, is_starred }
 *     update payload: { client_id, content?, type?, tags? }
 *     delete payload: { client_id }
 *     -> { ok: true, server_id? }
 *
 * Notes:
 * - `client_id` is the canonical key for update/delete (server returns 400
 *   if `id` is sent instead).
 * - `type` accepts "memory" | "call".
 * - `person` and `linkedEventId` are NOT persisted server-side; we keep
 *   them in a local annotation map keyed by client_id (see MemoriesContext).
 * - /memories/search and /memories/suggest-tags do not exist (404).
 */

export type MemoryKind = "memory" | "call";

/**
 * Structured tag/theme/mood facets for a single memory, extracted
 * locally on-device by Apple's FoundationModels framework via the
 * `extractFacets` Swift bridge (Task #195). Optional on every
 * `Memory`: rows captured before the bridge shipped, rows captured
 * on a non-Apple-Intelligence device, and rows where the model
 * call failed all simply omit the field and fall back to today's
 * behaviour (no facets, the rest of the app keeps working).
 *
 * Persisted only on-device. The server contract has no column for
 * facets — they ride along in the AsyncStorage cache so a cold
 * start that hits the cache renders them, and the merge step in
 * `MemoriesContext.loadMemories` re-attaches them to the
 * server-fresh rows when the network round-trip completes.
 */
export interface MemoryFacets {
  /** Up to ~5 short, lowercase, single-word topical tags. Drives
   *  the existing patterns / themes surfaces in `lib/aiEngine.ts`
   *  without a server round-trip. */
  tags: string[];
  /** A short noun phrase (≤ 6 words) capturing the recurring
   *  pattern this memory belongs to. Empty string when the model
   *  cannot infer one. */
  theme: string;
  /** A single lowercase emotion word ("calm", "anxious",
   *  "grateful"). Empty string when uncertain. */
  mood: string;
}

export interface Memory {
  id: string;
  userId: string;
  content: string;
  timestamp: string;
  kind: MemoryKind;
  tags?: string[];
  person?: string;
  linkedEventId?: string;
  serverId?: string;
  /** On-device facets extracted by the FoundationModels bridge.
   *  Absent when the device couldn't run the model (older iOS,
   *  non-eligible hardware, Apple Intelligence off) or when the
   *  call failed; the rest of the app degrades silently. */
  facets?: MemoryFacets;
  /** True while the row still has an entry in the sync outbox (awaiting
   *  a successful create/update/delete). Derived from the outbox by
   *  `MemoriesContext`; do not flip directly. */
  pendingSync?: boolean;
  /** True when the row's outbox entry has failed at least once. Used by
   *  `MemorySyncStatus` to render the muted warning glyph instead of
   *  the in-flight spinner. */
  syncFailed?: boolean;
  // AI engine state lives directly on the Memory so it survives reloads
  // and is observable from any consumer without a parallel store.
  pendingEmbedding?: boolean;
  embeddingFailed?: boolean;
  embeddingPermanentlyFailed?: boolean;
  /** Server-held flag mirrored from Polsia. Currently read-only on the
   *  client (UI to toggle ships separately); included on the model so
   *  it survives the round-trip into exports. */
  isStarred?: boolean;
  /** Server-held mood string (e.g. "happy"). Mirrored read-only for
   *  the same reason as `isStarred`. Null when the server has no value. */
  mood?: string | null;
  /** Public URL of the AI illustration generated for this memory, if
   *  any. Stored server-side per-user keyed by `client_id` and merged
   *  in by `MemoriesContext.loadMemories` next to the annotations
   *  merge. Absent when the user hasn't run "Illustrate" yet (or
   *  while the request is still in flight). */
  illustrationUrl?: string;
  /** Public URL of the small (256x256) variant of the illustration
   *  used by the Archive polaroid. Pre-warmed and disk-cached by
   *  expo-image so scrolling doesn't re-fetch the full 1024x1024
   *  PNG on every render. Falls back to `illustrationUrl` if a
   *  legacy server response omits it. */
  illustrationThumbUrl?: string;
  /** ISO timestamp of when the illustration was generated. Used by
   *  the polaroid UI for the "Illustrated <relative time> ago"
   *  caption and to invalidate stale rows if a regenerate flow
   *  ships later. */
  illustratedAt?: string;
  /** Public URL of a user-uploaded photo attached to this memory
   *  (Task #372). Stored server-side per-user keyed by `client_id`
   *  in the `memory_photo` table; the bytes live in App Storage
   *  (GCS) under a public ACL and are served via
   *  `/api/storage/objects/<id>`. Absent when no photo has been
   *  attached. While a fresh capture's photo is still in the
   *  upload queue (offline / mid-PUT), the field is also absent —
   *  the row renders text-only until the queue drains, at which
   *  point `mergePhotos` patches the URL in. */
  photoUrl?: string;
  /** Public URL of the smaller (256x256 JPEG) variant the server
   *  generates at confirm time. Falls back to `photoUrl` when
   *  the server couldn't decode the original (HEIC, etc) so the
   *  Archive row still renders a thumbnail. */
  photoThumbUrl?: string;
  /** Optional ISO capture timestamp the picker reported (EXIF or
   *  filesystem). Surfaced in the photo card caption when present. */
  photoTakenAt?: string;
  /** True while a photo is sitting in the local upload queue
   *  (waiting on network or a successful PUT). Surfaces a small
   *  "Uploading photo…" affordance on the row so the user knows
   *  the picture they attached hasn't been lost. Cleared when
   *  every queued photo for this memory confirms server-side. */
  photoPendingUpload?: boolean;
  /** Local-day (YYYY-MM-DD, device timezone) this memory is
   *  considered the user's daily selfie for (Task #375). The
   *  `daily-selfie` tag is the durable marker that survives a
   *  /sync round trip; this field is the derived form the recap
   *  surfaces read so they don't have to re-bucket on every
   *  render. Absent on every non-selfie memory. */
  dailySelfieDate?: string;
  /** Full ordered album of user-attached photos for this memory
   *  (Task #385). A memory can hold up to 4 photos; the legacy
   *  `photoUrl` / `photoThumbUrl` / `photoTakenAt` fields above
   *  mirror `photos[0]` so older surfaces keep rendering without
   *  a refactor while multi-photo-aware UIs (capture confirm
   *  card, Archive row) read the full list off `photos`. Absent
   *  when no photo has been attached; an empty array is treated
   *  the same as absent. */
  photos?: MemoryPhotoEntry[];
}

/**
 * One user-uploaded photo attached to a memory (Task #385). Mirrors
 * the `PhotoMapEntry` shape the photos client lib emits, plus an
 * optional `photoId` so per-photo deletes / edits can target the
 * exact row instead of the whole album.
 */
export interface MemoryPhotoEntry {
  url: string;
  thumbUrl?: string;
  takenAt?: string;
  /** Stable server-side photo id (the third component of the
   *  `memory_photo` PK). Absent on optimistic queue entries that
   *  haven't been confirmed yet. */
  photoId?: string;
}

export interface MemoryAnnotation {
  person?: string;
  linkedEventId?: string;
}

export type MemoryAnnotationMap = Record<string, MemoryAnnotation>;

interface ServerMemory {
  id: string;
  content: string;
  type: MemoryKind;
  tags: string[] | null;
  mood: string | null;
  is_starred: boolean;
  client_id: string;
  created_at: string;
  updated_at: string;
}

interface ListMemoriesResponse {
  memories: ServerMemory[];
  total: number;
  page: number;
  limit: number;
}

interface SyncResponse {
  ok: boolean;
  server_id?: string;
}

export interface CreateMemoryInput {
  client_id: string;
  content: string;
  kind: MemoryKind;
  tags?: string[];
}

export interface UpdateMemoryInput {
  content?: string;
  kind?: MemoryKind;
  tags?: string[];
}

export function newClientId(): string {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function fromServer(m: ServerMemory, userId: string): Memory {
  // Daily-selfie marker (Task #375) survives /sync via the
  // `daily-selfie` tag — recover the device-local-day form here so
  // recap surfaces don't have to re-bucket on every render. We
  // deliberately bucket by the row's `created_at`, which is the
  // capture moment, not the local "today" — a selfie taken Friday
  // evening should still surface in Friday's recap when the user
  // opens the screen on Saturday morning.
  const tags = m.tags ?? undefined;
  const isSelfie =
    Array.isArray(tags) &&
    tags.some((t) => typeof t === "string" && t.toLowerCase() === "daily-selfie");
  let dailySelfieDate: string | undefined;
  if (isSelfie) {
    const d = new Date(m.created_at);
    if (!Number.isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      dailySelfieDate = `${yyyy}-${mm}-${dd}`;
    }
  }
  return {
    id: m.client_id,
    serverId: m.id,
    userId,
    content: m.content,
    timestamp: m.created_at,
    kind: (m.type as MemoryKind) ?? "memory",
    tags,
    isStarred: m.is_starred ?? false,
    mood: m.mood ?? null,
    dailySelfieDate,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function apiListMemories(
  userId: string,
  page = 1,
  limit = 20,
  signal?: AbortSignal,
): Promise<Memory[]> {
  const data = (await authFetch(
    `/memories?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`,
    { method: "GET", signal },
  )) as ListMemoriesResponse;
  const list = Array.isArray(data?.memories) ? data.memories : [];
  return list.map((m) => fromServer(m, userId));
}

/**
 * Hard ceiling for a single foreground `apiListMemories` call from
 * `MemoriesContext.refresh`. Mirrors the export-side
 * `EXPORT_FETCH_TIMEOUT_MS` (Task #143) so the regular in-app memory
 * list can no longer hang on a captive-portal Wi-Fi where the TCP
 * handshake completes but no data ever arrives — without this ceiling
 * the home tab would sit on its loading spinner forever instead of
 * falling back to the cached rows.
 *
 * `authFetch` already imposes its own 20s `REQUEST_TIMEOUT_MS`, but
 * that ceiling is shared with every server call (auth, AI Guide,
 * etc.) and is intentionally generous. The home tab is a foreground
 * spinner the user is staring at, so we want a tighter, list-specific
 * ceiling that can be tuned independently — 15s matches the per-page
 * export budget which has held up well in practice.
 *
 * Exported so the regression test can wire it through fake timers
 * without re-deriving the value.
 */
export const LIST_FETCH_TIMEOUT_MS = 15_000;

/**
 * `apiListMemories` with a per-call timeout AbortController.
 *
 * Used by `MemoriesContext.refresh` so a hung page fetch gives up
 * after `LIST_FETCH_TIMEOUT_MS` and the caller can surface the
 * cached list instead of spinning forever. A fired timeout aborts
 * the in-flight request, which surfaces to `authFetch` as a network
 * failure (`AuthError` with no `status`) — exactly the error shape
 * `MemoriesContext`'s catch already treats as the offline path.
 *
 * `timeoutMs <= 0` disables the timeout (handy for tests that want
 * to assert the no-timeout legacy behaviour without re-mocking).
 */
export async function apiListMemoriesWithTimeout(
  userId: string,
  page = 1,
  limit = 20,
  timeoutMs: number = LIST_FETCH_TIMEOUT_MS,
): Promise<Memory[]> {
  if (timeoutMs <= 0) return apiListMemories(userId, page, limit);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await apiListMemories(userId, page, limit, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Server-side search.
 *
 * Polsia does NOT expose `/memories/search` (404 on GET and POST, verified
 * Apr 28, 2026). Instead, the `q` query param on `GET /memories` performs
 * the same content full-text filter and returns the standard paginated
 * shape — verified by inserting a unique-marker memory and observing the
 * filtered total go from 0 → 1. If Polsia ever ships a dedicated
 * `/memories/search` endpoint, swap the URL below; the response shape is
 * identical so no other code needs to change.
 */
export async function apiSearchMemories(
  userId: string,
  query: string,
  page = 1,
  limit = 50,
  signal?: AbortSignal,
): Promise<Memory[]> {
  const q = query.trim();
  if (!q) return apiListMemories(userId, page, limit, signal);
  const data = (await authFetch(
    `/memories?q=${encodeURIComponent(q)}&page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`,
    { method: "GET", signal },
  )) as ListMemoriesResponse;
  const list = Array.isArray(data?.memories) ? data.memories : [];
  return list.map((m) => fromServer(m, userId));
}

/**
 * `apiSearchMemories` with a per-call timeout AbortController.
 *
 * Used by `MemoriesContext.searchMemories` (the Archive tab search
 * bar) so a hung search request gives up after `LIST_FETCH_TIMEOUT_MS`
 * — Tasks #143 (export) and #179 (home memory list) already added the
 * same ceiling to their flows; this closes the last foreground hang
 * vector on a captive-portal Wi-Fi where the TCP handshake completes
 * but no data ever arrives.
 *
 * A fired timeout aborts the in-flight request, which surfaces to
 * `authFetch` as an `AuthError` with no `status` — exactly the error
 * shape `MemoriesContext.searchMemories`'s catch already treats as
 * the network-failure path (it falls back to a local in-memory
 * filter).
 *
 * Reuses `LIST_FETCH_TIMEOUT_MS` rather than introducing a new
 * constant so the in-app foreground list ceilings stay tunable as
 * one knob.
 *
 * `timeoutMs <= 0` disables the timeout for tests that want to
 * assert the legacy no-timeout behaviour without re-mocking.
 */
export async function apiSearchMemoriesWithTimeout(
  userId: string,
  query: string,
  page = 1,
  limit = 50,
  timeoutMs: number = LIST_FETCH_TIMEOUT_MS,
): Promise<Memory[]> {
  if (timeoutMs <= 0) return apiSearchMemories(userId, query, page, limit);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await apiSearchMemories(
      userId,
      query,
      page,
      limit,
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Server-side enforcement of the daily capture cap arrives as HTTP
 * 402 with `body.code === "FREE_TIER_CAPTURE_LIMIT"` (see Polsia
 * spec). The client gates in `MemoriesContext.addMemory` are the
 * first line of defense; this 402 is the safety net for the rare
 * race where two devices on the same account capture concurrently
 * and only one stays under the cap from the server's view.
 *
 * We translate it into the same `CaptureLimitReachedError` the
 * client throws for its own gate so screens (capture.tsx,
 * log-call.tsx) can handle one error type instead of two and route
 * straight to /subscription. The SERVER_CAPTURE_LIMIT_CODE constant
 * lives in `lib/subscription.ts` so any future server-side cap code
 * change is a one-file flip.
 *
 * Anything else (network error, 5xx, malformed response) propagates
 * untouched — `MemoriesContext.addMemory`'s catch then keeps the
 * memory locally with `pendingSync: true` for the next refresh.
 */
function isCaptureLimitError(err: unknown): err is AuthError {
  if (!(err instanceof AuthError)) return false;
  if (err.status !== 402) return false;
  const body = err.body;
  if (!body || typeof body !== "object") return false;
  const code = (body as { code?: unknown }).code;
  return code === SERVER_CAPTURE_LIMIT_CODE;
}

/**
 * Server-enforced capture path.
 *
 * Why we proxy creates through our api-server (Task #32): the
 * 10/day free-tier capture cap MUST be enforced server-side because
 * a determined user could otherwise skip the device gates and POST
 * straight to Polsia. Polsia is out-of-repo and doesn't know about
 * our RevenueCat entitlement; the only reliable choke point we
 * own is our api-server. So:
 *
 *   create  →  POST <our-api>/api/sync/memories  (gated by cap)
 *   update  →  POST <polsia>/sync/memories       (no cap)
 *   delete  →  POST <polsia>/sync/memories       (no cap)
 *
 * Our api-server verifies the same Polsia bearer token, looks up
 * Pro entitlement, and either passes the request through to Polsia
 * or returns 402 with `code: FREE_TIER_CAPTURE_LIMIT`. The mobile
 * client maps that 402 into `CaptureLimitReachedError`, which the
 * outbox already classifies as `errorClass: "cap"` and the caller
 * already handles by rolling back the optimistic row and routing
 * to /subscription.
 *
 * The base-URL resolution lives in `lib/config.ts:resolveReplitApiBase`
 * — the same source of truth `serverEntitlement.ts`,
 * `illustrations.ts`, `annotations.ts`, `aiEngine.ts`, `profile.ts`,
 * and the codegen client setup all share.
 */

interface ProxyErrorBody {
  code?: string;
  limit?: number;
  remaining?: number;
  error?: string;
}

export async function apiCreateMemory(
  input: CreateMemoryInput,
): Promise<SyncResponse> {
  const payload: Record<string, unknown> = {
    client_id: input.client_id,
    content: input.content,
    type: input.kind,
    tags: input.tags ?? [],
    mood: null,
    is_starred: false,
  };

  const token = await getToken();
  // No bearer token = not signed in. Mirror authFetch's behavior of
  // letting the upstream return 401 — but we don't even need to
  // call out, the user shouldn't be capturing without a session.
  // Throwing the same shape authFetch would throw keeps the outbox
  // classifier (`errorClass: "auth"`) happy.
  if (!token) {
    throw new AuthError("Not signed in", 401);
  }

  let res: Response;
  try {
    res = await fetch(`${resolveAuthApiBase().replace(/\/+$/, "")}/sync/memories`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: "create",
        payload,
        timestamp: nowIso(),
        // Device-local calendar day (YYYY-MM-DD) so the server's
        // claim store buckets by the user's wall-clock day instead
        // of UTC. Without this, a user in Tokyo or Sydney would see
        // their cap reset partway through their local day.
        localDay: getLocalDayKey(),
      }),
    });
  } catch {
    // Network failure reaching our proxy. Throw an AuthError-shape
    // so the outbox classifier treats it as a transient network
    // issue (`errorClass: "transient"`) and retries.
    throw new AuthError("Couldn't reach the server — check your connection");
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (res.status === 402) {
    const code = (body as ProxyErrorBody | null)?.code;
    if (code === SERVER_CAPTURE_LIMIT_CODE) {
      const limit = (body as ProxyErrorBody | null)?.limit;
      throw new CaptureLimitReachedError(
        typeof limit === "number" ? limit : FREE_DAILY_CAPTURE_LIMIT,
      );
    }
    // Unknown 402 shape — surface as a regular auth error so the
    // outbox can mark the row failed (vs. silently dropping it).
    throw new AuthError(
      typeof (body as ProxyErrorBody | null)?.error === "string"
        ? String((body as ProxyErrorBody).error)
        : "Capture refused",
      402,
      body,
    );
  }

  // 429 + CAPTURE_BLOCKED_ABUSE = the api-server has auto-blocked
  // this account for the rest of the UTC day after detecting a
  // cap-bypass abuse pattern (see
  // `IMPLAUSIBLE_LOCAL_DAY_HARD_BLOCK_THRESHOLD` in
  // `artifacts/api-server/src/routes/sync-memories.ts`). Translate
  // it into a typed error so the capture screens can show a
  // cooldown message instead of either crashing or routing to the
  // upsell. An unknown 429 shape falls through to the generic
  // AuthError path below so the outbox marks the row failed
  // instead of silently dropping it.
  if (res.status === 429) {
    const code = (body as ProxyErrorBody | null)?.code;
    if (code === SERVER_CAPTURE_BLOCKED_CODE) {
      throw new CaptureBlockedError();
    }
  }

  if (!res.ok) {
    throw new AuthError(
      typeof (body as ProxyErrorBody | null)?.error === "string"
        ? String((body as ProxyErrorBody).error)
        : `Request failed (${res.status})`,
      res.status,
      body,
    );
  }

  return (body ?? { ok: true }) as SyncResponse;
}

// Retained for any external caller that still references it; the
// proxy itself does both check and create atomically now, but the
// helper keeps the public name stable in case other modules import
// it. Throws on cap, resolves on success.
export async function apiCheckCaptureLimit(
  _appUserId: string,
  _clientId: string,
): Promise<void> {
  // No-op. Cap enforcement now lives in `apiCreateMemory` via the
  // server proxy — keeping this as a no-op preserves the public
  // surface for outbox callers that may still call it. Kept
  // intentionally so removing it is a separate, low-risk diff.
  return;
}

// Used by isCaptureLimitError type-guard tests; keep exported for
// future-proofing the AuthError 402 path that update/delete still
// take when Polsia returns its own cap error.
export function _isCaptureLimitErrorForTesting(err: unknown): boolean {
  return isCaptureLimitError(err);
}

export async function apiUpdateMemory(
  client_id: string,
  updates: UpdateMemoryInput,
): Promise<SyncResponse> {
  const payload: Record<string, unknown> = { client_id };
  if (updates.content !== undefined) payload.content = updates.content;
  if (updates.kind !== undefined) payload.type = updates.kind;
  if (updates.tags !== undefined) payload.tags = updates.tags;
  return (await authFetch("/sync/memories", {
    method: "POST",
    body: JSON.stringify({ action: "update", payload, timestamp: nowIso() }),
  })) as SyncResponse;
}

export async function apiDeleteMemory(client_id: string): Promise<SyncResponse> {
  return (await authFetch("/sync/memories", {
    method: "POST",
    body: JSON.stringify({
      action: "delete",
      payload: { client_id },
      timestamp: nowIso(),
    }),
  })) as SyncResponse;
}

export function mergeAnnotations(
  memories: Memory[],
  annotations: MemoryAnnotationMap,
): Memory[] {
  return memories.map((m) => {
    const ann = annotations[m.id];
    if (!ann) return m;
    return {
      ...m,
      person: ann.person ?? m.person,
      linkedEventId: ann.linkedEventId ?? m.linkedEventId,
    };
  });
}

export function extractAnnotation(m: Memory): MemoryAnnotation | null {
  if (!m.person && !m.linkedEventId) return null;
  const ann: MemoryAnnotation = {};
  if (m.person) ann.person = m.person;
  if (m.linkedEventId) ann.linkedEventId = m.linkedEventId;
  return ann;
}

const EXPORT_PAGE_SIZE = 100;

/**
 * How long any single page fetch in `fetchAllMemoriesForExport` is
 * allowed to run before we give up on it. Without this ceiling, a
 * captive-portal Wi-Fi (or any connection that completes the TCP
 * handshake but never returns data) could hang the export indefinitely
 * — Task #136's "Retrying network…" indicator would just sit there
 * until the user backgrounded the app or tapped Cancel (Task #143).
 *
 * 15s is comfortably longer than a healthy round-trip on a slow LTE
 * connection (the Polsia list endpoint typically responds in <500ms),
 * but short enough that the user's deterministic worst-case wait —
 * across the first attempt and one retry — stays under 30s before
 * either the share sheet opens or the cached-copy prompt re-pops.
 *
 * Exported so the regression test can wire it through fake timers
 * without re-deriving the value.
 */
export const EXPORT_FETCH_TIMEOUT_MS = 15000;

/**
 * Fetch ALL of the user's memories for export by paging through the server.
 *
 * - Calls `onProgress(count)` after each page so the UI can show an
 *   inline counter.
 * - Respects an `AbortSignal` so a cancel mid-page stops further fetches
 *   and does not write a partial file.
 * - On network failure, falls back to the AsyncStorage cache used by
 *   `MemoriesContext` (read-only — never mutated) and returns
 *   `usedCache: true`. The caller should note this in the share-sheet
 *   description ("Cached copy — older memories may be missing.").
 *
 * Data-portability rule: never gate by tier.
 * Do NOT log memory contents here — only counts.
 */
export async function fetchAllMemoriesForExport(
  userId: string,
  options: {
    onProgress?: (count: number) => void;
    signal?: AbortSignal;
    /**
     * Per-page network timeout in ms. Defaults to
     * `EXPORT_FETCH_TIMEOUT_MS`. A fired timeout aborts only the
     * in-flight page fetch — it does NOT cancel the overall export.
     * The aborted fetch surfaces to authFetch as a network failure
     * (AuthError with no `status`), which the catch below already
     * treats as the offline path: the cached AsyncStorage copy is
     * returned with `usedCache: true` so the caller re-pops the
     * cached-copy prompt instead of hanging forever on a captive
     * portal that accepts the TCP handshake but never returns data.
     */
    timeoutMs?: number;
  } = {},
): Promise<{ memories: Memory[]; usedCache: boolean }> {
  const { onProgress, signal, timeoutMs = EXPORT_FETCH_TIMEOUT_MS } = options;
  const accumulated: Memory[] = [];
  let page = 1;

  try {
    while (true) {
      if (signal?.aborted) {
        const abortErr = new Error("Export cancelled");
        abortErr.name = "AbortError";
        throw abortErr;
      }

      // Per-page abort controller is fired by EITHER the timeout OR
      // the user's cancel signal, so a Cancel during an in-flight
      // fetch unblocks immediately instead of waiting up to
      // `timeoutMs` for the next top-of-loop guard. Both causes route
      // through `pageController.abort()` → `fetch()` rejects →
      // `authFetch` rewraps it as an `AuthError(no status)`. The
      // catch-by-cause below re-throws AbortError on user cancel
      // (so the outer catch propagates and the caller treats it as
      // a user-initiated cancel, NOT a network failure) and lets a
      // pure-timeout failure fall through to the existing offline
      // cache fallback path so the caller re-pops the cached-copy
      // prompt.
      const pageController = new AbortController();
      const timeoutId =
        timeoutMs > 0
          ? setTimeout(() => pageController.abort(), timeoutMs)
          : null;
      const onUserAbort = () => pageController.abort();
      if (signal) {
        // The top-of-loop guard already handles "already aborted"
        // before we get here, but addEventListener is a no-op if the
        // signal fires synchronously inside this branch.
        signal.addEventListener("abort", onUserAbort);
      }
      let batch: Memory[];
      try {
        batch = await apiListMemories(
          userId,
          page,
          EXPORT_PAGE_SIZE,
          pageController.signal,
        );
      } catch (err) {
        // Distinguish "user pressed Cancel" from "timeout fired" by
        // checking the user's signal directly. Without this, both
        // causes would be wrapped as AuthError(no status) by
        // authFetch and the outer catch would silently downgrade a
        // user cancel into an offline-cache export — wrong, because
        // the user explicitly opted out.
        if (signal?.aborted) {
          const abortErr = new Error("Export cancelled");
          abortErr.name = "AbortError";
          throw abortErr;
        }
        throw err;
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onUserAbort);
      }
      accumulated.push(...batch);
      onProgress?.(accumulated.length);

      if (batch.length < EXPORT_PAGE_SIZE) break;
      page += 1;
    }
    // Annotations (`person`, `linkedEventId`) live in our local
    // api-server, not on Polsia. Merge them in here so the export
    // contains the same `person` field the user sees in the UI.
    // `apiFetchAnnotations` already swallows network/HTTP failures
    // and returns `{}` so a partial outage still produces a usable
    // export (just without the annotation-only fields).
    const annotations = await apiFetchAnnotations(userId);
    return {
      memories: mergeAnnotations(accumulated, annotations),
      usedCache: false,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;

    // authFetch wraps fetch() failures (offline, DNS, timeout) as AuthError
    // with no `status`. HTTP errors from the server carry a numeric status.
    // We fall back to cache only for connectivity failures — not for 401/403/5xx
    // responses, which indicate an issue the user or server should resolve.
    const isNetworkFailure =
      (err instanceof AuthError && err.status === undefined) ||
      err instanceof TypeError;

    if (!isNetworkFailure) throw err;

    let cached: Memory[] = [];
    try {
      const raw = await AsyncStorage.getItem(`memories_${userId}`);
      if (raw) {
        cached = (JSON.parse(raw) as Memory[]).map((m) => ({ ...m, kind: m.kind || "memory" }));
      }
    } catch {
      // Malformed cache — return an empty export rather than hard-failing.
    }
    // Cached memories were written by `MemoriesContext` which already
    // merged annotations before persisting, so `person` is present
    // without an extra fetch. Skipping the network here keeps the
    // offline path strictly offline.
    return { memories: cached, usedCache: true };
  }
}
