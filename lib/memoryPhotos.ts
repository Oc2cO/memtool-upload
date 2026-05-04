// User-uploaded memory photos client (Tasks #372, #385). Talks to
// the local api-server's `/api/memories/:clientId/photo*` endpoints
// and owns the offline-survival upload queue keyed per email.
//
// Task #385 lifts the cap from one photo per memory to a small
// album of up to MAX_PHOTOS_PER_MEMORY (4). Each queued upload
// gets its own client-minted `photoId` so:
//   - The same memory can have multiple uploads in flight at once.
//   - A retried PATCH-confirm dedupes server-side via the composite
//     `(user_id, client_id, photo_id)` PK, so a flaky network can't
//     blow the per-memory cap by re-running the confirm.
//
// Flow on Save Memory with photos attached:
//   1. addMemory returns a `client_id` (the photos are keyed by it).
//   2. Caller calls `enqueuePhotoUpload(email, { clientId, localUri,
//      takenAt? })` once per photo. Each entry mints its own
//      `photoId` and is persisted to AsyncStorage so a cold start
//      later still owes the upload.
//   3. `drainPhotoQueue(email)` reads the queue, for each entry:
//        - POST /photo/upload-url → { uploadURL, objectPath }
//        - PUT  uploadURL <bytes>
//        - PATCH /photo { photo_id, photo_path: objectPath, taken_at }
//      Successful entries drop out of the queue and surface as a
//      `PhotoMapEntry` so the UI can patch the in-memory memory.
//      Transient failures stay in the queue with bumped attempts +
//      `lastError` for the next drain (foreground / heartbeat /
//      manual). Permanent failures (404, 413, 415, 409 cap) are
//      dropped — no retry would ever succeed.
//
// Kept deliberately separate from `lib/syncOutbox.ts` so a photo
// upload failure can never block the text mutation outbox (the
// memory itself must always survive even if the photo doesn't).

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImageManipulator from "expo-image-manipulator";
import { getToken } from "./auth";
import { resolveReplitApiBase } from "./config";

// Privacy: photos picked from the camera roll often carry GPS EXIF
// tags (Task #387). Uploading the asset bytes as-is would mean the
// public object URL leaks the user's home address. Re-encode to a
// fresh JPEG via expo-image-manipulator before upload — the
// manipulator does not copy EXIF onto the output, so GPS, camera
// model, and serial number are all dropped. We keep `takenAt`
// separately on the upload record (extracted from EXIF in the
// picker) so the memory still knows when the photo was taken.
//
// Returns the sanitized local URI + canonical JPEG mime type. On any
// failure (decode error, manipulator unavailable) we throw so the
// caller can surface the issue rather than silently uploading the
// original geotagged bytes.
export async function stripPhotoMetadata(
  localUri: string,
): Promise<{ uri: string; mimeType: string }> {
  const result = await ImageManipulator.manipulateAsync(
    localUri,
    [],
    {
      compress: 0.85,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );
  return { uri: result.uri, mimeType: "image/jpeg" };
}

const PHOTO_FETCH_TIMEOUT_MS = 8_000;
const PHOTO_PUT_TIMEOUT_MS = 60_000; // photo bytes can be megabytes on cellular

/**
 * Per-memory photo cap (Task #385). Mirrors the server-side
 * `MAX_PHOTOS_PER_MEMORY` constant in `userStore.ts`. Surfaced here
 * so the capture UI can disable the "Add another" affordance
 * before the user tries to enqueue a 5th and gets a 409 back.
 */
export const MAX_PHOTOS_PER_MEMORY = 4;

function apiBase(): string {
  return resolveReplitApiBase().replace(/\/+$/, "");
}

function bulkEndpoint(): string {
  return `${apiBase()}/api/memories/photos`;
}
function uploadUrlEndpoint(clientId: string): string {
  return `${apiBase()}/api/memories/${encodeURIComponent(clientId)}/photo/upload-url`;
}
function confirmEndpoint(clientId: string): string {
  return `${apiBase()}/api/memories/${encodeURIComponent(clientId)}/photo`;
}

/**
 * Resolve a server-relative object path (`/objects/uploads/<id>`)
 * to an absolute URL the mobile `<Image>` can fetch. The server
 * stores relative paths so the same record works in
 * dev/staging/prod without re-storing.
 */
export function absolutePhotoUrl(objectPath: string): string {
  if (/^https?:\/\//i.test(objectPath)) return objectPath;
  return `${apiBase()}/api/storage${objectPath.startsWith("/") ? "" : "/"}${objectPath}`;
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

// Random-id minter that doesn't depend on `crypto.randomUUID`
// (RN/Hermes still ships it patchily). Used for client-minted
// photo ids that the server PATCH dedupes on.
function newPhotoId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `p_${Date.now().toString(36)}_${rand}`;
}

// ---- Bulk read --------------------------------------------------------------

interface ServerPhoto {
  photo_id?: string;
  photo_path: string;
  thumb_path: string | null;
  taken_at: string | null;
  position?: number;
  updated_at?: string;
}

interface BulkResponse {
  // Task #385: one memory can hold multiple photos, so the bulk
  // payload is now a list per `client_id`. Older clients that
  // expected a single `ServerPhoto` per id are gone — every install
  // running this build also runs the multi-photo confirm path.
  items: Record<string, ServerPhoto[]>;
}

export interface PhotoMapEntry {
  url: string;
  thumbUrl?: string;
  takenAt?: string;
  /** Stable server-side photo id. Used by the per-photo delete
   *  endpoint and to match an optimistic queued thumb against the
   *  confirmed row when both are visible briefly. */
  photoId?: string;
}

/**
 * Bulk-shape map: each clientId maps to its full ordered photo
 * album (0…MAX_PHOTOS_PER_MEMORY entries). An empty array is
 * permitted but should be treated identically to "no key" by
 * consumers.
 */
export type PhotoMap = Record<string, PhotoMapEntry[]>;

function entryFromServer(p: ServerPhoto): PhotoMapEntry {
  const url = absolutePhotoUrl(p.photo_path);
  const thumbUrl =
    p.thumb_path && p.thumb_path.length > 0
      ? absolutePhotoUrl(p.thumb_path)
      : url;
  const out: PhotoMapEntry = { url, thumbUrl };
  if (p.taken_at) out.takenAt = p.taken_at;
  if (p.photo_id) out.photoId = p.photo_id;
  return out;
}

/**
 * Bulk pull. Returns an empty map on any failure so a cold-start
 * with no network still renders memories.
 */
export async function apiFetchPhotos(): Promise<PhotoMap> {
  const token = await getToken();
  if (!token) return {};
  try {
    const res = await fetchWithTimeout(
      bulkEndpoint(),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      PHOTO_FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return {};
    const body = (await res.json()) as BulkResponse;
    const out: PhotoMap = {};
    for (const [id, list] of Object.entries(body.items ?? {})) {
      if (!Array.isArray(list)) continue;
      const entries: PhotoMapEntry[] = [];
      for (const p of list) {
        if (p && typeof p.photo_path === "string") {
          entries.push(entryFromServer(p));
        }
      }
      if (entries.length > 0) out[id] = entries;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Merge a photo map into a list of memories. Sets the new `photos`
 * array so multi-photo-aware UIs can render the full album, and
 * mirrors the first photo onto the legacy `photoUrl` /
 * `photoThumbUrl` / `photoTakenAt` fields so older surfaces (the
 * Recap photo strip) keep working untouched. Mirrors
 * `mergeIllustrations`. The in-memory `photoPendingUpload` flag is
 * cleared when the server has confirmed at least one photo for the
 * memory; the queue may still hold sibling uploads, in which case
 * the caller re-asserts the flag from `listPendingPhotoIds`.
 */
export function mergePhotos<
  M extends {
    id: string;
    photoUrl?: string;
    photoThumbUrl?: string;
    photoTakenAt?: string;
    photoPendingUpload?: boolean;
    photos?: PhotoMapEntry[];
  },
>(memories: M[], map: PhotoMap): M[] {
  return memories.map((m) => {
    const list = map[m.id];
    if (!list || list.length === 0) return m;
    const first = list[0]!;
    return {
      ...m,
      photos: list,
      photoUrl: first.url,
      photoThumbUrl: first.thumbUrl ?? m.photoThumbUrl ?? first.url,
      photoTakenAt: first.takenAt ?? m.photoTakenAt,
      photoPendingUpload: false,
    };
  });
}

// ---- Single-shot upload (used by drain) ------------------------------------

export interface ConfirmPhotoSuccess {
  kind: "ok";
  clientId: string;
  entry: PhotoMapEntry;
}
export interface ConfirmPhotoTransient {
  kind: "transient";
  clientId: string;
  message: string;
}
export interface ConfirmPhotoPermanent {
  kind: "permanent";
  clientId: string;
  message: string;
}
export type ConfirmPhotoResult =
  | ConfirmPhotoSuccess
  | ConfirmPhotoTransient
  | ConfirmPhotoPermanent;

interface UploadEntry {
  clientId: string;
  /** A local file:// or content:// URI returned by expo-image-picker.
   *  We `fetch` it to materialise a Blob the signed PUT can take. */
  localUri: string;
  takenAt?: string;
  /** Mime type the picker reported, used on the signed PUT. */
  mimeType?: string;
}

/**
 * Internal queue entry. A persisted `photoId` is what makes a
 * retried confirm idempotent: the server's `(userId, clientId,
 * photoId)` PK collapses the duplicate to "already confirmed"
 * instead of inserting a second row.
 */
interface QueuedEntry extends UploadEntry {
  photoId: string;
  attempts: number;
  lastError?: string;
}

async function uploadOne(entry: QueuedEntry): Promise<ConfirmPhotoResult> {
  const token = await getToken();
  if (!token) return { kind: "transient", clientId: entry.clientId, message: "no auth" };

  // 1. Sign the PUT.
  let signRes: Response;
  try {
    signRes = await fetchWithTimeout(
      uploadUrlEndpoint(entry.clientId),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      PHOTO_FETCH_TIMEOUT_MS,
    );
  } catch (err) {
    return {
      kind: "transient",
      clientId: entry.clientId,
      message: err instanceof Error ? err.message : "sign network error",
    };
  }
  if (signRes.status === 401 || signRes.status === 403) {
    return { kind: "transient", clientId: entry.clientId, message: "auth" };
  }
  if (!signRes.ok) {
    return {
      kind: "transient",
      clientId: entry.clientId,
      message: `sign ${signRes.status}`,
    };
  }
  const sign = (await signRes.json()) as { uploadURL?: string; objectPath?: string };
  if (!sign.uploadURL || !sign.objectPath) {
    return { kind: "transient", clientId: entry.clientId, message: "bad sign body" };
  }

  // 2. Materialise the local file as a Blob.
  let blob: Blob;
  try {
    const fileRes = await fetch(entry.localUri);
    blob = await fileRes.blob();
  } catch (err) {
    // The local file no longer exists (user emptied photo library,
    // app sandbox cleaned up). No retry can recover this.
    return {
      kind: "permanent",
      clientId: entry.clientId,
      message: err instanceof Error ? err.message : "couldn't read photo",
    };
  }
  const contentType = entry.mimeType || blob.type || "image/jpeg";

  // 3. PUT the bytes to GCS.
  let putRes: Response;
  try {
    putRes = await fetchWithTimeout(
      sign.uploadURL,
      {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: blob,
      },
      PHOTO_PUT_TIMEOUT_MS,
    );
  } catch (err) {
    return {
      kind: "transient",
      clientId: entry.clientId,
      message: err instanceof Error ? err.message : "PUT network error",
    };
  }
  if (!putRes.ok) {
    // 4xx from GCS on a fresh signed URL means the URL expired or
    // the body was rejected — both transient enough to retry.
    return {
      kind: "transient",
      clientId: entry.clientId,
      message: `PUT ${putRes.status}`,
    };
  }

  // 4. PATCH confirm.
  let patchRes: Response;
  try {
    patchRes = await fetchWithTimeout(
      confirmEndpoint(entry.clientId),
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          photo_id: entry.photoId,
          photo_path: sign.objectPath,
          ...(entry.takenAt ? { taken_at: entry.takenAt } : {}),
        }),
      },
      PHOTO_FETCH_TIMEOUT_MS,
    );
  } catch (err) {
    return {
      kind: "transient",
      clientId: entry.clientId,
      message: err instanceof Error ? err.message : "confirm network error",
    };
  }
  if (patchRes.status === 401 || patchRes.status === 403) {
    return { kind: "transient", clientId: entry.clientId, message: "auth" };
  }
  // Permanent server-side rejections (413 too large, 415 unsupported
  // mime, 400 malformed body, 404 object vanished, 409 album full).
  // No retry would ever succeed — drop the entry so a heartbeat
  // loop doesn't burn forever. The user keeps the original memory;
  // only this photo is gone.
  if (
    patchRes.status === 400 ||
    patchRes.status === 404 ||
    patchRes.status === 409 ||
    patchRes.status === 413 ||
    patchRes.status === 415
  ) {
    return {
      kind: "permanent",
      clientId: entry.clientId,
      message: `confirm ${patchRes.status}`,
    };
  }
  if (!patchRes.ok) {
    return {
      kind: "transient",
      clientId: entry.clientId,
      message: `confirm ${patchRes.status}`,
    };
  }
  const body = (await patchRes.json()) as { photo?: ServerPhoto };
  if (!body.photo) {
    return { kind: "transient", clientId: entry.clientId, message: "bad confirm body" };
  }
  // Backfill the photoId we sent so the optimistic queued thumb
  // can be matched against the confirmed row deterministically
  // even on legacy server builds that omit `photo_id` in the
  // response envelope.
  const serverPhoto: ServerPhoto = {
    ...body.photo,
    photo_id: body.photo.photo_id ?? entry.photoId,
  };
  return {
    kind: "ok",
    clientId: entry.clientId,
    entry: entryFromServer(serverPhoto),
  };
}

// ---- Persistent queue -------------------------------------------------------

function queueKey(email: string): string {
  return `pendingPhotoUploads_${email.toLowerCase().trim()}`;
}

async function readQueue(email: string): Promise<QueuedEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(queueKey(email));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: QueuedEntry[] = [];
    for (const e of parsed) {
      if (
        !e ||
        typeof e !== "object" ||
        typeof (e as QueuedEntry).clientId !== "string" ||
        typeof (e as QueuedEntry).localUri !== "string"
      ) {
        continue;
      }
      const raw = e as Partial<QueuedEntry> & UploadEntry;
      // Backfill `photoId` for entries persisted by the Task #372
      // single-photo build so a cold-start mid-upgrade still
      // confirms exactly once instead of looping forever on the
      // missing-field 400.
      out.push({
        clientId: raw.clientId,
        localUri: raw.localUri,
        takenAt: raw.takenAt,
        mimeType: raw.mimeType,
        photoId: raw.photoId ?? newPhotoId(),
        attempts: typeof raw.attempts === "number" ? raw.attempts : 0,
        lastError: raw.lastError,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function writeQueue(email: string, list: QueuedEntry[]): Promise<void> {
  try {
    if (list.length === 0) {
      await AsyncStorage.removeItem(queueKey(email));
    } else {
      await AsyncStorage.setItem(queueKey(email), JSON.stringify(list));
    }
  } catch {
    /* ignore — best-effort persistence */
  }
}

/**
 * Append a fresh entry to the per-user upload queue. Multiple
 * entries per `clientId` are explicitly allowed (Task #385) — a
 * memory can hold up to MAX_PHOTOS_PER_MEMORY photos. Each call
 * mints its own client-side `photoId` so a retried PATCH-confirm
 * dedupes server-side instead of double-counting against the cap.
 */
export async function enqueuePhotoUpload(
  email: string,
  entry: UploadEntry,
): Promise<void> {
  const current = await readQueue(email);
  current.push({
    ...entry,
    photoId: newPhotoId(),
    attempts: 0,
  });
  await writeQueue(email, current);
}

/**
 * Drop every queued upload for a memory without uploading. Used
 * when the source memory was deleted before its photos had a
 * chance to land.
 */
export async function discardQueuedPhoto(
  email: string,
  clientId: string,
): Promise<void> {
  const current = await readQueue(email);
  const next = current.filter((e) => e.clientId !== clientId);
  if (next.length !== current.length) await writeQueue(email, next);
}

/**
 * Snapshot of which clientIds currently have at least one queued
 * upload — the memory context uses this on cold-start to mark rows
 * with the "uploading photo…" affordance until the drain confirms
 * them.
 */
export async function listPendingPhotoIds(email: string): Promise<Set<string>> {
  const list = await readQueue(email);
  return new Set(list.map((e) => e.clientId));
}

export interface DrainOutcome {
  /** clientIds → confirmed photos from this drain, in the order
   *  they were uploaded. A single drain can produce multiple
   *  entries for the same memory (the user picked 4 photos at
   *  once and the queue drained them back-to-back). */
  confirmed: Record<string, PhotoMapEntry[]>;
  /** clientIds that still have at least one transient-failed entry
   *  queued this round. Surfaced so the caller can keep their
   *  pending flags on. */
  stillPending: string[];
}

/**
 * Walk the queue once. Successful entries drop out and are returned
 * in `confirmed` so the caller can patch the in-memory memory list.
 * Transient failures bump `attempts` and stay queued. Permanent
 * failures are dropped silently — the row keeps its server-state
 * and the user can re-attach.
 *
 * Caller is responsible for serialising calls (don't drain twice
 * concurrently for the same user).
 */
export async function drainPhotoQueue(email: string): Promise<DrainOutcome> {
  const queue = await readQueue(email);
  if (queue.length === 0) return { confirmed: {}, stillPending: [] };
  const confirmed: Record<string, PhotoMapEntry[]> = {};
  const remaining: QueuedEntry[] = [];
  for (const entry of queue) {
    const outcome = await uploadOne(entry);
    if (outcome.kind === "ok") {
      const list = confirmed[outcome.clientId] ?? (confirmed[outcome.clientId] = []);
      list.push(outcome.entry);
    } else if (outcome.kind === "permanent") {
      // drop
    } else {
      remaining.push({
        ...entry,
        attempts: entry.attempts + 1,
        lastError: outcome.message,
      });
    }
  }
  await writeQueue(email, remaining);
  return {
    confirmed,
    stillPending: Array.from(new Set(remaining.map((e) => e.clientId))),
  };
}
