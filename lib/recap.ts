import { authFetch } from "./auth";

/**
 * Polsia MemTool daily-recap backend contract (verified Apr 28, 2026).
 *
 * Base: https://mem-tool.polsia.app/api/memtool (set in lib/config.ts).
 * Auth: Bearer token from AsyncStorage `mt_token` (handled by authFetch).
 *
 * - GET /recap
 *     -> {
 *          summary: string,
 *          themes: string[],
 *          mood_trend: string | null,
 *          suggestion: string | null,
 *          capture_count: number,
 *          date: string,        // YYYY-MM-DD, server-defined "today"
 *          cached: boolean      // backend hint, NOT user-facing
 *        }
 *
 * Critical contract notes:
 * - Read-only domain. There is NO POST/PUT/DELETE for recap and no
 *   regenerate / dismiss / history endpoint. The recap is computed
 *   server-side from the user's captures + mood for the day.
 * - One endpoint, today only. No date parameter, no per-date variant.
 *   The server returns its own `date` so the client never has to
 *   compute the recap window.
 * - Auth required: without a Bearer token the server returns 401
 *   `{"error":"Authorization token required"}`.
 * - `themes` may be `[]` even when `capture_count > 0`; consumers must
 *   hide an empty themes row instead of rendering an empty container.
 * - `mood_trend` and `suggestion` are independently nullable. Hide each
 *   when null.
 * - Empty-day response (verified live with test@test.com):
 *     { summary: "No captures yet today. Start recording your thoughts!",
 *       themes: [], mood_trend: null, suggestion: null,
 *       capture_count: 0, date: "2026-04-28", cached: false }
 *   When `capture_count === 0`, callers should render an empty-state CTA
 *   instead of summary/themes/etc., even if the server filled in a
 *   placeholder summary string.
 * - `cached` is NOT user-facing. It's a backend hint that the response
 *   was served from the per-day server cache. Logging it once per fetch
 *   for dev observability is fine; do not display it.
 * - Dead routes (do NOT call): GET /recap/daily, GET /recap/history,
 *   GET /daily-recap — all 404.
 *
 * No client cache: the server already caches per day, the recap is
 * read-only and trivially refetchable, and the screen state is
 * single-component. There is no AsyncStorage / context for this domain.
 */

export interface Recap {
  summary: string;
  themes: string[];
  mood_trend: string | null;
  suggestion: string | null;
  capture_count: number;
  date: string;
  cached: boolean;
}

type ServerRecapResponse = Partial<Recap> & Record<string, unknown>;

/**
 * Defensive normalization (Rule #7): coerce missing/malformed fields
 * to safe defaults so a backend hiccup can never crash the screen with
 * a render-time TypeError. Empty strings on `mood_trend` / `suggestion`
 * are treated as null so the hide-on-null UI rules apply uniformly.
 */
function normalizeRecap(raw: unknown): Recap {
  const r = (raw && typeof raw === "object" ? raw : {}) as ServerRecapResponse;
  const themes = Array.isArray(r.themes)
    ? r.themes.filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];
  const moodTrend =
    typeof r.mood_trend === "string" && r.mood_trend.trim().length > 0
      ? r.mood_trend
      : null;
  const suggestion =
    typeof r.suggestion === "string" && r.suggestion.trim().length > 0
      ? r.suggestion
      : null;
  return {
    summary: typeof r.summary === "string" ? r.summary : "",
    themes,
    mood_trend: moodTrend,
    suggestion,
    capture_count:
      typeof r.capture_count === "number" && Number.isFinite(r.capture_count)
        ? Math.max(0, Math.floor(r.capture_count))
        : 0,
    date: typeof r.date === "string" ? r.date : "",
    cached: r.cached === true,
  };
}

export async function apiGetRecap(): Promise<Recap> {
  const data = await authFetch("/recap", { method: "GET" });
  return normalizeRecap(data);
}
