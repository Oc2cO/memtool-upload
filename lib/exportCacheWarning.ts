/**
 * Shared "this export came from the offline cache" warning copy.
 *
 * Lives in its own dependency-free module so it can be imported by
 * BOTH the share-sheet prompt (which needs react-native's Alert) and
 * the pure export builders (which must stay free of react-native).
 *
 * The whole reason this exists is to keep the user-visible warning
 * in lock-step across three surfaces:
 *
 *   1. Settings → "Cached copy" alert title and share-sheet title
 *      (re-exported from `exportCachePrompt.ts`).
 *   2. The `_export_metadata.note` field embedded in a JSON export.
 *   3. The leading `# Cached export — ...` comment row in a CSV
 *      export.
 *
 * If a future task tweaks the wording, change it here and every
 * surface follows automatically. The schema-lock tests in
 * `memoriesExport.test.ts` and the prompt tests in
 * `exportCachePrompt.test.tsx` both pin the resulting strings.
 */

// The shared tail of the warning sentence, ending in a period so it
// composes cleanly with either prefix ("Cached copy — ", "Cached
// export — ") without any per-call punctuation juggling.
export const CACHED_EXPORT_WARNING_BODY = "older memories may be missing.";

/**
 * In-file note embedded inside the exported JSON / CSV so anyone who
 * opens the saved file later (or a recipient who never saw the share
 * dialog) can tell at a glance that the dataset is incomplete.
 *
 * `exportedAt` must already be an ISO-8601 string — callers in the
 * builders default it to `new Date().toISOString()` and tests inject
 * a fixed value for determinism.
 */
export function buildCachedExportFileNote(exportedAt: string): string {
  return `Cached export — ${CACHED_EXPORT_WARNING_BODY} Generated ${exportedAt}`;
}
