import AsyncStorage from "@react-native-async-storage/async-storage";

import { AUTH_TOKEN_KEY, resolveAuthApiBase } from "./config";

export interface User {
  id?: string;
  email: string;
  display_name?: string;
  avatar_uri?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface MeResponse {
  user: User;
}

export class AuthError extends Error {
  status?: number;
  body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.body = body;
  }
}

export async function getToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

function joinUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  // Resolved per-call so the env override (`EXPO_PUBLIC_AUTH_API_BASE_URL`)
  // is honored even if it's set after this module is first imported,
  // and so tests can swap the env between cases without re-importing.
  const base = resolveAuthApiBase().replace(/\/+$/, "");
  const tail = path.startsWith("/") ? path : `/${path}`;
  return `${base}${tail}`;
}

async function parseJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Hard ceiling for any single auth/server request. Anything slower
 * than this almost certainly means the connection is dead — the
 * proxied Polsia gateway answers in well under a second on a good
 * link, and a real "slow but alive" 3G request still completes inside
 * ~10 seconds. We use 20s so we never punish a slow-but-working
 * connection, but we always recover from a stalled socket instead of
 * letting the screen sit on a permanent spinner (e.g. the Mem AI
 * Guide "Mem is thinking…" indicator). Surfaced as the same friendly
 * "Couldn't reach the server" string a flat-out network failure uses,
 * so the calling screen's existing retry affordance just works.
 */
const REQUEST_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  // If the caller already passed a signal we still honor it — wire
  // both into a single AbortController so whichever fires first wins.
  const controller = new AbortController();
  const externalSignal = init.signal;
  let externalAbortListener: (() => void) | null = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalAbortListener = () => controller.abort();
      externalSignal.addEventListener("abort", externalAbortListener, {
        once: true,
      });
    }
  }
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    // Detach our hook from any caller-owned signal so we don't keep
    // a reference to this controller alive for the full lifetime of
    // a long-lived shared AbortSignal (e.g. a screen-scoped one
    // reused across many requests).
    if (externalSignal && externalAbortListener) {
      externalSignal.removeEventListener("abort", externalAbortListener);
    }
  }
}

function friendlyMessage(status: number, body: any): string {
  const serverMsg =
    (body && typeof body === "object" && (body.error || body.message)) || null;
  if (status === 400 && serverMsg) return String(serverMsg);
  if (status === 401) return serverMsg ? String(serverMsg) : "Invalid credentials";
  if (status === 403) return "You don't have permission to do that";
  if (status === 404) return "Not found";
  if (status === 409) return serverMsg ? String(serverMsg) : "Email already in use";
  if (status === 422 && serverMsg) return String(serverMsg);
  if (status >= 500) return "Server error — please try again";
  if (serverMsg) return String(serverMsg);
  return `Request failed (${status})`;
}

export async function authFetch(
  path: string,
  options: RequestInit = {},
): Promise<any> {
  const token = await getToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(joinUrl(path), { ...options, headers });
  } catch {
    throw new AuthError("Couldn't reach the server — check your connection");
  }

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new AuthError(friendlyMessage(res.status, body), res.status, body);
  }
  return body;
}

async function publicFetch(
  path: string,
  options: RequestInit = {},
): Promise<any> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(joinUrl(path), { ...options, headers });
  } catch {
    throw new AuthError("Couldn't reach the server — check your connection");
  }

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new AuthError(friendlyMessage(res.status, body), res.status, body);
  }
  return body;
}

export async function apiRegister(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthResponse> {
  const data: AuthResponse = await publicFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      display_name: displayName.trim(),
    }),
  });
  if (!data || !data.token || !data.user) {
    throw new AuthError("Unexpected response from server");
  }
  await setToken(data.token);
  return data;
}

export async function apiLogin(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const data: AuthResponse = await publicFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
    }),
  });
  if (!data || !data.token || !data.user) {
    throw new AuthError("Unexpected response from server");
  }
  await setToken(data.token);
  return data;
}

export async function apiMe(): Promise<MeResponse> {
  const data: MeResponse = await authFetch("/auth/me", { method: "GET" });
  if (!data || !data.user) {
    throw new AuthError("Unexpected response from server");
  }
  return data;
}

export async function apiLogout(): Promise<void> {
  await clearToken();
}
