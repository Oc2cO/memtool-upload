import { authFetch, AuthError } from "./auth";

/**
 * Polsia MemTool AI Guide chat contract (per Task #63 brief, May 1, 2026).
 *
 * Base: https://oc2coos-2.polsia.app/api/memtool (set in lib/config.ts).
 * Auth: Bearer token from AsyncStorage `mt_token` (handled by authFetch).
 *
 * - POST /ai-guide/chat
 *     body: { message: string }
 *     -> 200 { response: string, mood_detected: string }
 *     -> 401 { error: ... }   (re-auth via AuthError)
 *
 * Crisis detection is server-authoritative. The frontend MUST NOT
 * attempt to detect crisis content or override Mem's reply — render
 * whatever the server returns verbatim (per task brief).
 *
 * No history endpoint and no daily-prompt endpoint exist yet, so:
 *   - thread state lives locally on-device (lib/aiGuideThread.ts)
 *   - the warm empty-state intro is rendered locally, never fetched
 *   - the per-day free-tier message cap is also enforced on-device
 *     (lib/aiGuideLimits.ts) so a free user can't accidentally rack
 *     up server cost before any future Polsia-side quota lands.
 *
 * Live-verification note: at implementation time (May 1, 2026) the
 * Polsia gateway returned 502 on every memtool route — including the
 * known-good /subscription/status — i.e. a transient upstream outage,
 * not a contract problem. The contract above is taken verbatim from
 * the task brief; this wrapper handles 5xx and network failures with
 * a calm fallback (`AI_GUIDE_NETWORK_ERROR_MESSAGE`) so the UI is
 * correct even if Polsia keeps blipping after launch. The 401 branch
 * is intentionally pass-through so the screen can route to /login the
 * same way other Polsia-backed screens already do.
 */

export type MemMood = "calm" | "happy" | "sad" | "anxious" | "neutral";

const KNOWN_MOODS: ReadonlySet<MemMood> = new Set<MemMood>([
  "calm",
  "happy",
  "sad",
  "anxious",
  "neutral",
]);

/**
 * Coerce an unknown server-supplied mood string into the constrained
 * MemMood union. Trim + lowercase before lookup so a backend tweak
 * that ships e.g. "Happy " doesn't silently degrade to neutral. Any
 * unrecognised value (or non-string) falls back to "neutral" — the
 * task brief is explicit that unknown values must map to neutral.
 */
export function normalizeMood(raw: unknown): MemMood {
  if (typeof raw !== "string") return "neutral";
  const candidate = raw.trim().toLowerCase();
  if (KNOWN_MOODS.has(candidate as MemMood)) {
    return candidate as MemMood;
  }
  return "neutral";
}

export interface AiGuideChatRequest {
  message: string;
}

/**
 * Literal server contract for the /ai-guide/chat 200 body. Mirrors
 * the Polsia spec exactly so a future Orval-generated client can
 * replace the manual fetch without renaming any types. The
 * normalized client-facing shape is `AiGuideChatResponse` (below);
 * `sendAiGuideMessage` is the boundary between the two.
 */
export interface RawAiGuideChatResponse {
  response: string;
  mood_detected: string;
}

/**
 * Normalized client shape returned by `sendAiGuideMessage`.
 * `mood_detected` is collapsed into the constrained `MemMood`
 * union; the original string is kept as `rawMood` for debug /
 * analytics. The screen never reads `rawMood`.
 */
export interface AiGuideChatResponse {
  /** Mem's reply text. Always non-empty after normalization. */
  response: string;
  /** Normalized mood — always one of the MemMood values. */
  mood: MemMood;
  /** Raw mood string returned by the server, kept for debug/logging. */
  rawMood: string | null;
}

/**
 * User-facing fallback shown when the network or server is
 * unreachable. Calm + retryable — the screen surfaces this in a
 * "Try again" banner and the user can re-send their last message.
 */
export const AI_GUIDE_NETWORK_ERROR_MESSAGE =
  "Mem couldn't reach the network. Try again in a moment.";

/**
 * User-facing fallback shown when the server replies but the body
 * is unusable (missing `response`, empty string, malformed JSON).
 * Same retry affordance as the network case.
 */
export const AI_GUIDE_GENERIC_ERROR_MESSAGE =
  "Mem couldn't respond just now. Try again in a moment.";

/**
 * User-facing fallback shown when Polsia returns 429 — either the
 * shared chat rate-limit or a future server-side per-day cap. Not
 * the same string as the local cap upsell because the user may
 * already be Pro, in which case the cause is rate-limiting, not
 * tier-gating. Stays calm and retryable.
 */
export const AI_GUIDE_RATE_LIMIT_MESSAGE =
  "Mem is being asked a lot right now. Try again in a moment.";

/**
 * User-facing copy for the dedicated "backend is down" banner that
 * the AI Guide screen swaps in after two consecutive 5xx replies
 * (Task #397). Distinct from `AI_GUIDE_NETWORK_ERROR_MESSAGE` so a
 * launch-day Polsia outage doesn't read as a phone-side connectivity
 * blip — names the upstream service rather than implying the user
 * needs to fiddle with Wi-Fi. Stays calm + non-actionable: there's
 * no useful retry the user can do until the gateway is back, so the
 * copy explicitly tells them to wait. Re-used by the Upgrade CTA on
 * the subscription screen when /subscription/checkout returns 5xx
 * for the same reason.
 */
export const AI_GUIDE_UNAVAILABLE_MESSAGE =
  "Mem is temporarily unavailable — we'll be back shortly.";

/**
 * Discriminated error thrown by `sendAiGuideMessage` for everything
 * EXCEPT 401 (which is re-thrown as the original `AuthError` so the
 * screen can route to /login the same way the rest of the app does).
 *
 * `userMessage` is the calm string the screen should display
 * verbatim. Don't pull `.message` for UI — it may contain raw SDK
 * text.
 */
export class AiGuideError extends Error {
  readonly userMessage: string;
  /**
   * True when the failure was a 5xx from the Polsia gateway — i.e.
   * an upstream outage rather than a local network blip or a 4xx
   * client error. The screen counts consecutive `isServerOutage`
   * strikes so a transient blip still shows the calm retry copy,
   * but a sustained outage swaps to the dedicated
   * `AI_GUIDE_UNAVAILABLE_MESSAGE` banner (Task #397).
   */
  readonly isServerOutage: boolean;
  constructor(
    userMessage: string,
    message?: string,
    options: { isServerOutage?: boolean } = {},
  ) {
    super(message ?? userMessage);
    this.name = "AiGuideError";
    this.userMessage = userMessage;
    this.isServerOutage = options.isServerOutage === true;
  }
}

/**
 * POST a message to Mem and return the normalized reply. Trims the
 * input client-side (an empty string is treated as a programming
 * error and surfaces as a generic AiGuideError instead of hitting
 * the network).
 *
 * Error mapping:
 *   - 401 AuthError       → re-thrown unchanged (re-auth)
 *   - 5xx AuthError       → AiGuideError(NETWORK_ERROR_MESSAGE)
 *   - network down        → AiGuideError(NETWORK_ERROR_MESSAGE)
 *                           (authFetch wraps fetch failures as an
 *                           AuthError with no `status`)
 *   - other AuthError     → AiGuideError(GENERIC_ERROR_MESSAGE)
 *   - missing/empty body  → AiGuideError(GENERIC_ERROR_MESSAGE)
 *   - anything else thrown→ AiGuideError(NETWORK_ERROR_MESSAGE)
 */
export async function sendAiGuideMessage(
  message: string,
): Promise<AiGuideChatResponse> {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    throw new AiGuideError(AI_GUIDE_GENERIC_ERROR_MESSAGE, "empty message");
  }

  let raw: unknown;
  try {
    raw = await authFetch("/ai-guide/chat", {
      method: "POST",
      body: JSON.stringify({ message: trimmed } satisfies AiGuideChatRequest),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.status === 401) {
        throw err;
      }
      if (err.status === undefined) {
        // authFetch wraps fetch() failures as an AuthError with no
        // status — treat as a network outage.
        throw new AiGuideError(AI_GUIDE_NETWORK_ERROR_MESSAGE, err.message);
      }
      if (err.status === 429) {
        // Future-proof: Polsia doesn't enforce a per-day chat quota
        // today, but if/when it does the server is expected to use
        // 429. Surface a calm rate-limit message rather than the
        // generic one so a Pro user (who isn't gated by the local
        // cap) gets the right framing.
        throw new AiGuideError(AI_GUIDE_RATE_LIMIT_MESSAGE, err.message);
      }
      if (err.status >= 500) {
        // Tag 5xx as a server-outage strike so the screen can swap
        // to the dedicated "Mem is temporarily unavailable" banner
        // after two in a row (Task #397). The user-visible string
        // stays the calm network copy on a single blip — the
        // unavailable banner is screen-side, after the strike count
        // crosses the threshold.
        throw new AiGuideError(AI_GUIDE_NETWORK_ERROR_MESSAGE, err.message, {
          isServerOutage: true,
        });
      }
      throw new AiGuideError(AI_GUIDE_GENERIC_ERROR_MESSAGE, err.message);
    }
    throw new AiGuideError(AI_GUIDE_NETWORK_ERROR_MESSAGE);
  }

  if (!raw || typeof raw !== "object") {
    throw new AiGuideError(AI_GUIDE_GENERIC_ERROR_MESSAGE, "bad response shape");
  }
  const r = raw as Partial<RawAiGuideChatResponse>;
  const responseText = typeof r.response === "string" ? r.response.trim() : "";
  if (responseText.length === 0) {
    throw new AiGuideError(AI_GUIDE_GENERIC_ERROR_MESSAGE, "empty response");
  }
  return {
    response: responseText,
    mood: normalizeMood(r.mood_detected),
    rawMood: typeof r.mood_detected === "string" ? r.mood_detected : null,
  };
}
