// Pre-warm the FoundationModels framework at launch to amortize the one-time
// cold-start cost before the first user-facing summary call (Task #263).
//
// The FoundationModels framework pays a one-time "cold-start" cost on the first
// `LanguageModelSession` call per process — paging the ~3B-param model into the
// Neural Engine cache. Reference measurements put this surcharge at +500–1500 ms
// (see docs/FOUNDATION_MODELS_SPIKE.md §Measured latency). By firing a
// throwaway `summarize` call shortly after launch we ensure every user-facing
// feature (auto-tag, recap summary, transcript cleanup) pays warm latency only.
//
// Design constraints:
//   - Never blocks the UI thread / first paint (fire-and-forget via `void`).
//   - Gated on `getAvailability().available` so ineligible devices skip it.
//   - Uses a module-level `prewarmFired` flag (set synchronously on first call)
//     rather than relying solely on `isFirstRunInProcess()` (which flips only
//     after the async summarize resolves) so rapid re-calls from tests / hot
//     reload can never enqueue a second warm-up before the first one finishes.
//   - `isFirstRunInProcess()` provides a second gate for the case where some
//     other call path (e.g. a user-initiated summary) already paid the cold cost
//     before this function fires.

import {
  getAvailability,
  isFirstRunInProcess,
  summarize,
} from "../modules/foundation-models";

const PREWARM_INPUT = "warm";

let prewarmFired = false;

/**
 * Fire a single throwaway `summarize` call to pre-warm the FoundationModels
 * Neural Engine cache. Safe to call multiple times — only the first eligible
 * call per process actually enqueues the warm-up.
 *
 * Intended to be called once from the root layout after the splash screen hides
 * and the UI is interactive, so the background work runs at low priority
 * without delaying first paint.
 */
export function prewarmFoundationModels(): void {
  if (prewarmFired) return;
  if (!isFirstRunInProcess()) return;
  if (!getAvailability().available) return;
  prewarmFired = true;
  void summarize(PREWARM_INPUT);
}

/** Reset pre-warm state between test runs. Never call in production code. */
export function __resetPrewarmForTests(): void {
  prewarmFired = false;
}
