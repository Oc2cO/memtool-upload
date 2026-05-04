// Memory annotation client — talks to the local api-server's
// `/api/memories/annotations` endpoints. Annotations (`person`,
// `linkedEventId`) are NOT persisted by the upstream Polsia API, so
// we mirror them here keyed by `client_id` to survive reinstall and
// new-device login.
//
// Pattern matches `lib/profile.ts`: raw fetch with `x-mem-user-id`
// header (the generated React Query hooks don't pass that header).

import { resolveReplitApiBase } from "./config";
import type { MemoryAnnotationMap } from "./memories";

const ANNOTATION_TIMEOUT_MS = 8_000;

function bulkEndpoint(): string {
  return `${resolveReplitApiBase()}/api/memories/annotations`;
}

function singleEndpoint(clientId: string): string {
  return `${bulkEndpoint()}/${encodeURIComponent(clientId)}`;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface ServerAnnotation {
  person?: string | null;
  linkedEventId?: string | null;
}

interface BulkResponse {
  items: Record<string, ServerAnnotation>;
}

/**
 * Bulk pull. Returns a `MemoryAnnotationMap` ready to feed into
 * `mergeAnnotations`. Returns an empty map on any HTTP failure so a
 * cold-start with no network still renders memories without crashing.
 */
export async function apiFetchAnnotations(
  userId: string,
): Promise<MemoryAnnotationMap> {
  if (!userId) return {};
  try {
    const res = await fetchWithTimeout(
      bulkEndpoint(),
      { method: "GET", headers: { "x-mem-user-id": userId } },
      ANNOTATION_TIMEOUT_MS,
    );
    if (!res.ok) return {};
    const body = (await res.json()) as BulkResponse;
    const out: MemoryAnnotationMap = {};
    for (const [id, ann] of Object.entries(body.items ?? {})) {
      const entry: { person?: string; linkedEventId?: string } = {};
      if (typeof ann.person === "string" && ann.person.length > 0) {
        entry.person = ann.person;
      }
      if (
        typeof ann.linkedEventId === "string" &&
        ann.linkedEventId.length > 0
      ) {
        entry.linkedEventId = ann.linkedEventId;
      }
      // Only keep rows that contributed at least one field — the bulk
      // map should never include empty envelopes.
      if (entry.person !== undefined || entry.linkedEventId !== undefined) {
        out[id] = entry;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Upsert a single annotation. Returns `{ ok: true }` on 2xx, throws
 * on any other response so the outbox treats it as a retryable
 * failure (and applies backoff).
 */
export async function apiPutAnnotation(
  userId: string,
  clientId: string,
  ann: { person?: string | null; linkedEventId?: string | null },
): Promise<{ ok: true }> {
  if (!userId) throw new Error("apiPutAnnotation: missing userId");
  if (!clientId) throw new Error("apiPutAnnotation: missing clientId");
  const res = await fetchWithTimeout(
    singleEndpoint(clientId),
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-mem-user-id": userId,
      },
      body: JSON.stringify({
        person: ann.person ?? null,
        linkedEventId: ann.linkedEventId ?? null,
      }),
    },
    ANNOTATION_TIMEOUT_MS,
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `PUT /api/memories/annotations/${clientId} HTTP ${res.status}: ${txt.slice(0, 200)}`,
    );
  }
  return { ok: true };
}

/**
 * Idempotent delete. The server returns ok regardless of prior state.
 */
export async function apiDeleteAnnotation(
  userId: string,
  clientId: string,
): Promise<{ ok: true }> {
  if (!userId) throw new Error("apiDeleteAnnotation: missing userId");
  if (!clientId) throw new Error("apiDeleteAnnotation: missing clientId");
  const res = await fetchWithTimeout(
    singleEndpoint(clientId),
    { method: "DELETE", headers: { "x-mem-user-id": userId } },
    ANNOTATION_TIMEOUT_MS,
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `DELETE /api/memories/annotations/${clientId} HTTP ${res.status}: ${txt.slice(0, 200)}`,
    );
  }
  return { ok: true };
}
