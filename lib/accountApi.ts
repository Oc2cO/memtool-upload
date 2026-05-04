/**
 * Client-side helpers for the self-service account endpoints:
 * - Forgot password  (POST /api/auth/forgot-password)
 * - Reset password   (POST /api/auth/reset-password)
 * - Update display-name (PATCH /api/auth/display-name)
 * - Delete account   (DELETE /api/auth/account)
 *
 * These routes live on our Replit api-server (not the upstream
 * Polsia gateway) so they use `resolveReplitApiBase()` for the
 * base URL, and `getToken()` for the Authorization header on
 * authenticated calls.
 */

import { AuthError } from "./auth";
import { getToken } from "./auth";
import { resolveReplitApiBase } from "./config";

const TIMEOUT_MS = 20_000;

function apiBase(): string {
  return resolveReplitApiBase().replace(/\/+$/, "");
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseBody(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function friendlyError(status: number, body: any): string {
  const msg = body && typeof body === "object" && (body.error || body.message);
  if (msg) return String(msg);
  if (status >= 500) return "Server error — please try again";
  if (status === 401) return "Session expired — please sign in again";
  return `Request failed (${status})`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// ---------------------------------------------------------------------------

/**
 * Request a password-reset email. Always resolves without throwing
 * (to avoid email enumeration); throws AuthError only on connectivity
 * failures so the calling screen can surface an appropriate message.
 */
export async function apiForgotPassword(email: string): Promise<void> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${apiBase()}/api/auth/forgot-password`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
  } catch {
    throw new AuthError("Couldn't reach the server — check your connection");
  }
  // Any non-5xx response is treated as success (no enumeration leakage).
  if (res.status >= 500) {
    throw new AuthError("Server error — please try again later");
  }
}

/**
 * Consume a one-time reset code and set a new password.
 */
export async function apiResetPassword(code: string, newPassword: string): Promise<void> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${apiBase()}/api/auth/reset-password`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ code, new_password: newPassword }),
    });
  } catch {
    throw new AuthError("Couldn't reach the server — check your connection");
  }
  const body = await parseBody(res);
  if (!res.ok) {
    throw new AuthError(friendlyError(res.status, body), res.status, body);
  }
}

/**
 * Update the authenticated user's display name on the server and
 * return the stored value.
 */
export async function apiUpdateDisplayName(displayName: string): Promise<string> {
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${apiBase()}/api/auth/display-name`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ display_name: displayName.trim() }),
    });
  } catch {
    throw new AuthError("Couldn't reach the server — check your connection");
  }
  const body = await parseBody(res);
  if (!res.ok) {
    throw new AuthError(friendlyError(res.status, body), res.status, body);
  }
  return body?.display_name ?? displayName.trim();
}

/**
 * Upload a freshly-picked avatar image to App Storage via a presigned URL,
 * then PATCH the resulting object path so the server persists it (Task #309).
 * Returns the full URL the client should render — i.e. `${apiBase}${objectPath}`
 * where `objectPath` is `/api/storage/objects/<id>`.
 */
export async function apiUploadAvatar(localUri: string): Promise<string> {
  const headers = await authHeaders();

  // 1. Ask the server for a presigned upload URL.
  let urlRes: Response;
  try {
    urlRes = await fetchWithTimeout(`${apiBase()}/api/auth/avatar/upload-url`, {
      method: "POST",
      headers,
    });
  } catch {
    throw new AuthError("Couldn't reach the server — check your connection");
  }
  const urlBody = await parseBody(urlRes);
  if (!urlRes.ok) {
    throw new AuthError(friendlyError(urlRes.status, urlBody), urlRes.status, urlBody);
  }
  const { uploadURL, objectPath } = (urlBody ?? {}) as {
    uploadURL?: string;
    objectPath?: string;
  };
  if (!uploadURL || !objectPath) {
    throw new AuthError("Upload prepare failed — missing URL");
  }

  // 2. Upload the picture bytes directly to GCS via the presigned URL.
  //    React Native's fetch accepts `{ uri, type, name }` blob descriptors
  //    in the body; for PUT we wrap as a blob via fetch().blob() instead
  //    so the Content-Length header matches the file size.
  let blob: Blob;
  try {
    const fileRes = await fetch(localUri);
    blob = await fileRes.blob();
  } catch {
    throw new AuthError("Couldn't read the photo from your device");
  }
  let putRes: Response;
  try {
    putRes = await fetchWithTimeout(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": blob.type || "image/jpeg" },
      body: blob,
    });
  } catch {
    throw new AuthError("Photo upload failed — check your connection");
  }
  if (!putRes.ok) {
    throw new AuthError(`Photo upload failed (${putRes.status})`);
  }

  // 3. Tell the server the upload is done; it normalizes the path,
  //    sets a public ACL, and persists the path to Postgres.
  let patchRes: Response;
  try {
    patchRes = await fetchWithTimeout(`${apiBase()}/api/auth/avatar`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ avatar_url: objectPath }),
    });
  } catch {
    throw new AuthError("Couldn't reach the server — check your connection");
  }
  const patchBody = await parseBody(patchRes);
  if (!patchRes.ok) {
    throw new AuthError(friendlyError(patchRes.status, patchBody), patchRes.status, patchBody);
  }
  const savedPath = (patchBody?.avatar_path as string | undefined) ?? objectPath;
  return `${apiBase()}/api/storage${savedPath}`;
}

/**
 * Fetch the persisted avatar URL for the signed-in user. Returns the
 * full URL the client should render, or null if the user has no avatar.
 */
export async function apiGetAvatar(): Promise<string | null> {
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${apiBase()}/api/auth/avatar`, {
      method: "GET",
      headers,
    });
  } catch {
    throw new AuthError("Couldn't reach the server — check your connection");
  }
  const body = await parseBody(res);
  if (!res.ok) {
    throw new AuthError(friendlyError(res.status, body), res.status, body);
  }
  const path = body?.avatar_path as string | null | undefined;
  if (!path) return null;
  return `${apiBase()}/api/storage${path}`;
}

/**
 * Permanently delete the authenticated user's account and all
 * server-side data. The caller must clear local state and sign
 * out after this resolves.
 */
export async function apiDeleteAccount(): Promise<void> {
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${apiBase()}/api/auth/account`, {
      method: "DELETE",
      headers,
    });
  } catch {
    throw new AuthError("Couldn't reach the server — check your connection");
  }
  const body = await parseBody(res);
  if (!res.ok) {
    throw new AuthError(friendlyError(res.status, body), res.status, body);
  }
}
