/**
 * "Cached copy" confirmation alert that gates the Settings → "Export
 * your memories" flow when `fetchAllMemoriesForExport` had to fall
 * back to the offline AsyncStorage cache (`usedCache: true`).
 *
 * Three contracts a regression here would silently break:
 *
 *   1. The "cancel" outcome must be translated by the caller into an
 *      `Error` whose `name` is exactly `"AbortError"`. The performExport
 *      catch block treats that as a user-cancel and silently returns —
 *      anything else would surface as a "couldn't build your export"
 *      banner, which would be misleading because the user explicitly
 *      opted out.
 *   2. The downstream share-sheet title must change to the warning
 *      copy so the recipient (and the user themselves, in a Files
 *      preview) can see at a glance that the export is incomplete.
 *   3. The "retry" outcome must re-run `fetchAllMemoriesForExport`
 *      under the same AbortController so the existing user-cancel
 *      contract still holds across retries (a Cancel mid-retry must
 *      still abort the in-flight network request, not just the prompt).
 *
 * Lives outside settings.tsx so it is unit-testable: the Settings
 * screen itself can't be mounted in jest (its expo-router / font /
 * animation imports pull in too many side effects), mirroring the
 * `handleExportError` extraction.
 */
import { Alert as DefaultAlert } from "react-native";

import { CACHED_EXPORT_WARNING_BODY } from "./exportCacheWarning";

export const CACHED_COPY_ALERT_TITLE = "Cached copy";
// Composed from the shared warning body so the share-sheet title, the
// JSON `_export_metadata.note`, and the CSV leading comment row stay
// in lock-step. Edit `CACHED_EXPORT_WARNING_BODY` to change all three.
export const CACHED_COPY_SHARE_TITLE = `Cached copy — ${CACHED_EXPORT_WARNING_BODY}`;
export const DEFAULT_EXPORT_SHARE_TITLE = "Save your memories";

// `isRetry` switches the lead-in from a first-time announcement
// ("Couldn't reach the server — …") to an acknowledgement of the
// retry the user just watched complete ("Still couldn't reach the
// server — …"). Without it, a failed Try again re-pops the same alert
// verbatim, which reads as if the cached-copy result is being
// announced for the first time even though the "Retrying network…"
// indicator just came and went. Default `false` keeps the first
// prompt's wording byte-for-byte identical so the Task #131/#132
// happy-path tests (and any pinned-copy snapshot) still pass.
export function buildCachedCopyAlertMessage(
  memoryCount: number,
  opts: { isRetry?: boolean } = {},
): string {
  if (opts.isRetry) {
    return `Still couldn't reach the server — your network looks down. This export contains only locally cached memories. Older memories may be missing (${memoryCount} found).`;
  }
  return `Couldn't reach the server — this export contains only locally cached memories. Older memories may be missing (${memoryCount} found).`;
}

export interface ConfirmCachedCopyExportOptions {
  memoryCount: number;
  // True when the prompt is re-popping after the user tapped
  // "Try again" and the follow-up fetch *also* fell back to cache.
  // Drives the softer "Still couldn't reach the server" wording so
  // the user can tell the retry was acknowledged. Optional and
  // defaults to false so first-attempt callers (the common case)
  // don't have to thread it through.
  isRetry?: boolean;
  // Test-only override; production callers omit this so the real
  // react-native Alert is used.
  alert?: typeof DefaultAlert.alert;
}

/**
 * Three terminal user choices on the "Cached copy" alert:
 *
 *   - `"resolve"` — Continue: proceed with the cached export as-is.
 *   - `"retry"`   — Try again: re-run the network fetch in place
 *                   (the caller is responsible for the loop and for
 *                   reusing the same AbortController).
 *   - `"cancel"`  — Cancel: caller must translate this into a thrown
 *                   `AbortError` so `performExport`'s catch block
 *                   silently swallows it instead of surfacing a
 *                   "couldn't build your export" banner.
 *
 * The helper deliberately resolves with a discriminator string instead
 * of throwing on cancel: the retry path means the caller now has three
 * branches to handle, and a single resolve-with-outcome keeps that
 * switch readable (and the hook unit-testable without try/catch).
 */
export type CachedCopyOutcome = "resolve" | "retry" | "cancel";

/**
 * Show the "Cached copy" confirmation alert. Resolves with the user's
 * choice — see `CachedCopyOutcome` for the contract each branch must
 * uphold.
 */
export function confirmCachedCopyExport(
  opts: ConfirmCachedCopyExportOptions,
): Promise<CachedCopyOutcome> {
  const { memoryCount, isRetry = false, alert = DefaultAlert.alert } = opts;
  return new Promise<CachedCopyOutcome>((resolve) => {
    alert(
      CACHED_COPY_ALERT_TITLE,
      buildCachedCopyAlertMessage(memoryCount, { isRetry }),
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => resolve("cancel"),
        },
        {
          // Sits between Cancel and Continue so the destructive-ish
          // "give up" option and the safe "proceed with stale data"
          // option stay at the edges, with the network retry in the
          // middle as the new affordance the user is most likely to
          // want when they were briefly offline (subway, elevator).
          text: "Try again",
          onPress: () => resolve("retry"),
        },
        { text: "Continue", onPress: () => resolve("resolve") },
      ],
    );
  });
}
