# Sentry — MemTool (Expo SDK 54)

Errors-only error reporting via [@sentry/react-native](https://docs.sentry.io/platforms/react-native/).

## Why @sentry/react-native (not sentry-expo)

`sentry-expo` is deprecated as of Expo SDK 50+; the Sentry team's official
guidance for SDK 54 is to install `@sentry/react-native` directly. Expo's prebuild
picks up the autolinking the same way and EAS builds it natively without any
extra config plugin (no `expo-cli build:configure` step needed).

## Required env vars

| Var | Where | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_SENTRY_DSN` | shared (must have the `EXPO_PUBLIC_` prefix) | DSN from the `memtool-mobile` Sentry project. Bundled into the JS at build time. Missing → SDK is not initialized, single `console.warn` at startup, every Sentry call is a no-op. |
| `SENTRY_AUTH_TOKEN` | EAS secret (build-time only) | Auth token with `project:write` + `project:releases` scopes. Required for the EAS build to upload JS bundles + source maps. Missing → build still succeeds, but the uploaded release in Sentry will show minified stack traces. |
| `SENTRY_ORG` | EAS env (build-time only) | Sentry org slug. Interpolated into `app.json` via `$SENTRY_ORG`. Required alongside `SENTRY_AUTH_TOKEN`. |

The DSN must be present **at EAS build time**, not just at runtime, because
Expo bakes `EXPO_PUBLIC_*` values into the bundled JS. Saving the secret in
Replit before the next EAS build is sufficient.

## What's wired

- `lib/sentry.ts` — `initSentry()`, PII scrubbing (`beforeSend` strips request
  bodies on `/auth/` URLs, redacts `password`, `code`, `token`, `email`,
  `authorization`, `cookie`), helpers `setSentryUser(id)`, `captureSentryError`.
- `app/_layout.tsx` — `initSentry()` runs as the very first import, before any
  other module load. The existing `<ErrorBoundary>` forwards captured render
  errors to Sentry via `Sentry.captureException` with the React component stack.
- `context/AuthContext.tsx` — sets the Sentry user scope to `{ id }` (no email)
  whenever the signed-in user changes; clears it on logout / account deletion.
- `app/(app)/(tabs)/settings.tsx` — a "Send Sentry test error" row inside the
  developer-options block. Visible in production TestFlight builds when the
  developer-options toggle is unlocked, so QA can verify wiring per release.

## Verifying after a TestFlight install

1. Install the build, sign in.
2. Settings → toggle on **Developer options**.
3. Tap **Send Sentry test error**.
4. Open the `memtool-mobile` Sentry project — the event arrives within ~1 min
   tagged `source=settings_dev_test`, with `release=memtool@<version>+<build>`
   and `dist=ios`.

## Source maps (automatic, via EAS)

Source map upload runs automatically as part of every EAS build. The wiring is:

- `app.config.ts` (dynamic Expo config layered on top of `app.json`)
  registers the `@sentry/react-native/expo` config plugin with
  `project: "memtool-mobile"` and `organization` read from
  `process.env.SENTRY_ORG`. A dynamic config is required because static
  `app.json` does not interpolate shell-style `$VAR` values inside plugin
  options. The plugin installs the iOS native build phase (`sentry-xcode.sh`
  + the bundled `sentry-xcode-debug-files-upload.sh`) so React Native source
  maps and iOS debug symbols upload as part of the Xcode archive step.
- `metro.config.js` uses `getSentryExpoConfig` instead of `getDefaultConfig`
  so the JS bundle is stamped with a Debug ID that matches the uploaded map
  (no need to manually pin a release/dist string).
- `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` must be set as EAS secrets / env vars
  on the build profile. Without them the build still succeeds, but the
  upload step is a no-op and stack traces in Sentry stay minified.

The release string in Sentry (`memtool@<version>+<build>`) and `dist=ios`
continue to be set at runtime by `lib/sentry.ts`. The Debug ID flow makes
that string essentially advisory — Sentry symbolicates by Debug ID first.

### Manual upload fallback

If you need to re-upload maps for an existing build (e.g. the EAS upload
failed), run `expo export` locally and use sentry-cli with the same project:

```sh
pnpm --filter @workspace/memtool exec expo export --platform ios --output-dir dist
SENTRY_AUTH_TOKEN=... SENTRY_ORG=... \
  pnpm dlx @sentry/cli@^2 sourcemaps upload \
    --project memtool-mobile \
    --release "memtool@<version>+<build>" \
    --dist ios \
    --strip-prefix $(pwd) \
    dist
```
