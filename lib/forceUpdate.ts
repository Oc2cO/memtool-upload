/**
 * Force-update / soft-update detection.
 *
 * On every cold launch (and on foreground-return, rate-limited to once
 * per 4 hours) the app pings `/api/app-version` on the API server and
 * compares the response's `minimum_version` / `latest_version` against
 * the current binary version (from `expo-constants`).
 *
 * Three outcomes:
 *   - "up_to_date"    — current build ≥ latest_version; nothing to do.
 *   - "soft_update"   — current build is between minimum and latest;
 *                       show a dismissible banner.
 *   - "force_update"  — current build < minimum_version; show a
 *                       blocking screen pointing at the store.
 *   - "error"         — network failure or malformed response; treat
 *                       as up-to-date so a transient outage never blocks
 *                       the user.
 *
 * The last-fetched config is cached in AsyncStorage so the check has
 * sub-millisecond latency on subsequent launches (during the TTL window).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

export type UpdateStatus =
  | "up_to_date"
  | "soft_update"
  | "force_update"
  | "error";

export interface VersionConfig {
  minimum_version: string;
  latest_version: string;
  store_url_ios?: string;
  store_url_android?: string;
}

export interface UpdateCheckResult {
  status: UpdateStatus;
  latestVersion?: string;
  storeUrl?: string;
}

export const IOS_STORE_URL =
  "https://apps.apple.com/app/memtool/id6738907487";
export const ANDROID_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.polsia.memtool";

const LAST_CHECK_KEY = "mt_update_last_check";
const CACHED_CONFIG_KEY = "mt_update_cached_config";
const SOFT_DISMISSED_KEY_PREFIX = "mt_soft_dismissed_";
const CHECK_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Returns the current app version string from `expo-constants`.
 * Falls back to "1.0.0" when `expoConfig` is unavailable (e.g. in Jest).
 */
export function getCurrentVersion(): string {
  return Constants.expoConfig?.version ?? "1.0.0";
}

/**
 * Returns the current build number as a string.
 * Prefer the native build version embedded in the installed binary.
 * iOS: `CFBundleVersion`.
 * Android: `versionCode`.
 *
 * `expoConfig` can be missing build metadata in production/EAS
 * runtime manifests, so it is only a fallback for local/dev builds.
 * Fallback: "1".
 */
export function getCurrentBuildNumber(): string {
  const nativeBuildVersion = Constants.nativeBuildVersion;
  if (nativeBuildVersion != null && nativeBuildVersion.length > 0) {
    return nativeBuildVersion;
  }
  if (Platform.OS === "ios") {
    return Constants.expoConfig?.ios?.buildNumber ?? "1";
  }
  const code = Constants.expoConfig?.android?.versionCode;
  return code != null ? String(code) : "1";
}

/**
 * Compare two semver-style strings. Returns:
 *   < 0 when a < b
 *     0 when a === b
 *   > 0 when a > b
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v.split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchVersionConfig(
  baseUrl: string,
): Promise<VersionConfig | null> {
  try {
    const trimmed = baseUrl.replace(/\/+$/, "");
    const url = trimmed.endsWith("/api")
      ? `${trimmed}/app-version`
      : `${trimmed}/api/app-version`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as VersionConfig;
  } catch {
    return null;
  }
}

/**
 * Check for updates against the API server. Results are cached in
 * AsyncStorage for `CHECK_TTL_MS` to avoid hammering the server on
 * every foreground event.
 *
 * @param baseUrl  The API server base URL (from `getApiBaseUrl()` /
 *                 env). If empty or falsy, the function returns
 *                 `{ status: "error" }` immediately without network.
 * @param force    Skip the TTL cache and always fetch fresh config.
 */
export async function checkForUpdate(
  baseUrl: string,
  force = false,
): Promise<UpdateCheckResult> {
  if (!baseUrl) return { status: "error" };

  try {
    let config: VersionConfig | null = null;

    if (!force) {
      const lastCheckRaw = await AsyncStorage.getItem(LAST_CHECK_KEY).catch(
        () => null,
      );
      const cachedRaw = await AsyncStorage.getItem(CACHED_CONFIG_KEY).catch(
        () => null,
      );
      if (lastCheckRaw && cachedRaw) {
        const age = Date.now() - new Date(lastCheckRaw).getTime();
        if (age < CHECK_TTL_MS) {
          try {
            config = JSON.parse(cachedRaw) as VersionConfig;
          } catch {
            config = null;
          }
        }
      }
    }

    if (!config) {
      config = await fetchVersionConfig(baseUrl);
      if (config) {
        await Promise.all([
          AsyncStorage.setItem(LAST_CHECK_KEY, new Date().toISOString()),
          AsyncStorage.setItem(CACHED_CONFIG_KEY, JSON.stringify(config)),
        ]).catch(() => {});
      }
    }

    if (!config) return { status: "error" };

    const current = getCurrentVersion();
    const storeUrl =
      Platform.OS === "android"
        ? (config.store_url_android ?? ANDROID_STORE_URL)
        : (config.store_url_ios ?? IOS_STORE_URL);

    if (compareVersions(current, config.minimum_version) < 0) {
      return { status: "force_update", latestVersion: config.latest_version, storeUrl };
    }
    if (compareVersions(current, config.latest_version) < 0) {
      return { status: "soft_update", latestVersion: config.latest_version, storeUrl };
    }
    return { status: "up_to_date", latestVersion: config.latest_version };
  } catch {
    return { status: "error" };
  }
}

/**
 * Persist that the user dismissed the soft-update banner for a given
 * version. On next check, if the version is the same, we won't re-show
 * the banner. If a newer version is available we show it again.
 */
export async function dismissSoftUpdate(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${SOFT_DISMISSED_KEY_PREFIX}${version}`,
      "1",
    );
  } catch {
    // non-fatal
  }
}

/**
 * Returns true if the user already dismissed the soft-update banner
 * for this specific version string.
 */
export async function isSoftUpdateDismissed(
  version: string,
): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(
      `${SOFT_DISMISSED_KEY_PREFIX}${version}`,
    );
    return v !== null;
  } catch {
    return false;
  }
}
