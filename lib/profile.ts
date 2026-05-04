// Profile client for `/api/profile`. Raw fetch + `x-mem-user-id`
// header (matches the `aiEngine` pattern; the generated React Query
// hooks don't pass that header).
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  type UserProfile,
  type UserProfileEmpty,
  type UserProfileInput,
  type UserProfileTrait,
} from "@workspace/api-client-react";

import { resolveReplitApiBase } from "./config";

export { buildProfileFromAnswers } from "./profileMapper";

const PROFILE_TIMEOUT_MS = 8_000;

function profileEndpoint(): string {
  return `${resolveReplitApiBase()}/api/profile`;
}

export function profileCacheKey(email: string): string {
  return `mt_profile_${email}`;
}

export async function loadCachedProfile(
  email: string,
): Promise<UserProfile | null> {
  if (!email) return null;
  try {
    const raw = await AsyncStorage.getItem(profileCacheKey(email));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    if (parsed?.created !== true || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function cacheProfile(
  email: string,
  profile: UserProfile,
): Promise<void> {
  if (!email) return;
  try {
    await AsyncStorage.setItem(profileCacheKey(email), JSON.stringify(profile));
  } catch {
    /* best-effort */
  }
}

export async function clearCachedProfile(email: string): Promise<void> {
  if (!email) return;
  try {
    await AsyncStorage.removeItem(profileCacheKey(email));
  } catch {
    /* ignore */
  }
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

export async function fetchProfile(
  userId: string,
): Promise<UserProfile | UserProfileEmpty> {
  if (!userId) throw new Error("fetchProfile: missing userId");
  const res = await fetchWithTimeout(
    profileEndpoint(),
    { method: "GET", headers: { "x-mem-user-id": userId } },
    PROFILE_TIMEOUT_MS,
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GET /api/profile HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as UserProfile | UserProfileEmpty;
}

export async function saveProfile(
  userId: string,
  input: UserProfileInput,
): Promise<UserProfile> {
  if (!userId) throw new Error("saveProfile: missing userId");
  const res = await fetchWithTimeout(
    profileEndpoint(),
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-mem-user-id": userId,
      },
      body: JSON.stringify(input),
    },
    PROFILE_TIMEOUT_MS,
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`PUT /api/profile HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as UserProfile;
}

export async function removeProfile(userId: string): Promise<void> {
  if (!userId) throw new Error("removeProfile: missing userId");
  const res = await fetchWithTimeout(
    profileEndpoint(),
    { method: "DELETE", headers: { "x-mem-user-id": userId } },
    PROFILE_TIMEOUT_MS,
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`DELETE /api/profile HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
}

export type {
  UserProfile,
  UserProfileEmpty,
  UserProfileInput,
  UserProfileTrait,
};
