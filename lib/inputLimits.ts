/**
 * Single source of truth for client-side text-input length caps and
 * input sanitisers.
 *
 * Why this file exists
 * --------------------
 * Pre-launch Round 3 (edge-case input sweep) found that several
 * `<TextInput>` surfaces had no `maxLength` prop, which meant a user
 * could paste a 100,000-character article into the capture box, the
 * app would happily round-trip it through the outbox, and the
 * embedding endpoint would silently reject the request (Polsia caps
 * the embed input at 8,000 chars per item). By the time the failure
 * surfaces the user has already lost their place.
 *
 * The caps here are deliberately conservative:
 *   - well under any known server limit (Polsia memories endpoint,
 *     embedding endpoint, AI guide chat endpoint)
 *   - still generous enough that no real journaling thought hits the
 *     ceiling (5,000 chars ≈ 800-1000 words, which is far longer
 *     than any real memory or call note)
 *   - tight enough that an obvious paste of a long article (which
 *     is never what the user actually wants here) gets truncated
 *     at the input layer rather than corrupting downstream state
 *
 * Editing rule of thumb: if you find yourself thinking "I need to
 * raise this for one screen", DON'T. Add a screen-specific override
 * next to the cap and keep this file the canonical default. A
 * higher cap on one surface and not another is exactly the kind of
 * silent inconsistency this file exists to prevent.
 */

/**
 * Maximum character length for a memory body (capture screen) or a
 * logged-call note (log-call screen). 5,000 characters comfortably
 * covers any real journaling thought — a user typing this much by
 * hand has been at it for over twenty minutes — but truncates the
 * "I pasted a Wikipedia article" case before it reaches the outbox.
 *
 * Stays well under Polsia's 8,000-char embed input cap so a memory
 * created at this length still embeds successfully on the AI engine
 * side instead of silently failing later.
 */
export const MEMORY_CONTENT_MAX_LENGTH = 5_000;

/**
 * Maximum character length for the "Who did you speak with?" person
 * name on the log-call screen. Real names plus brief context
 * ("Sarah from work", "Dr. Patel — annual physical") fit easily;
 * pasted-essay inputs do not.
 */
export const PERSON_NAME_MAX_LENGTH = 120;

/**
 * Maximum character length for the search box on the Archive and
 * Tip Archive screens. Search queries are conceptually short — the
 * Polsia full-text search endpoint will happily accept more, but
 * a pasted essay as a "search query" is always a mistake and
 * almost always a sign the user grabbed the wrong field.
 */
export const SEARCH_QUERY_MAX_LENGTH = 200;

/**
 * Maximum character length for the email field on login / signup.
 * RFC 5321 caps the local-part at 64 chars and the domain at 255
 * chars (so 320 chars total in theory) but in practice no real
 * mailbox is anywhere near that long. 254 is the IETF "practical"
 * limit (RFC 3696); we use it verbatim so any address a real mail
 * server would accept also passes here.
 */
export const EMAIL_MAX_LENGTH = 254;

/**
 * Maximum character length for the password field on login / signup.
 * 200 chars is well above any password manager's typical generated
 * length (Bitwarden defaults to 64, 1Password to 50) and below any
 * server-side request-body limit, so a long randomly-generated
 * password still fits comfortably.
 */
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Maximum character length for the display-name field on signup.
 * The home-screen greeting truncates at this length anyway; capping
 * the input avoids the "I pasted my whole bio" failure mode.
 */
export const DISPLAY_NAME_MAX_LENGTH = 80;

/**
 * Maximum character length for the developer-only "Cloud API URL"
 * field in Settings. Real URLs are short; a pasted multi-megabyte
 * blob would otherwise be silently written into AsyncStorage and
 * then attempted as the API base on every request.
 */
export const API_URL_MAX_LENGTH = 500;

/**
 * Validate a user-entered API base URL before persisting it. The
 * Settings screen calls this to refuse malformed or unsafe inputs
 * (e.g. `javascript:` URLs, plain words like "yes", URLs with
 * embedded spaces) instead of writing them to storage and then
 * failing on every subsequent request with an opaque error.
 *
 * Rules:
 *   - must parse via `new URL(...)`
 *   - must be `http:` or `https:` (no `javascript:`, `file:`, etc.)
 *   - must have a non-empty host
 *
 * Returns either `{ ok: true, url }` with the trimmed URL string,
 * or `{ ok: false, reason }` with a short user-facing string the
 * Settings screen can render directly.
 */
export type ApiUrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export function validateApiUrl(input: string): ApiUrlValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, reason: "Enter a URL or leave blank to use local only" };
  }
  if (trimmed.length > API_URL_MAX_LENGTH) {
    return { ok: false, reason: `URL is too long (max ${API_URL_MAX_LENGTH} chars)` };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "That doesn't look like a valid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "URL must start with http:// or https://" };
  }
  if (!parsed.hostname) {
    return { ok: false, reason: "URL is missing a host" };
  }
  return { ok: true, url: trimmed };
}
