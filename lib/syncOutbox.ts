import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Memory sync outbox — bulletproofs the device→Polsia memory pipeline.
 *
 * # Why this exists
 * The pre-Task-#66 architecture flipped `pendingSync: true` on a Memory
 * row whenever `apiCreateMemory` / `apiUpdateMemory` / `apiDeleteMemory`
 * threw, then waited for the user to manually pull-to-refresh before
 * trying again. That left several documented failure modes:
 *
 *   1. A failed create never replays automatically. It only retries when
 *      the user happens to trigger `refreshMemories()` — possibly hours
 *      or days later.
 *   2. Updates and deletes share the same opaque `pendingSync` flag, so
 *      a stale server fetch can silently overwrite a queued update.
 *   3. Two devices on the same account can race on the same `client_id`.
 *      The loser's mutation gets swallowed silently because
 *      `apiCreateMemory` returns 409 and the catch branch just logs.
 *   4. The user has no UI signal whether their last capture made it to
 *      the server. No "syncing / synced / failed" affordance anywhere.
 *
 * This outbox is the single source of truth for "what mutations does the
 * device still owe the server". Adds, edits, and deletes all enqueue
 * here in the same transaction that updates the in-memory list. A
 * background drain (AppState foreground + heartbeat interval) replays
 * the queue with exponential backoff capped at ~5 minutes. After 24h of
 * failure on a single entry the Archive tab surfaces a one-time
 * dismissible warning so the user can intervene before data is silently
 * lost.
 *
 * # Pure module
 * Everything in this file is intentionally pure — no React, no fetch,
 * no AsyncStorage in the core helpers (those live in clearly-named
 * `read*`/`write*` functions at the bottom). The drain entry point
 * accepts an injected API contract so tests can run without a network.
 *
 * # Drain triggers
 * `useSyncOutbox` wires the drain to AppState foreground, a 30s
 * heartbeat, and a NetInfo offline → online transition.
 *
 * # Annotations (person, linkedEventId)
 * Polsia does NOT persist `person` or `linkedEventId` server-side
 * (verified Apr 28, 2026 — see `lib/memories.ts` docblock). To survive
 * reinstall and new-device login the local api-server mirrors them via
 * `/api/memories/annotations`. The outbox carries an `"annotate"`
 * action whose payload is the full `{ client_id, person, linkedEventId }`
 * record; the drain calls `apis.annotate` (typically a PUT). The
 * AsyncStorage `memoryAnnotations_<email>` map remains the offline-
 * read source so a cold start without a network still renders edited
 * person/event values, and the merged value is reconciled against the
 * server pull on every `loadMemories`.
 *
 * # 24h surface rule
 * `shouldSurfaceWarning` returns true when an entry has been in the
 * outbox for ≥24h AND has failed at least once. The Archive banner
 * polls outbox state on render and surfaces the count. We do not auto-
 * delete failed entries — a user-initiated retry tap or a successful
 * drain are the only ways to clear them.
 *
 * # Duplicate client_id collapse
 * `apiCreateMemory` returns HTTP 409 (or includes `code:
 * "DUPLICATE_CLIENT_ID"` in the body) when another device on the same
 * account already created a memory with the same `client_id`. The
 * drain treats that as success — the server row is authoritative, the
 * local pending entry is dropped, and the UI reconciles to the server
 * shape on the next `refreshMemories()`.
 */

export type OutboxAction = "create" | "update" | "delete" | "annotate";

export interface OutboxCreatePayload {
  client_id: string;
  content: string;
  kind: "memory" | "call";
  tags?: string[];
}

export interface OutboxUpdatePayload {
  client_id: string;
  content?: string;
  kind?: "memory" | "call";
  tags?: string[];
}

export interface OutboxDeletePayload {
  client_id: string;
}

/** Annotation payload: mirrors `person` / `linkedEventId` to the
 *  api-server keyed by `client_id`. Both fields can be null to clear
 *  the value. */
export interface OutboxAnnotatePayload {
  client_id: string;
  person?: string | null;
  linkedEventId?: string | null;
}

export type OutboxPayload =
  | OutboxCreatePayload
  | OutboxUpdatePayload
  | OutboxDeletePayload
  | OutboxAnnotatePayload;

export interface OutboxEntry {
  /** Stable key for the entry — always equals the memory's `client_id`. */
  id: string;
  action: OutboxAction;
  payload: OutboxPayload;
  attempts: number;
  /** ISO timestamp of when the entry first entered the outbox. Used by
   *  `shouldSurfaceWarning` to gate the 24h banner. */
  first_queued_at: string;
  /** ISO timestamp of the most recent attempt (success or failure). */
  last_attempt_at?: string;
  /** ISO timestamp of the most recent failure. */
  last_error_at?: string;
  /** Short error class string ("network" | "http" | "duplicate" | "unknown"). */
  last_error?: string;
}

/** Maximum gap between retry attempts. Prevents a permanently failing
 *  entry from monopolizing a tight retry loop on long-lived sessions. */
export const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes
/** Initial backoff used after the first failed attempt. */
export const BASE_BACKOFF_MS = 5 * 1000; // 5 seconds
/** Surface threshold for the "stuck for too long" banner. */
export const SURFACE_WARNING_AFTER_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Pure exponential backoff: 5s, 10s, 20s, 40s, 80s, 160s, capped at
 * MAX_BACKOFF_MS. Returns the delay in ms that should elapse between
 * the entry's `last_attempt_at` and the next retry.
 *
 * `attempts` is the count of failures already recorded — so on the
 * first failure (`attempts === 1`) we wait BASE_BACKOFF_MS, on the
 * second failure (`attempts === 2`) we wait 2 * BASE_BACKOFF_MS, etc.
 */
export function backoffMsForAttempts(attempts: number): number {
  if (attempts <= 0) return 0;
  const exp = BASE_BACKOFF_MS * Math.pow(2, attempts - 1);
  return Math.min(exp, MAX_BACKOFF_MS);
}

/**
 * Decide whether a given outbox entry is due to retry right now.
 * - A brand-new entry (`attempts === 0`) is always due.
 * - An entry that has failed N times is due when (now -
 *   last_attempt_at) ≥ backoffMsForAttempts(N).
 */
export function isEntryDue(entry: OutboxEntry, now: number = Date.now()): boolean {
  if (entry.attempts === 0) return true;
  const last = entry.last_attempt_at
    ? new Date(entry.last_attempt_at).getTime()
    : 0;
  if (Number.isNaN(last)) return true;
  return now - last >= backoffMsForAttempts(entry.attempts);
}

/**
 * The 24h "stuck" banner rule. We require both:
 *   - the entry has been in the outbox for ≥24h (first_queued_at), and
 *   - it has failed at least once (otherwise a brand-new entry that
 *     hasn't even been attempted yet would never trigger this).
 */
export function shouldSurfaceWarning(
  entry: OutboxEntry,
  now: number = Date.now(),
): boolean {
  if (entry.attempts === 0) return false;
  const queued = new Date(entry.first_queued_at).getTime();
  if (Number.isNaN(queued)) return false;
  return now - queued >= SURFACE_WARNING_AFTER_MS;
}

/**
 * Add or replace an entry in the outbox.
 *
 * Collapse rules — keep the queue minimal so a flapping screen doesn't
 * fan out into a wave of redundant POSTs:
 *
 *   - update on top of pending create  → keep the create (with merged
 *     payload). The server has never seen the row; one create with
 *     the latest content is correct.
 *   - delete on top of pending create  → drop the create entirely.
 *     The server never received it, so we don't need to send a delete
 *     either.
 *   - update on top of pending update  → replace with the new update.
 *     Server only needs the latest snapshot.
 *   - delete on top of pending update  → replace with the delete.
 *   - create after a delete            → unusual but possible if a
 *     user undoes; the create wins, the delete is dropped.
 */
export function enqueueEntry(
  list: OutboxEntry[],
  next: Omit<OutboxEntry, "attempts" | "first_queued_at"> & {
    first_queued_at?: string;
  },
): OutboxEntry[] {
  const existing = list.find((e) => e.id === next.id);
  const without = list.filter((e) => e.id !== next.id);
  const baseTimestamp = next.first_queued_at ?? new Date().toISOString();

  if (!existing) {
    return [
      ...without,
      {
        id: next.id,
        action: next.action,
        payload: next.payload,
        attempts: 0,
        first_queued_at: baseTimestamp,
      },
    ];
  }

  // Collapse rules
  if (existing.action === "create" && next.action === "update") {
    const mergedPayload = {
      ...(existing.payload as OutboxCreatePayload),
      ...(next.payload as OutboxUpdatePayload),
    };
    return [
      ...without,
      {
        ...existing,
        payload: mergedPayload as OutboxPayload,
      },
    ];
  }

  if (existing.action === "create" && next.action === "delete") {
    // Server never saw it; drop the create AND the delete.
    return without;
  }

  // update→update, update→delete, delete→create, etc. → newer wins,
  // attempts reset because the operation kind changed.
  return [
    ...without,
    {
      id: next.id,
      action: next.action,
      payload: next.payload,
      attempts: 0,
      first_queued_at: existing.first_queued_at,
    },
  ];
}

/** Remove an entry by id. */
export function removeEntry(list: OutboxEntry[], id: string): OutboxEntry[] {
  return list.filter((e) => e.id !== id);
}

/**
 * Bump the `attempts` counter and stamp the failure timestamp/class.
 * Returns a new list with the patched entry. If no entry exists for
 * the id (race with a concurrent remove), the list is returned
 * unchanged.
 */
export function markFailure(
  list: OutboxEntry[],
  id: string,
  errorClass: string,
  now: Date = new Date(),
): OutboxEntry[] {
  const iso = now.toISOString();
  return list.map((e) =>
    e.id === id
      ? {
          ...e,
          attempts: e.attempts + 1,
          last_attempt_at: iso,
          last_error_at: iso,
          last_error: errorClass,
        }
      : e,
  );
}

export type DrainOutcome =
  | { kind: "success"; id: string; serverId?: string }
  | { kind: "duplicate"; id: string }
  | { kind: "failure"; id: string; errorClass: string };

export interface DrainApi {
  create: (
    payload: OutboxCreatePayload,
  ) => Promise<{ ok: true; server_id?: string }>;
  update: (
    payload: OutboxUpdatePayload,
  ) => Promise<{ ok: true; server_id?: string }>;
  delete: (
    payload: OutboxDeletePayload,
  ) => Promise<{ ok: true; server_id?: string }>;
  annotate: (
    payload: OutboxAnnotatePayload,
  ) => Promise<{ ok: true }>;
}

/** Outbox id namespace prefix for `annotate` entries. Annotations live
 *  in their own keyspace so they never collide with create/update/delete
 *  entries for the same memory client_id. */
export const ANNOTATE_ID_PREFIX = "ann:";

export function annotateOutboxId(clientId: string): string {
  return `${ANNOTATE_ID_PREFIX}${clientId}`;
}

/** Summarize a drain pass into memory-only synced/failed counts for
 *  the Archive's "Sync all" toast. Annotation entries (`ann:` keyspace)
 *  are excluded so a single offline edit that produces both a memory
 *  mutation and an annotation outbox entry doesn't double-count
 *  toward "N memories synced". `success` and `duplicate` collapse
 *  into `synced` because both clear the pending row from the user's
 *  perspective. */
export function summarizeMemoryDrainOutcomes(
  outcomes: readonly DrainOutcome[],
): { synced: number; failed: number } {
  let synced = 0;
  let failed = 0;
  for (const o of outcomes) {
    if (o.id.startsWith(ANNOTATE_ID_PREFIX)) continue;
    if (o.kind === "success" || o.kind === "duplicate") synced += 1;
    else if (o.kind === "failure") failed += 1;
  }
  return { synced, failed };
}

/**
 * Detect the duplicate-client_id condition from a thrown error. We
 * accept a few shapes so the rule is robust to small Polsia changes:
 *   - HTTP 409 → always treated as duplicate
 *   - body.code === "DUPLICATE_CLIENT_ID" or "ALREADY_EXISTS"
 *   - body.error / body.message contains "already exists"
 */
export function isDuplicateError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; body?: unknown; message?: unknown };
  if (e.status === 409) return true;
  const body = e.body;
  if (body && typeof body === "object") {
    const code = (body as { code?: unknown }).code;
    if (code === "DUPLICATE_CLIENT_ID" || code === "ALREADY_EXISTS") {
      return true;
    }
    const message =
      (body as { error?: unknown }).error ??
      (body as { message?: unknown }).message;
    if (typeof message === "string" && /already exists/i.test(message)) {
      return true;
    }
  }
  if (typeof e.message === "string" && /already exists/i.test(e.message)) {
    return true;
  }
  return false;
}

/** Map any thrown value to a short, log-safe error class string. */
export function classifyError(err: unknown): string {
  if (isDuplicateError(err)) return "duplicate";
  if (!err || typeof err !== "object") return "unknown";
  const e = err as { status?: unknown; name?: unknown };
  // Server-side daily-capture cap (HTTP 402). The local UI already
  // gates on this; if the server still rejects (multi-device race),
  // the entry is non-retryable so the drain drops it like a duplicate.
  if (e.name === "CaptureLimitReachedError") return "cap";
  if (typeof e.status === "number" && e.status === 402) return "cap";
  // Auto-block (HTTP 429 + CAPTURE_BLOCKED_ABUSE): the api-server
  // refused this account for the rest of the UTC day after
  // detecting cap-bypass abuse. Distinct class from "cap" so
  // MemoriesContext can throw the dedicated CaptureBlockedError
  // (no upsell — show a cooldown alert) instead of conflating it
  // with the regular "you've used your 10 captures today" upsell.
  // Drain loop treats this as non-retryable just like "cap"
  // (drops the entry instead of marking failure with backoff) so
  // the outbox doesn't thrash the server until UTC midnight.
  if (e.name === "CaptureBlockedError") return "blocked";
  if (typeof e.status === "number") return `http_${e.status}`;
  return "network";
}

/**
 * Walk the outbox once, retrying every entry that is due. Returns the
 * updated outbox list plus a per-entry outcome stream so the caller
 * can patch its in-memory `memories` array (e.g. set serverId on a
 * successful create, drop the local pending duplicate on 409).
 *
 * Pure with respect to React/AsyncStorage — `apis.create/update/delete`
 * are the only side effects. Entries are processed sequentially so a
 * burst of 50 queued mutations doesn't fan out into 50 concurrent
 * POSTs (Polsia would rate-limit and we'd just thrash retries).
 */
export async function drainOutbox(args: {
  list: OutboxEntry[];
  apis: DrainApi;
  now?: Date;
  /** Ids to drain unconditionally, even if their backoff window
   *  hasn't elapsed yet. Used by user-initiated per-row retries
   *  (Archive tap-to-retry on the offline badge) so the user gets
   *  immediate feedback instead of waiting up to 5 minutes for the
   *  backoff to expire. Entries not in the list are still gated by
   *  the normal `isEntryDue` check. */
  forceIds?: ReadonlySet<string>;
}): Promise<{ list: OutboxEntry[]; outcomes: DrainOutcome[] }> {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  let working = args.list;
  const outcomes: DrainOutcome[] = [];
  const forceIds = args.forceIds;

  // Snapshot the ids upfront so concurrent enqueues during the drain
  // don't get stepped on by a stale `working` reference.
  const dueIds = working
    .filter((e) => (forceIds?.has(e.id) ?? false) || isEntryDue(e, nowMs))
    .map((e) => e.id);

  for (const id of dueIds) {
    const entry = working.find((e) => e.id === id);
    if (!entry) continue; // collapsed mid-drain

    try {
      let serverId: string | undefined;
      if (entry.action === "create") {
        const res = await args.apis.create(entry.payload as OutboxCreatePayload);
        serverId = res.server_id;
      } else if (entry.action === "update") {
        const res = await args.apis.update(entry.payload as OutboxUpdatePayload);
        serverId = res.server_id;
      } else if (entry.action === "delete") {
        await args.apis.delete(entry.payload as OutboxDeletePayload);
      } else {
        // annotate
        await args.apis.annotate(entry.payload as OutboxAnnotatePayload);
      }
      working = removeEntry(working, id);
      outcomes.push({ kind: "success", id, serverId });
    } catch (err) {
      if (isDuplicateError(err)) {
        // Two-device collision. Server already has this client_id —
        // accept it as success and let the next refreshMemories pull
        // the canonical row.
        working = removeEntry(working, id);
        outcomes.push({ kind: "duplicate", id });
        continue;
      }
      const errorClass = classifyError(err);
      if (errorClass === "cap" || errorClass === "blocked") {
        // Non-retryable server-side rejections — drop the entry so
        // the outbox doesn't thrash forever. The caller observes
        // the failure outcome (with the original errorClass) and
        // rolls back its optimistic UI write. Both branches share
        // the same drain treatment but the distinct class string
        // lets the caller decide between an upsell ("cap") and a
        // cooldown alert ("blocked").
        working = removeEntry(working, id);
      } else {
        working = markFailure(working, id, errorClass, now);
      }
      outcomes.push({ kind: "failure", id, errorClass });
    }
  }

  return { list: working, outcomes };
}

// ---------------------------------------------------------------------
// AsyncStorage helpers (kept at the bottom so the pure core above is
// trivially testable without mocking storage).
// ---------------------------------------------------------------------

const outboxKey = (email: string) => `syncOutbox_${email}`;

export async function readOutbox(email: string): Promise<OutboxEntry[]> {
  if (!email) return [];
  try {
    const raw = await AsyncStorage.getItem(outboxKey(email));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OutboxEntry[];
    if (!Array.isArray(parsed)) return [];
    // Defensive: filter out anything obviously malformed so a corrupt
    // entry can't poison the whole drain loop forever.
    return parsed.filter(
      (e) =>
        e &&
        typeof e === "object" &&
        typeof e.id === "string" &&
        (e.action === "create" ||
          e.action === "update" ||
          e.action === "delete" ||
          e.action === "annotate") &&
        typeof e.first_queued_at === "string",
    );
  } catch {
    return [];
  }
}

export async function writeOutbox(
  email: string,
  list: OutboxEntry[],
): Promise<void> {
  if (!email) return;
  try {
    await AsyncStorage.setItem(outboxKey(email), JSON.stringify(list));
  } catch {
    // ignore — best effort. The next successful write rebuilds it.
  }
}
