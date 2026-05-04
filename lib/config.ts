/**
 * Fallback base URL for the Polsia-hosted auth gateway. Used by the
 * lenient `resolveAuthApiBase` (consumed by `lib/auth.ts`) so the
 * auth/login/register/me endpoints always have a usable URL even if a
 * deployment forgot to set `EXPO_PUBLIC_AUTH_API_BASE_URL`. Keeping
 * the historical Polsia gateway as the default means existing
 * dev / preview / production builds behave identically to before this
 * env var existed (Task #291).
 */
export const FALLBACK_AUTH_API_BASE =
  "https://oc2coos-2.polsia.app/api/memtool";

/**
 * @deprecated Prefer `resolveAuthApiBase()` so the host can be
 * overridden per build via `EXPO_PUBLIC_AUTH_API_BASE_URL`. Retained
 * as a re-export of the fallback for any external callers; remove
 * once nothing imports it.
 */
export const AUTH_API_BASE = FALLBACK_AUTH_API_BASE;

export const AUTH_TOKEN_KEY = "mt_token";

/**
 * Fallback base URL for the Replit-hosted api-server. Used by the
 * lenient `resolveReplitApiBase` (raw-fetch lib modules: `profile`,
 * `illustrations`, `annotations`, `aiEngine`, `serverEntitlement`,
 * `memories`) so those modules always have a usable URL even if the
 * deployment forgot to set `EXPO_PUBLIC_REPLIT_API_BASE_URL`. The
 * strict resolver `resolveReplitApiBaseStrict`, used by the codegen
 * client setup, deliberately does NOT fall back to this constant —
 * boot-time misconfiguration must surface as a `CrashScreen`, not be
 * silently masked.
 *
 * Polsia (`AUTH_API_BASE`) handles auth and the legacy memories sync
 * gateway; everything else lives on this host.
 */
export const FALLBACK_REPLIT_API_BASE = "https://memtool.replit.app";

/**
 * Outcome of the strict env-driven base URL resolution. `ok: true`
 * means the codegen client can be wired up safely; `ok: false`
 * carries the diagnostic the boot-time `CrashScreen` should show.
 */
export type ReplitApiBaseResolution =
  | { ok: true; url: string; source: "env" }
  | { ok: false; reason: string; rawValue: string };

/**
 * Strict env resolver — used by `setupApiClientBaseUrl` to wire the
 * codegen `customFetch` client.
 *
 * Returns `{ ok: false }` when `EXPO_PUBLIC_REPLIT_API_BASE_URL` is
 *   - unset / empty / whitespace-only, or
 *   - set to a value that fails `isValidApiBaseUrl` (e.g. the
 *     literal `"https://undefined"` template-string regression
 *     that shipped in TestFlight and crashed the app shortly after
 *     login — Task #285).
 *
 * The boot-time call site in `app/_layout.tsx` surfaces both cases
 * as a calm "Server not configured" `CrashScreen` so future env
 * regressions are caught the moment the app loads, not after login.
 *
 * Dev / preview / production builds all set the env var explicitly
 * (the dev script in `package.json` and the EAS preview / production
 * profiles in `eas.json`), so this resolver succeeds in every
 * supported configuration. The lenient
 * `resolveReplitApiBase` below stays available for raw-fetch lib
 * modules that need a usable URL even when env is missing.
 */
export function resolveReplitApiBaseStrict(): ReplitApiBaseResolution {
  // IMPORTANT: must use dot notation for the read so `babel-preset-expo`
  // statically inlines `EXPO_PUBLIC_REPLIT_API_BASE_URL` into the
  // production bundle. Bracket access (`process.env["EXPO_PUBLIC_…"]`)
  // is NOT replaced by the Expo babel plugin and would resolve to
  // `undefined` on device even when the env var is set in
  // `eas.json` / the dev script — the same class of bug as the
  // original `https://${process.env.EXPO_PUBLIC_DOMAIN}` regression
  // this task is fixing. Keep this read as a direct member access.
  const raw = process.env.EXPO_PUBLIC_REPLIT_API_BASE_URL;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {
      ok: false,
      reason: "EXPO_PUBLIC_REPLIT_API_BASE_URL is not set",
      rawValue: typeof raw === "string" ? raw : "",
    };
  }
  const trimmed = raw.trim();
  if (!isValidApiBaseUrl(trimmed)) {
    return {
      ok: false,
      reason:
        "EXPO_PUBLIC_REPLIT_API_BASE_URL is set to an invalid value " +
        "(empty, contains 'undefined', or missing http(s) scheme)",
      rawValue: trimmed,
    };
  }
  return {
    ok: true,
    url: trimmed.replace(/\/+$/, ""),
    source: "env",
  };
}

/**
 * Lenient env resolver — used by `lib/auth.ts` to resolve the
 * Polsia-hosted auth gateway base URL at request time.
 *
 * Returns the env override `EXPO_PUBLIC_AUTH_API_BASE_URL` when it
 * passes `isValidApiBaseUrl`, otherwise falls back to
 * `FALLBACK_AUTH_API_BASE` (the historical Polsia gateway). This
 * mirrors `resolveReplitApiBase` so we can point staging / preview /
 * dev builds at a different auth endpoint without a code change, and
 * so a future infra migration off Polsia is a config flip rather
 * than a source edit (Task #291).
 *
 * Auth requests aren't issued at boot, so a misconfiguration here
 * doesn't need to fail loud the way the codegen client setup does —
 * a network call against the fallback host will surface its own
 * "Couldn't reach the server" error if the fallback is also gone.
 */
export function resolveAuthApiBase(): string {
  // IMPORTANT: must use dot notation so `babel-preset-expo` statically
  // inlines `EXPO_PUBLIC_AUTH_API_BASE_URL` into the production bundle.
  // Bracket access is NOT replaced by the Expo babel plugin and would
  // resolve to `undefined` on device even when the env var is set in
  // `eas.json` / the dev script — the same class of bug Task #285
  // fixed for the Replit URL. Keep this read as a direct member access.
  const raw = process.env.EXPO_PUBLIC_AUTH_API_BASE_URL;
  if (typeof raw !== "string") return FALLBACK_AUTH_API_BASE;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return FALLBACK_AUTH_API_BASE;
  if (!isValidApiBaseUrl(trimmed)) return FALLBACK_AUTH_API_BASE;
  return trimmed.replace(/\/+$/, "");
}

/**
 * Lenient env resolver — used by the raw-fetch lib modules
 * (`profile`, `illustrations`, `annotations`, `aiEngine`,
 * `serverEntitlement`, `memories`). Always returns a usable URL: the
 * env override when it validates, otherwise `FALLBACK_REPLIT_API_BASE`
 * (the verified production api-server). These modules need a string
 * to interpolate into endpoint paths and should not crash the whole
 * app if env happens to be unset — the strict resolver above is
 * reserved for the boot-time codegen client setup that does need to
 * fail loud.
 */
export function resolveReplitApiBase(): string {
  const result = resolveReplitApiBaseStrict();
  return result.ok ? result.url : FALLBACK_REPLIT_API_BASE;
}

/**
 * Returns true when `url` is a usable absolute http(s) base URL.
 *
 * Rejects:
 *   - non-strings, empty / whitespace-only strings.
 *   - any string containing the literal substring `"undefined"`
 *     (catches the classic `https://${process.env.MISSING}`
 *     template-string bug that shipped in the production TestFlight
 *     bundle and crashed the app shortly after login — Task #285).
 *   - strings that don't start with `http://` or `https://`, so the
 *     codegen client never produces malformed requests like
 *     `setBaseUrl("undefined")`.
 *   - strings whose host parses to empty.
 */
export function isValidApiBaseUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.toLowerCase().includes("undefined")) return false;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    if (!parsed.host) return false;
  } catch {
    return false;
  }
  return true;
}
