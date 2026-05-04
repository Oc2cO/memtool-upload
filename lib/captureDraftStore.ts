import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Per-user, per-screen draft persistence for in-progress capture and
 * log-a-call notes (Task #319 — pre-launch Round 3 follow-up).
 *
 * Today both screens hold their unsent text in component state only.
 * If iOS evicts the JS bundle while the app is backgrounded, or if
 * the user force-kills from the app switcher, the in-progress note
 * vanishes with no warning. This helper is the small layer that
 * survives those events.
 *
 * Design choices:
 *   - One draft per (user, screen). We only ever keep the latest
 *     in-progress note for a given screen — multi-draft management is
 *     explicitly out of scope.
 *   - Per-user key. The current signed-in user id is part of the
 *     storage key so an account-switch on the same device cannot
 *     surface another user's text. An empty/missing user id is the
 *     "not signed in yet" state and the helper short-circuits to a
 *     no-op (load returns null, save/clear do nothing) so a draft
 *     from before sign-in cannot leak into the first signed-in
 *     session.
 *   - Age cap. Drafts older than `DRAFT_MAX_AGE_MS` (7 days) are
 *     dropped on load so a forgotten note doesn't haunt the field
 *     forever. The cap is checked at load time, not at save time, so
 *     a tab that's been open for an hour still saves through.
 *   - Best-effort writes. AsyncStorage failures (e.g. ENOSPC) are
 *     swallowed — losing a draft is bad, but crashing the keystroke
 *     handler would be worse, and the user still has the in-memory
 *     text in the field.
 *   - Schema is versioned via the key prefix. Bumping the prefix
 *     drops every old draft instead of trying to migrate corrupt or
 *     incompatible shapes.
 */

const DRAFT_KEY_PREFIX = "mt_capture_draft_v1";

export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type DraftScreen = "capture" | "log-call" | "voice-capture";

export interface CaptureDraft {
  /** Free-form note body. Empty string is allowed; we only persist
   *  when the caller decides there's something worth saving. */
  content: string;
  /** Selected tag chips (capture / voice-capture). Always present,
   *  possibly []. */
  tags: string[];
  /** Person name field (log-call only). Always present, possibly "". */
  person: string;
  /** Headline field (voice-capture only). Always present, possibly
   *  "". Older blobs that predate voice-capture won't have written
   *  this; load defaults it to "". */
  title: string;
  /** Detected / user-edited emotional tone (voice-capture only).
   *  Stored as a string here to keep the store agnostic of the
   *  EmotionalTone union; the screen casts on the way out. Empty
   *  string means "no tone persisted" (e.g. capture / log-call). */
  tone: string;
  /** Wall-clock ms when the draft was last written. Used by the
   *  age-cap on load. */
  updatedAt: number;
}

function keyFor(screen: DraftScreen, userId: string): string {
  return `${DRAFT_KEY_PREFIX}:${screen}:${userId}`;
}

function emptyDraft(): CaptureDraft {
  return { content: "", tags: [], person: "", title: "", tone: "", updatedAt: 0 };
}

/**
 * Load the latest draft for the given (user, screen). Returns `null`
 * when:
 *   - no userId is provided (signed-out / loading auth state),
 *   - nothing has been persisted yet,
 *   - the persisted blob is corrupt / wrong shape, or
 *   - the persisted blob is older than `DRAFT_MAX_AGE_MS`.
 *
 * Callers should treat `null` as "no draft to restore" and leave
 * their inputs at their default empty state.
 */
export async function loadDraft(
  screen: DraftScreen,
  userId: string | null | undefined,
  now: number = Date.now(),
): Promise<CaptureDraft | null> {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(keyFor(screen, userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    const content = typeof o.content === "string" ? o.content : "";
    const person = typeof o.person === "string" ? o.person : "";
    const title = typeof o.title === "string" ? o.title : "";
    const tone = typeof o.tone === "string" ? o.tone : "";
    const tags = Array.isArray(o.tags)
      ? o.tags.filter((t): t is string => typeof t === "string")
      : [];
    const updatedAt =
      typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
        ? o.updatedAt
        : 0;
    // Nothing meaningful in the blob — treat as no draft. Tone is
    // intentionally excluded from this check: a freshly-opened voice
    // draft defaults to tone "neutral", and we don't want a bare
    // tone with no body / title / tags to count as a restorable draft.
    if (!content && !person && !title && tags.length === 0) return null;
    if (now - updatedAt > DRAFT_MAX_AGE_MS) return null;
    return { content, person, title, tone, tags, updatedAt };
  } catch {
    return null;
  }
}

/**
 * Persist the draft. Called from the screens' debounced effect on
 * every meaningful change. If every field is empty we treat the
 * call as a clear instead — there's nothing worth restoring on
 * next launch.
 */
export async function saveDraft(
  screen: DraftScreen,
  userId: string | null | undefined,
  draft: Partial<Omit<CaptureDraft, "updatedAt">> &
    Pick<CaptureDraft, "content" | "person" | "tags">,
  now: number = Date.now(),
): Promise<void> {
  if (!userId) return;
  const title = draft.title ?? "";
  const tone = draft.tone ?? "";
  const isEmpty =
    !draft.content.trim() &&
    !draft.person.trim() &&
    !title.trim() &&
    draft.tags.length === 0;
  if (isEmpty) {
    await clearDraft(screen, userId);
    return;
  }
  try {
    const payload: CaptureDraft = {
      content: draft.content,
      person: draft.person,
      title,
      tone,
      tags: draft.tags,
      updatedAt: now,
    };
    await AsyncStorage.setItem(keyFor(screen, userId), JSON.stringify(payload));
  } catch {
    // best-effort
  }
}

/**
 * Wipe the draft for the given (user, screen). Called on successful
 * save, on explicit discard (back/cancel), and on cap-block routes
 * to subscription so the next visit starts clean.
 */
export async function clearDraft(
  screen: DraftScreen,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(keyFor(screen, userId));
  } catch {
    // ignore
  }
}

export const __test__ = { keyFor, emptyDraft, DRAFT_KEY_PREFIX };
