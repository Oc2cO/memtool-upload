import { authFetch } from "./auth";

/**
 * Polsia MemTool mood backend contract (verified Apr 28, 2026).
 *
 * Base: https://mem-tool.polsia.app/api/memtool (set in lib/config.ts).
 * Auth: Bearer token from AsyncStorage `mt_token` (handled by authFetch).
 *
 * - GET  /mood
 *     -> { logs: ServerMoodLog[] }
 *     No pagination; returns all of the user's mood entries.
 * - POST /sync/mood
 *     body: { action: "create"|"update"|"delete", payload, timestamp }
 *     create/update payload: { date, rating, stress, note, client_id }
 *     delete payload: { date }
 *     -> { ok: true, server_id?: string }
 *
 * Critical contract notes:
 * - Same { action, payload, timestamp } envelope as /sync/memories.
 * - `date` (YYYY-MM-DD) is REQUIRED on every write — server returns
 *   400 "date is required (YYYY-MM-DD format)" otherwise.
 * - Server upserts on (user_id, date) — re-creating the same date
 *   returns the same server_id. One mood log per calendar day per user.
 *   `create` replaces the row's `client_id` and all fields wholesale.
 * - `update` overwrites with nulls for omitted fields. Always send the
 *   full record (date, rating, stress, note, client_id), never a patch.
 *   For our use case `create` and `update` are functionally equivalent
 *   (both upsert on date), so callers typically just use `apiCreateMood`.
 * - Persisted columns: rating, stress, note, client_id. Other field
 *   names (mood, score, level, value, tags, emoji) are silently dropped.
 * - `delete` may be soft/no-op server-side — GET /mood still returns
 *   rows after a 200 {"ok":true} delete in probes. Treat delete as
 *   best-effort; do not rely on the server to filter.
 * - `client_id` is the canonical client-side key; server stores and
 *   returns it. Date acts as the upsert key on the server.
 * - Server stores `date` as a full ISO datetime ("YYYY-MM-DDT00:00:00.000Z")
 *   but accepts and is keyed by the "YYYY-MM-DD" form. We normalize on read.
 * - There is no /mood/search or /mood/suggest-tags equivalent. /moods
 *   (plural), /mood/logs, POST /mood, PUT /mood/today, /api/memtool/wellness/*,
 *   and /api/mt/wellness all 404 — never call them.
 */

export interface MoodLog {
  date: string; // YYYY-MM-DD (local timezone)
  rating: number; // 0-5 (0 = unset; UI uses 1-5)
  stress?: number; // 1-5
  note?: string;
  client_id: string;
  serverId?: string;
  pendingSync?: boolean;
}

interface ServerMoodLog {
  id: string;
  date: string; // ISO datetime, UTC midnight
  rating: number | null;
  stress: number | null;
  note: string | null;
  client_id: string | null;
  created_at: string;
}

interface ListMoodResponse {
  logs: ServerMoodLog[];
}

interface SyncResponse {
  ok: boolean;
  server_id?: string;
}

export interface MoodWriteInput {
  date: string;
  rating: number;
  stress?: number;
  note?: string;
  client_id: string;
}

export function newClientId(): string {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returns today's date as YYYY-MM-DD in the device's LOCAL timezone.
 * Do not use `new Date().toISOString().slice(0,10)` — for users west of
 * UTC near midnight, that returns tomorrow's UTC date.
 */
export function todayLocalDate(): string {
  return toLocalDate(new Date());
}

function toLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Server returns `date` as an ISO datetime at UTC midnight (e.g.
 * "2026-04-28T00:00:00.000Z"). Strip to YYYY-MM-DD for local use.
 * Falls back to the raw value if it's already a plain date string.
 */
function normalizeServerDate(raw: string): string {
  if (!raw) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Use the date portion of the ISO string (UTC) — server stores the
  // user-supplied YYYY-MM-DD as UTC midnight, so this round-trips.
  return raw.slice(0, 10);
}

function fromServer(s: ServerMoodLog): MoodLog {
  return {
    date: normalizeServerDate(s.date),
    rating: typeof s.rating === "number" ? s.rating : 0,
    stress: typeof s.stress === "number" ? s.stress : undefined,
    note: s.note ?? undefined,
    client_id: s.client_id ?? s.id,
    serverId: s.id,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function apiListMood(): Promise<MoodLog[]> {
  const data = (await authFetch("/mood", { method: "GET" })) as ListMoodResponse;
  const list = Array.isArray(data?.logs) ? data.logs : [];
  return list.map(fromServer);
}

function buildPayload(input: MoodWriteInput): Record<string, unknown> {
  // Always send the full record — server `update` nulls out omitted fields.
  return {
    date: input.date,
    rating: input.rating,
    stress: input.stress ?? null,
    note: input.note ?? null,
    client_id: input.client_id,
  };
}

export async function apiCreateMood(input: MoodWriteInput): Promise<SyncResponse> {
  return (await authFetch("/sync/mood", {
    method: "POST",
    body: JSON.stringify({
      action: "create",
      payload: buildPayload(input),
      timestamp: nowIso(),
    }),
  })) as SyncResponse;
}

export async function apiUpdateMood(input: MoodWriteInput): Promise<SyncResponse> {
  return (await authFetch("/sync/mood", {
    method: "POST",
    body: JSON.stringify({
      action: "update",
      payload: buildPayload(input),
      timestamp: nowIso(),
    }),
  })) as SyncResponse;
}

/**
 * Best-effort delete. Server delete behavior is currently unreliable
 * (returns 200 {"ok":true} but GET /mood still returns the row).
 * Callers should remove from local state immediately and not depend on
 * the server to filter.
 */
export async function apiDeleteMood(date: string): Promise<SyncResponse> {
  return (await authFetch("/sync/mood", {
    method: "POST",
    body: JSON.stringify({
      action: "delete",
      payload: { date },
      timestamp: nowIso(),
    }),
  })) as SyncResponse;
}
