import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import { Platform } from "react-native";

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

let initialized = false;

const REDACT_FIELDS = new Set([
  "password",
  "new_password",
  "code",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "email",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_FIELDS.has(k.toLowerCase())) {
      out[k] = "[Redacted]";
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function appVersion(): string {
  const version = Constants.expoConfig?.version ?? "0.0.0";
  const build =
    (Platform.OS === "ios"
      ? Constants.expoConfig?.ios?.buildNumber
      : Constants.expoConfig?.android?.versionCode?.toString()) ?? "0";
  return `memtool@${version}+${build}`;
}

/**
 * Initialize Sentry for the MemTool Expo app.
 *
 * Expo SDK 54 uses `@sentry/react-native` directly (the legacy
 * `sentry-expo` package is deprecated and unmaintained as of SDK 50+).
 * Native crash capture works on iOS in EAS / TestFlight builds; in
 * Expo Go it falls back to JS-only error capture (still useful for
 * smoke-testing the wiring).
 *
 * Errors-only configuration: no performance traces, no session replay.
 * If the DSN env var is missing the SDK is not initialized at all so
 * local dev / web preview stay quiet and offline-friendly.
 */
export function initSentry(): void {
  if (initialized) return;
  if (!DSN) {
    // Single warning at startup, then silence — matches the server.
    // eslint-disable-next-line no-console
    console.warn(
      "[Sentry] EXPO_PUBLIC_SENTRY_DSN not set — error reporting disabled.",
    );
    initialized = true;
    return;
  }
  Sentry.init({
    dsn: DSN,
    environment: __DEV__ ? "development" : "production",
    release: appVersion(),
    dist: Platform.OS,
    enableNative: true,
    enableNativeCrashHandling: true,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        if (event.request.url?.includes("/auth/")) {
          delete event.request.data;
        } else if (event.request.data) {
          event.request.data = redact(event.request.data) as typeof event.request.data;
        }
        if (event.request.headers) {
          const h = event.request.headers as Record<string, string>;
          for (const k of Object.keys(h)) {
            if (REDACT_FIELDS.has(k.toLowerCase())) h[k] = "[Redacted]";
          }
        }
      }
      if (event.extra) event.extra = redact(event.extra) as typeof event.extra;
      // Strip email if a user object accidentally carries one.
      if (event.user?.email) delete event.user.email;
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) {
        breadcrumb.data = redact(breadcrumb.data) as typeof breadcrumb.data;
      }
      return breadcrumb;
    },
  });
  initialized = true;
}

export function isSentryEnabled(): boolean {
  return Boolean(DSN);
}

export function setSentryUser(id: string | null): void {
  if (!isSentryEnabled()) return;
  if (id) {
    Sentry.setUser({ id });
  } else {
    Sentry.setUser(null);
  }
}

export function captureSentryError(error: Error, tags?: Record<string, string>): void {
  if (!isSentryEnabled()) return;
  Sentry.captureException(error, tags ? { tags } : undefined);
}

export { Sentry };
