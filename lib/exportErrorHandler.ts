/**
 * Branching used by the Settings → "Export your memories" catch block.
 *
 * `fetchAllMemoriesForExport` re-throws an `AuthError` (with a numeric
 * `status`) on real HTTP failures so the UI can react instead of silently
 * downgrading to a stale cached export. We map those into one of three
 * user-visible outcomes:
 *
 *   - 401  → session expired: show inline message + a "Session expired"
 *            alert with a Sign in button that calls `logout()` so the
 *            (app) auth guard redirects to /login.
 *   - any other AuthError with a numeric status (4xx/5xx) → server-problem
 *     copy.
 *   - everything else (no status, generic Error, unknown shape) → calm
 *     "try again in a moment" copy. AbortError is filtered upstream and
 *     should never reach this helper.
 *
 * Lives outside settings.tsx so it is unit-testable: the Settings screen
 * itself can't be mounted in jest (its Expo router / font / animation
 * imports pull in too many side effects), so the test coverage lives
 * here, mirroring the `useHandleRestore` extraction.
 */
import { Alert as DefaultAlert } from "react-native";

import { AuthError } from "./auth";

export const SESSION_EXPIRED_EXPORT_MESSAGE =
  "Your session expired — please sign in again";
export const SERVER_PROBLEM_EXPORT_MESSAGE =
  "Couldn't build your export — the server had a problem. Please try again later.";
export const GENERIC_EXPORT_ERROR_MESSAGE =
  "Couldn't build your export — try again in a moment.";

export interface HandleExportErrorOptions {
  setExportError: (next: string | null) => void;
  logout: () => Promise<void> | void;
  // Test-only override; production callers omit this so the real
  // react-native Alert is used.
  alert?: typeof DefaultAlert.alert;
}

export function handleExportError(
  err: unknown,
  opts: HandleExportErrorOptions,
): void {
  const { setExportError, logout, alert = DefaultAlert.alert } = opts;

  if (err instanceof AuthError && err.status === 401) {
    setExportError(SESSION_EXPIRED_EXPORT_MESSAGE);
    alert(
      "Session expired",
      SESSION_EXPIRED_EXPORT_MESSAGE,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign in",
          onPress: () => {
            // Clearing the token flips `user` to null; the (app) auth
            // guard then declaratively redirects to /login.
            void logout();
          },
        },
      ],
    );
    return;
  }

  if (err instanceof AuthError && typeof err.status === "number") {
    setExportError(SERVER_PROBLEM_EXPORT_MESSAGE);
    return;
  }

  setExportError(GENERIC_EXPORT_ERROR_MESSAGE);
}
