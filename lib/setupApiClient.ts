// Thin module-load bridge that wires the resolved Replit api-server
// URL into the codegen `customFetch` client. Lives in its own file
// so it can be unit-tested without booting `app/_layout.tsx` (which
// pulls in expo-router, fonts, RevenueCat, the gesture root view…).
//
// Behaviour (Task #285):
//   - Resolve the URL via the STRICT
//     `resolveReplitApiBaseStrict()` — env unset, env empty, or env
//     set to an invalid value (e.g. "https://undefined") all fail
//     loud rather than silently masking the misconfiguration with
//     the production fallback.
//   - On `{ ok: false }`, log a clear console error and SKIP
//     `setBaseUrl` so the codegen client refuses requests instead of
//     firing them at `https://undefined` and crashing the app
//     shortly after login.
//   - Returns `true` when the URL was applied, `false` when the
//     strict resolver rejected it. The caller in `_layout.tsx` uses
//     the boolean to surface a one-line "Server not configured"
//     `CrashScreen` so a future env-var regression is caught the
//     moment the app boots.
//
// The dev workflow (`pnpm run dev`), the EAS `preview` profile, and
// the EAS `production` profile all set
// `EXPO_PUBLIC_REPLIT_API_BASE_URL` explicitly — the strict resolver
// succeeds in every supported configuration and the CrashScreen path
// only fires when the env wiring genuinely regresses.
import { setBaseUrl } from "@workspace/api-client-react";

import { resolveReplitApiBaseStrict } from "./config";

export function setupApiClientBaseUrl(): boolean {
  const result = resolveReplitApiBaseStrict();
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(
      `[setupApiClient] Refusing to set codegen client base URL: ` +
        `${result.reason}. Raw value: ${JSON.stringify(result.rawValue)}. ` +
        `Set EXPO_PUBLIC_REPLIT_API_BASE_URL in eas.json's preview / ` +
        `production build profiles, and ensure the dev script in ` +
        `artifacts/memtool/package.json is exporting it for local runs.`,
    );
    return false;
  }
  setBaseUrl(result.url);
  return true;
}
