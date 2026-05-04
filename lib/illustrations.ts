// AI illustration client — talks to the local api-server's
// `/api/memories/illustrations` and `/api/memories/:id/illustrate`
// endpoints. Same shape as `lib/annotations.ts`: raw fetch with the
// Polsia bearer token in the Authorization header (the api-server
// verifies it against Polsia rather than trusting client-claimed
// userIds), plus the device-local day key so the server's quota
// bucket lines up with the user's wall-clock day.

import { getToken } from "./auth";
import { getLocalDayKey } from "./captureLimits";
import { resolveReplitApiBase } from "./config";

const FETCH_TIMEOUT_MS = 8_000;
// gpt-image-1 takes ~6-15s to return; give it generous headroom so a
// healthy slow-LTE round-trip doesn't surface as a spurious failure.
// The mobile UI stays in its painting-loader state for the whole
// window so the user has clear "still working" feedback.
const GENERATE_TIMEOUT_MS = 60_000;

function bulkEndpoint(): string {
  return `${resolveReplitApiBase()}/api/memories/illustrations`;
}

function generateEndpoint(clientId: string): string {
  return `${resolveReplitApiBase()}/api/memories/${encodeURIComponent(
    clientId,
  )}/illustrate`;
}

/**
 * Resolve a server-relative illustration URL (e.g.
 * `/api/illustrations/<digest>/<file>.png`) to an absolute URL the
 * mobile `<Image>` can fetch. The server returns relative paths so
 * the same record works in dev/staging/prod without re-storing.
 */
export function absoluteIllustrationUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = resolveReplitApiBase();
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
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

interface ServerIllustration {
  url: string;
  // Small (256x256) variant for Archive scrolling. Optional because
  // older server versions and pre-thumbnail records don't include
  // it; the client falls back to the full-resolution `url` then.
  thumb_url?: string;
  prompt: string;
  generated_at: string;
}

interface BulkResponse {
  items: Record<string, ServerIllustration>;
  usedToday: number;
  limit: number;
}

export interface IllustrationMapEntry {
  url: string;
  // Pre-resolved absolute URL of the smaller thumbnail variant. The
  // Archive renders this in the polaroid; the lightbox still uses
  // the full-resolution `url`. Optional only for legacy server
  // responses that don't include it — those fall back to `url` so
  // the UI never goes blank.
  thumbUrl?: string;
  generatedAt: string;
}

export type IllustrationMap = Record<string, IllustrationMapEntry>;

export interface IllustrationFetchResult {
  items: IllustrationMap;
  usedToday: number;
  limit: number;
}

/**
 * Bulk pull. Returns an empty map on any failure so a cold-start
 * with no network still renders memories.
 */
export async function apiFetchIllustrations(): Promise<IllustrationFetchResult> {
  const token = await getToken();
  if (!token) {
    return { items: {}, usedToday: 0, limit: 1 };
  }
  try {
    const res = await fetchWithTimeout(
      `${bulkEndpoint()}?localDay=${encodeURIComponent(getLocalDayKey())}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return { items: {}, usedToday: 0, limit: 1 };
    const body = (await res.json()) as BulkResponse;
    const out: IllustrationMap = {};
    for (const [id, ill] of Object.entries(body.items ?? {})) {
      if (typeof ill?.url === "string" && ill.url.length > 0) {
        out[id] = {
          url: absoluteIllustrationUrl(ill.url),
          thumbUrl:
            typeof ill.thumb_url === "string" && ill.thumb_url.length > 0
              ? absoluteIllustrationUrl(ill.thumb_url)
              : undefined,
          generatedAt:
            typeof ill.generated_at === "string" ? ill.generated_at : "",
        };
      }
    }
    return {
      items: out,
      usedToday: typeof body.usedToday === "number" ? body.usedToday : 0,
      limit: typeof body.limit === "number" ? body.limit : 1,
    };
  } catch {
    return { items: {}, usedToday: 0, limit: 1 };
  }
}

export interface IllustrateInput {
  clientId: string;
  content: string;
  tags?: string[];
  person?: string;
}

export interface IllustrateSuccess {
  kind: "ok";
  url: string;
  thumbUrl?: string;
  generatedAt: string;
  isPro: boolean;
  usedToday: number;
  limit: number | null;
}

export interface IllustrateLimit {
  kind: "limit";
  limit: number;
  used: number;
}

export interface IllustrateAuthError {
  kind: "auth_error";
}

export interface IllustrateServerError {
  kind: "server_error";
  message: string;
}

export type IllustrateResult =
  | IllustrateSuccess
  | IllustrateLimit
  | IllustrateAuthError
  | IllustrateServerError;

/**
 * Trigger generation for a single memory. Returns a discriminated
 * result so the caller can render the right UI without parsing
 * error messages (e.g. paywall on `kind: "limit"`).
 *
 * The server is the source of truth on whether a free user has
 * slots left — we never short-circuit on the client because a
 * stale `usedToday` could lock out a user who actually has a
 * fresh day.
 */
export async function apiIllustrateMemory(
  input: IllustrateInput,
): Promise<IllustrateResult> {
  const token = await getToken();
  if (!token) return { kind: "auth_error" };

  const body = {
    content: input.content,
    tags: input.tags,
    person: input.person,
    localDay: getLocalDayKey(),
  };

  let res: Response;
  try {
    res = await fetchWithTimeout(
      generateEndpoint(input.clientId),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      },
      GENERATE_TIMEOUT_MS,
    );
  } catch (err) {
    return {
      kind: "server_error",
      message: err instanceof Error ? err.message : "Network error",
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { kind: "auth_error" };
  }
  if (res.status === 402) {
    let limit = 1;
    let used = 1;
    try {
      const j = (await res.json()) as { limit?: number; used?: number };
      if (typeof j.limit === "number") limit = j.limit;
      if (typeof j.used === "number") used = j.used;
    } catch {
      /* fall through with defaults */
    }
    return { kind: "limit", limit, used };
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (typeof j.error === "string") msg = j.error;
    } catch {
      /* keep default */
    }
    return { kind: "server_error", message: msg };
  }

  let payload: {
    illustration?: ServerIllustration;
    isPro?: boolean;
    usedToday?: number;
    limit?: number | null;
  };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    return { kind: "server_error", message: "Invalid server response" };
  }

  const ill = payload.illustration;
  if (!ill || typeof ill.url !== "string" || ill.url.length === 0) {
    return { kind: "server_error", message: "No illustration in response" };
  }

  return {
    kind: "ok",
    url: absoluteIllustrationUrl(ill.url),
    thumbUrl:
      typeof ill.thumb_url === "string" && ill.thumb_url.length > 0
        ? absoluteIllustrationUrl(ill.thumb_url)
        : undefined,
    generatedAt:
      typeof ill.generated_at === "string"
        ? ill.generated_at
        : new Date().toISOString(),
    isPro: payload.isPro === true,
    usedToday: typeof payload.usedToday === "number" ? payload.usedToday : 0,
    limit:
      payload.limit === null
        ? null
        : typeof payload.limit === "number"
          ? payload.limit
          : 1,
  };
}

export interface DeleteIllustrationSuccess {
  kind: "ok";
  removed: boolean;
}

export interface DeleteIllustrationAuthError {
  kind: "auth_error";
}

export interface DeleteIllustrationServerError {
  kind: "server_error";
  message: string;
}

export type DeleteIllustrationResult =
  | DeleteIllustrationSuccess
  | DeleteIllustrationAuthError
  | DeleteIllustrationServerError;

/**
 * Discard a memory's illustration on the server (Task #210). Used
 * by the lightbox's "Remove" action. Returns a discriminated result
 * so the caller can render the right UI without parsing error
 * messages.
 *
 * The server is idempotent: a second delete for the same memory
 * still returns `kind: "ok"` with `removed: false`. The mobile
 * caller can ignore that distinction and just clear local state
 * either way.
 */
export async function apiDeleteIllustration(
  clientId: string,
): Promise<DeleteIllustrationResult> {
  const token = await getToken();
  if (!token) return { kind: "auth_error" };

  let res: Response;
  try {
    res = await fetchWithTimeout(
      generateEndpoint(clientId),
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      FETCH_TIMEOUT_MS,
    );
  } catch (err) {
    return {
      kind: "server_error",
      message: err instanceof Error ? err.message : "Network error",
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { kind: "auth_error" };
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (typeof j.error === "string") msg = j.error;
    } catch {
      /* keep default */
    }
    return { kind: "server_error", message: msg };
  }

  let payload: { removed?: boolean } = {};
  try {
    payload = (await res.json()) as { removed?: boolean };
  } catch {
    // Body shape changed but the call succeeded — treat as removed.
  }
  return { kind: "ok", removed: payload.removed === true };
}

/**
 * Merge an illustration map into a list of memories, attaching
 * `illustrationUrl`, `illustrationThumbUrl`, and `illustratedAt`
 * where present. Mirrors `mergeAnnotations` so the consumer pattern
 * is identical.
 */
export function mergeIllustrations<
  M extends {
    id: string;
    illustrationUrl?: string;
    illustrationThumbUrl?: string;
    illustratedAt?: string;
  },
>(memories: M[], map: IllustrationMap): M[] {
  return memories.map((m) => {
    const entry = map[m.id];
    if (!entry) return m;
    return {
      ...m,
      illustrationUrl: entry.url,
      illustrationThumbUrl: entry.thumbUrl ?? m.illustrationThumbUrl,
      illustratedAt: entry.generatedAt || m.illustratedAt,
    };
  });
}
