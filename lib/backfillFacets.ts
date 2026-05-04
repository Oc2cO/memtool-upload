// One-time backfill of on-device `MemoryFacets` for memories that
// were captured before Task #195 shipped (the per-row extractor in
// the capture flow). Without this, existing rows in a user's
// archive would permanently lack `facets` because the capture-flow
// hook only attaches them to NEW memories — the tags / themes
// surfaces would take weeks to populate organically as the user
// captured fresh memories.
//
// Design constraints (from Task #277):
//   - Skip entirely on devices where the on-device model is not
//     available. The capture flow already degrades silently in this
//     case, so the backfill must too — there's no value in walking
//     the cache if every call would short-circuit to `unavailable`.
//   - Throttled. The on-device model is fast (~300ms/call) but
//     pinning the CPU on a cold start would compete with React
//     paint and the bulk memory pull. We process one row at a time
//     with a small pause between rows so the UI stays responsive.
//   - Persists each result back via the same `onResult` callback
//     the consumer wires up (in practice: setMemories +
//     writeMemoriesCache from MemoriesContext) so the row updates
//     in place without a full re-render of every consumer.
//   - Cancellable via AbortSignal so unmount / sign-out / email
//     change stops further work mid-loop instead of racing with a
//     stale email.
//
// This is a pure module — no React, no AsyncStorage. The caller
// supplies the extractor function, the availability check, and
// the persist callback. That keeps it trivially unit-testable
// (the test harness injects fakes) and prevents the backfill from
// growing accidental dependencies on context-shaped state.

import type { Memory, MemoryFacets } from "./memories";
import type { FMExtractFacetsResult } from "../modules/foundation-models";

/**
 * Default pause between successive `extractFacets` calls. ~250ms
 * keeps the on-device model from saturating the Neural Engine
 * cache eviction cycle during the backfill, while still making
 * meaningful progress (a 200-row archive finishes in well under
 * two minutes of foreground time). The capture flow's interactive
 * call is unaffected because each call is independent — the
 * backfill is only ever sleeping between its OWN calls.
 */
export const BACKFILL_PAUSE_MS = 250;

/**
 * Hard ceiling on rows processed in a single backfill session.
 * The backfill is a "first idle moment after sign-in" job — we
 * don't want to keep churning forever on a 5,000-row archive in
 * a single foreground burst (battery, thermals). Once the limit
 * is hit the remainder will get picked up the next time the app
 * cold-starts; in the typical case (a few hundred legacy rows)
 * the cap is never reached.
 */
export const BACKFILL_MAX_PER_SESSION = 500;

export interface BackfillFacetsOptions {
  /** True iff the on-device model is available on this device.
   *  When false the function returns immediately with
   *  `skipped: true` — the capture flow degrades the same way. */
  available: boolean;
  /** Native extractor. Pulled in via dependency injection so the
   *  test harness can supply a fake without touching
   *  `requireNativeModule`. In production this is the bound
   *  `extractFacets` from `modules/foundation-models`. */
  extract: (text: string) => Promise<FMExtractFacetsResult>;
  /** Persist a single row's facets. The consumer (MemoriesContext)
   *  wires this to its in-memory `setMemories` patch + the
   *  existing `writeMemoriesCache` path so the row gains its
   *  facets in place. May be async — we await it before moving on
   *  so a slow AsyncStorage write doesn't pile up parallel writes
   *  on the same key (last-writer-wins racing the next iteration). */
  onResult: (id: string, facets: MemoryFacets) => void | Promise<void>;
  /** Abort mid-loop. Checked between every row AND right after
   *  the throttle sleep so a sign-out during the pause stops the
   *  next call from firing against a stale email. */
  signal?: AbortSignal;
  /** Override the default pause between rows. `0` disables the
   *  pause entirely (used by tests so they don't have to thread
   *  fake timers through every assertion). */
  pauseMs?: number;
  /** Override the per-session cap. Used by tests to force the
   *  cap path without seeding 500 fixture rows. */
  maxPerSession?: number;
}

export interface BackfillFacetsSummary {
  /** Number of rows in the input that were missing `facets`
   *  (i.e. the backfill candidates BEFORE the per-session cap). */
  candidates: number;
  /** Rows we actually called `extract` on. `<= candidates` when
   *  the per-session cap or an early abort cut us short. */
  attempted: number;
  /** Rows where `extract` returned `status: "ok"` and `onResult`
   *  was invoked. */
  succeeded: number;
  /** Rows where `extract` resolved to `unavailable` or threw.
   *  We don't retry these in this session — the next cold start
   *  will try again because the row still has no `facets` field. */
  failed: number;
  /** True if availability was false at entry and we returned
   *  without iterating. The other counters are zero in this case. */
  skipped: boolean;
  /** True if the loop was stopped by the AbortSignal mid-way. */
  aborted: boolean;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Walk `memories`, run `extract` on every row that is missing the
 * `facets` field, and apply each result via `onResult`. Honours
 * availability gating, throttling, and abort.
 *
 * The function never throws — extractor failures are caught per-row
 * and counted in the returned summary so a single bad memory can't
 * abort the whole backfill. Same for `onResult` rejections (they
 * count as "failed" for that row and the loop continues).
 */
export async function backfillMissingFacets(
  memories: readonly Memory[],
  options: BackfillFacetsOptions,
): Promise<BackfillFacetsSummary> {
  const summary: BackfillFacetsSummary = {
    candidates: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: false,
    aborted: false,
  };

  if (!options.available) {
    summary.skipped = true;
    return summary;
  }
  if (options.signal?.aborted) {
    summary.aborted = true;
    return summary;
  }

  const pauseMs = options.pauseMs ?? BACKFILL_PAUSE_MS;
  const maxPerSession = options.maxPerSession ?? BACKFILL_MAX_PER_SESSION;

  // Snapshot the candidate list up front so iterating is O(n) and
  // a concurrent setMemories that ADDS new rows (e.g. a capture
  // mid-backfill) doesn't make us walk the array twice.
  const candidates: Memory[] = [];
  for (const m of memories) {
    if (m.facets === undefined && typeof m.content === "string" && m.content.length > 0) {
      candidates.push(m);
      if (candidates.length >= maxPerSession) break;
    }
  }
  summary.candidates = candidates.length;

  for (let i = 0; i < candidates.length; i++) {
    if (options.signal?.aborted) {
      summary.aborted = true;
      break;
    }
    const row = candidates[i]!;
    summary.attempted++;
    let result: FMExtractFacetsResult;
    try {
      result = await options.extract(row.content);
    } catch {
      summary.failed++;
      // Throttle even on failure so a transient device-side error
      // (e.g. model evicted from cache) doesn't spin a tight retry
      // loop across the whole archive.
      if (i < candidates.length - 1) await sleep(pauseMs, options.signal);
      continue;
    }
    if (result.status === "ok") {
      try {
        await options.onResult(row.id, result.facets);
        summary.succeeded++;
      } catch {
        // Persist failed for this row; treat as a soft failure so
        // the next session retries (the row still has no facets in
        // the cache).
        summary.failed++;
      }
    } else {
      summary.failed++;
      // If the model flips to `unavailable` mid-backfill (e.g. the
      // user toggled Apple Intelligence off in Settings while we
      // were running), every subsequent call would hit the same
      // path. Bail out early so we don't waste battery iterating
      // the rest of the archive only to record a long string of
      // failures.
      summary.aborted = true;
      break;
    }
    if (i < candidates.length - 1) await sleep(pauseMs, options.signal);
  }

  return summary;
}
