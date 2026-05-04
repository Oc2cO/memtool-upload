/**
 * Pure extraction pipeline for the "Speak a memory" capture mode
 * (Task #171).
 *
 * Takes a raw spoken transcript and produces a `StructuredMemoryDraft`
 * the user can edit before saving. The point of voice capture is NOT
 * to dump the raw transcript into the memory body — every successful
 * 2025 voice-first app (Granola, Stuff, Voice Memos with Apple
 * Intelligence) extracts structured fields instead so the resulting
 * entry reads like something the user wrote, not a stenographer's
 * transcription.
 *
 * The functions here are intentionally PURE — no React, no fetches,
 * no Foundation Models call. They run as the on-device fallback
 * whenever the iOS-26 Foundation Models native module isn't available
 * (Android, simulators, older iOS, the dev pre-build), and they also
 * provide the heuristic floor that the LLM call can fall back to if
 * it errors. The screen treats both paths through the same
 * `StructuredMemoryDraft` shape so swapping providers is a one-line
 * flip in `lib/voiceCapture.ts`.
 *
 * What we extract:
 *   - title   : a short, human-readable headline (≤ TITLE_MAX_CHARS).
 *               First sentence of the cleaned body, capitalized,
 *               trailing period stripped. Empty transcript ⇒ "".
 *   - body    : the cleaned transcript — filler words ("um", "uh",
 *               "like", "you know") trimmed, runs of whitespace
 *               collapsed, first letter capitalized. We DO NOT
 *               aggressively rewrite — the user's voice should still
 *               sound like the user.
 *   - tags    : up to TAG_MAX entries from the canonical pool
 *               (`SUGGESTED_TAGS_POOL`) by keyword match. Same pool
 *               capture.tsx exposes so the chips look familiar.
 *   - people  : capitalized name candidates surfaced by simple
 *               relation cues ("called X", "with X", "X said") plus
 *               proper-noun heuristics. De-duplicated, max
 *               PEOPLE_MAX. Common false-positives (sentence-start
 *               capitals, weekday names, month names) are filtered.
 *   - tone    : one of EMOTIONAL_TONES via lexicon match. Defaults
 *               to "neutral" so the screen always renders SOMETHING
 *               and the user can swap the chip if they disagree.
 *
 * Limits are exported so the screen and tests share them — there is
 * no duplicated number to drift between this file and the UI.
 */

export const TITLE_MAX_CHARS = 60;
export const TAG_MAX = 5;
export const PEOPLE_MAX = 5;

/**
 * Canonical tag pool. Mirrors the inline list in
 * `app/(app)/capture.tsx` (`SUGGESTED_TAGS_POOL`). Re-exported here
 * so the pipeline + screen share one source of truth — if a future
 * task adds "money" or "travel" to capture.tsx the heuristic
 * suggestion learns about it through the same constant.
 *
 * If you change this list, also update capture.tsx to import from
 * here (kept inline today only because capture.tsx pre-existed this
 * pipeline and we don't want this task's diff to touch unrelated
 * UI). The screen for `voice-capture.tsx` already imports this
 * constant directly so the chips render identically.
 */
export const VOICE_SUGGESTED_TAGS_POOL = [
  "social",
  "work",
  "health",
  "idea",
  "errand",
  "call",
  "reflection",
] as const;

export type VoiceSuggestedTag = (typeof VOICE_SUGGESTED_TAGS_POOL)[number];

/**
 * Keyword → tag map. A transcript that contains any of these tokens
 * (case-insensitive, word-bounded) gets the matching tag suggested.
 * Each tag has a short list of unambiguous cues — we deliberately
 * stay narrow so a transcript about "running errands" doesn't also
 * pick up `health` just because "running" appears.
 */
const TAG_KEYWORDS: Record<VoiceSuggestedTag, readonly string[]> = {
  social: [
    "friend",
    "friends",
    "dinner",
    "lunch",
    "drinks",
    "party",
    "hung out",
    "hanging out",
    "met up",
    "hangout",
  ],
  work: [
    "work",
    "meeting",
    "client",
    "project",
    "deadline",
    "boss",
    "office",
    "standup",
    "1:1",
    "promotion",
    "interview",
  ],
  health: [
    "gym",
    "workout",
    "run",
    "running",
    "ran",
    "yoga",
    "doctor",
    "sleep",
    "tired",
    "headache",
    "sick",
    "meditation",
    "walk",
    "walked",
  ],
  idea: [
    "idea",
    "thought",
    "what if",
    "should we",
    "i wonder",
    "concept",
    "brainstorm",
    "realized",
    "realised",
  ],
  errand: [
    "grocery",
    "groceries",
    "store",
    "pickup",
    "pick up",
    "drop off",
    "errand",
    "errands",
    "post office",
    "bank",
    "pharmacy",
  ],
  call: ["called", "phone call", "rang", "spoke with", "talked to"],
  reflection: [
    "feeling",
    "feel",
    "felt",
    "grateful",
    "anxious",
    "happy",
    "sad",
    "proud",
    "worried",
    "frustrated",
    "lonely",
    "calm",
  ],
};

/**
 * Filler phrases stripped from the raw transcript. We only remove
 * standalone fillers — a word like "like" inside "I like coffee"
 * stays intact because the regex requires word boundaries AND
 * surrounding whitespace/punctuation that mark it as a filler usage.
 *
 * The order matters slightly: we strip the longer multi-word phrases
 * first so the single-word pass below doesn't shred "you know" into
 * the lone "you" before we get to it.
 */
const MULTI_WORD_FILLERS = [
  "you know",
  "i mean",
  "kind of",
  "sort of",
];

const SINGLE_WORD_FILLERS = ["um", "uh", "uhh", "umm", "er", "erm", "ah"];

/**
 * Lowercased lexicons for emotional tone detection. Order in the
 * scoring loop matters when two tones tie — we resolve ties by the
 * order of `EMOTIONAL_TONES` below (excited > happy > anxious >
 * frustrated > sad > calm > neutral) which roughly matches the
 * intensity hierarchy we want to surface first to the user.
 */
const TONE_KEYWORDS: Record<EmotionalTone, readonly string[]> = {
  excited: [
    "excited",
    "thrilled",
    "stoked",
    "pumped",
    "ecstatic",
    "amazing",
    "incredible",
    "love it",
    "can't wait",
  ],
  happy: [
    "happy",
    "great",
    "good",
    "nice",
    "fun",
    "smile",
    "smiled",
    "glad",
    "joy",
    "joyful",
    "grateful",
    "proud",
  ],
  anxious: [
    "anxious",
    "nervous",
    "worried",
    "worry",
    "stressed",
    "stress",
    "scared",
    "afraid",
    "panic",
    "overwhelmed",
  ],
  frustrated: [
    "frustrated",
    "annoyed",
    "angry",
    "mad",
    "pissed",
    "irritated",
    "fed up",
    "upset",
  ],
  sad: ["sad", "down", "blue", "lonely", "lonesome", "tearful", "cried", "crying"],
  calm: [
    "calm",
    "peaceful",
    "relaxed",
    "settled",
    "breathing",
    "quiet",
    "still",
  ],
  neutral: [],
};

export const EMOTIONAL_TONES = [
  "excited",
  "happy",
  "anxious",
  "frustrated",
  "sad",
  "calm",
  "neutral",
] as const;

export type EmotionalTone = (typeof EMOTIONAL_TONES)[number];

/**
 * Common capitalized words that look like names but aren't. Filtered
 * out so a sentence like "Today I called Sarah" doesn't suggest
 * "Today" as a person. List is intentionally short — we'd rather
 * over-suggest a person the user can dismiss than miss a real one.
 */
const NON_NAME_CAPITALS: ReadonlySet<string> = new Set([
  // Days of week
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  // Months
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  // Pronouns / sentence-starters that often appear capitalized
  "I",
  "I'm",
  "I'll",
  "I've",
  "I'd",
  "Today",
  "Tomorrow",
  "Yesterday",
  "Tonight",
  "Morning",
  "Evening",
  "Night",
  "Afternoon",
  // Common interjections
  "Oh",
  "Okay",
  "Ok",
  "Yes",
  "No",
  "Yeah",
  "Yep",
  "Nope",
  "Maybe",
  "Right",
  "Well",
  "So",
  "Then",
  "But",
  "And",
  "Or",
  "Also",
  "Just",
  "Like",
  "Really",
  "Actually",
  "Maybe",
  "Anyway",
  "Hello",
  "Hi",
  "Hey",
  "Thanks",
]);

export interface StructuredMemoryDraft {
  /** Short headline derived from the first sentence of the cleaned
   *  body. Never auto-saved — the user always sees and can edit it. */
  title: string;
  /** Cleaned transcript (fillers trimmed, whitespace collapsed,
   *  first letter capitalized). This is what goes into the memory
   *  `content` field if the user taps Save without further edits. */
  body: string;
  /** Suggested tags from the canonical pool. The screen pre-selects
   *  these chips; the user can toggle any of them off. */
  tags: VoiceSuggestedTag[];
  /** People mentioned in the transcript. Surfaced as chips the user
   *  can confirm. Today these are display-only (the Memory model
   *  carries a single `person` field on annotations); future task
   *  could expand this into a multi-person annotation. */
  people: string[];
  /** Detected emotional tone, defaulting to "neutral". Used to drive
   *  the tone chip on the draft form and (eventually) the mood
   *  field once the server-side mood schema is finalized. */
  tone: EmotionalTone;
  /** True if the transcript was empty / whitespace-only after
   *  cleaning. The screen uses this to keep the Save button
   *  disabled and to show a "didn't catch that — try again" hint
   *  instead of a dead form. */
  isEmpty: boolean;
}

/**
 * Strip filler phrases and collapse whitespace. Returns a single-
 * line string with normalized spacing — the body can still contain
 * sentence punctuation, just no double spaces / leading-trailing
 * whitespace.
 *
 * Punctuation handling: we want "I went to the gym, um, and then..."
 * to render as "I went to the gym, and then..." not "I went to the
 * gym , and then..." — so each filler-strip pass also collapses any
 * orphaned punctuation+space combos it produces.
 */
export function cleanTranscript(raw: string): string {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/\s+/g, " ").trim();
  if (!s) return "";

  // Strip multi-word fillers first. Word-bounded, case-insensitive.
  // We surround each filler with optional commas so "well, you know,
  // it was..." cleans to "well, it was..." not "well, , it was...".
  for (const phrase of MULTI_WORD_FILLERS) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      String.raw`(^|[\s,.!?;:])\s*` + escaped + String.raw`\s*(?=[\s,.!?;:]|$)`,
      "gi",
    );
    s = s.replace(re, "$1");
  }

  // Single-word fillers. Same shape — we keep the leading separator
  // so the rest of the sentence doesn't lose its punctuation.
  for (const word of SINGLE_WORD_FILLERS) {
    const re = new RegExp(
      String.raw`(^|[\s,.!?;:])` + word + String.raw`(?=[\s,.!?;:]|$)`,
      "gi",
    );
    s = s.replace(re, "$1");
  }

  // Collapse any double spaces / orphaned " ," " ." patterns that
  // the strips above may have produced.
  s = s.replace(/\s+([,.!?;:])/g, "$1");
  s = s.replace(/\s+/g, " ").trim();

  // Collapse runs of leading commas/punctuation (e.g. ", and then")
  // that can result from stripping a sentence-initial filler.
  s = s.replace(/^[,;:.\s]+/, "");

  if (!s) return "";

  // Capitalize first character — the user spoke a sentence; make it
  // start like one. We don't try to capitalize subsequent sentences
  // because the speech-to-text engine's own punctuation is good
  // enough and over-capitalizing breaks proper-noun detection.
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Pull the first sentence (or up to TITLE_MAX_CHARS) out of a
 * cleaned body and present it as the headline. We split on .!? and
 * fall back to the whole body if no sentence terminator is found.
 *
 * The trailing period is stripped — a 6-word title like "Coffee
 * with Sarah this morning." reads better as "Coffee with Sarah this
 * morning". We keep ! and ? since they convey tone.
 *
 * If the first sentence is longer than TITLE_MAX_CHARS, we cut at
 * the last word boundary that fits and add an ellipsis. This keeps
 * the title on one line in the draft form without slicing mid-word.
 */
export function extractTitle(cleanedBody: string): string {
  if (!cleanedBody) return "";
  const firstSentenceMatch = cleanedBody.match(/^[^.!?]+[.!?]?/);
  let candidate = firstSentenceMatch ? firstSentenceMatch[0].trim() : cleanedBody;
  // Drop trailing period (but preserve ! / ?)
  candidate = candidate.replace(/\.$/, "");
  if (candidate.length <= TITLE_MAX_CHARS) return candidate;
  const slice = candidate.slice(0, TITLE_MAX_CHARS);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd() + "…";
}

/**
 * Suggest tags by keyword match. Word-bounded, case-insensitive,
 * de-duplicated, capped at TAG_MAX. Returns tags in the canonical
 * pool order (so the chip row stays visually stable across calls)
 * not in match-order, so a transcript that happens to mention "work"
 * before "idea" still renders the chips in the same left-to-right
 * order as a transcript that mentions them in reverse.
 */
export function extractTags(transcript: string): VoiceSuggestedTag[] {
  if (!transcript) return [];
  const lower = transcript.toLowerCase();
  const matched = new Set<VoiceSuggestedTag>();
  for (const tag of VOICE_SUGGESTED_TAGS_POOL) {
    const keywords = TAG_KEYWORDS[tag];
    for (const kw of keywords) {
      // For multi-word phrases, use plain includes (still
      // case-insensitive because both sides are lowered). For
      // single words, require word boundaries so "running" matches
      // but "scrumming" does not pick up "run".
      const isPhrase = kw.includes(" ");
      if (isPhrase) {
        if (lower.includes(kw)) {
          matched.add(tag);
          break;
        }
      } else {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(String.raw`\b` + escaped + String.raw`\b`, "i");
        if (re.test(lower)) {
          matched.add(tag);
          break;
        }
      }
    }
    if (matched.size >= TAG_MAX) break;
  }
  return VOICE_SUGGESTED_TAGS_POOL.filter((t) => matched.has(t)).slice(0, TAG_MAX);
}

/**
 * Heuristic person extractor. Two passes:
 *   1. Relation cues: "called X", "with X", "X said", "X told me",
 *      "saw X", "talked to X" — captures the immediately following
 *      capitalized token (and an optional second capitalized token
 *      so two-word names like "Sarah Chen" land intact).
 *   2. Bare proper-noun pass: any capitalized word not in
 *      `NON_NAME_CAPITALS` and not at sentence start as the only
 *      capital. This is intentionally conservative — false-positive
 *      names get filtered later, and the user can dismiss any chip
 *      they don't like.
 *
 * De-duplicated case-insensitively (so "Sarah" and "sarah" don't
 * both appear), preserves first-seen casing, capped at PEOPLE_MAX.
 */
export function extractPeople(transcript: string): string[] {
  if (!transcript) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const cleaned = name.trim().replace(/[.,!?;:]+$/, "");
    if (!cleaned) return;
    if (NON_NAME_CAPITALS.has(cleaned)) return;
    if (cleaned.length < 2) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(cleaned);
  };

  // Pass 1 — relation cues. The capture group greedily takes one or
  // two capitalized tokens so two-word names land in one match.
  const cuePatterns = [
    /\b(?:called|met|saw|with|to|and|told|texted|asked|spoke to|spoke with|talked to|talked with|hung out with|catch up with)\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)?)/g,
    /\b([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)?)\s+(?:said|told me|asked|texted|called|mentioned)\b/g,
  ];
  for (const re of cuePatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(transcript)) !== null) {
      push(m[1]);
      if (found.length >= PEOPLE_MAX) return found;
    }
  }

  // Pass 2 — bare capitalized words (skipping sentence-initial
  // position, which is too noisy). We split on sentence boundaries
  // and look at every word from index 1 onward in each sentence.
  const sentences = transcript.split(/[.!?]+/);
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    for (let i = 1; i < words.length; i += 1) {
      const w = words[i].replace(/[.,!?;:]+$/, "");
      if (/^[A-Z][a-zA-Z'’-]+$/.test(w)) {
        push(w);
        if (found.length >= PEOPLE_MAX) return found;
      }
    }
  }

  return found;
}

/**
 * Detect dominant emotional tone via lexicon scoring. Each tone gets
 * a score = number of distinct keywords from its lexicon that
 * appear in the transcript. The highest score wins; ties resolve
 * to the earlier tone in `EMOTIONAL_TONES` (intensity-ordered).
 *
 * If no keyword from any lexicon matches, returns "neutral" — the
 * user can swap the chip on the draft if they disagree.
 */
export function extractTone(transcript: string): EmotionalTone {
  if (!transcript) return "neutral";
  const lower = transcript.toLowerCase();
  let best: EmotionalTone = "neutral";
  let bestScore = 0;
  for (const tone of EMOTIONAL_TONES) {
    if (tone === "neutral") continue;
    const keywords = TONE_KEYWORDS[tone];
    let score = 0;
    for (const kw of keywords) {
      const isPhrase = kw.includes(" ");
      if (isPhrase) {
        if (lower.includes(kw)) score += 1;
      } else {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(String.raw`\b` + escaped + String.raw`\b`, "i");
        if (re.test(lower)) score += 1;
      }
    }
    if (score > bestScore) {
      best = tone;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Top-level: turn a raw spoken transcript into a structured draft
 * the user can edit + save. Composes the helpers above and is the
 * function the on-device fallback returns from `lib/voiceCapture.ts`.
 *
 * The Foundation Models native module path (when present) returns
 * its own `StructuredMemoryDraft` directly and bypasses this helper
 * — but their shapes match so the screen can't tell which path
 * produced the draft.
 */
export function extractStructuredMemory(rawTranscript: string): StructuredMemoryDraft {
  const body = cleanTranscript(rawTranscript);
  if (!body) {
    return {
      title: "",
      body: "",
      tags: [],
      people: [],
      tone: "neutral",
      isEmpty: true,
    };
  }
  return {
    title: extractTitle(body),
    body,
    tags: extractTags(body),
    people: extractPeople(body),
    tone: extractTone(body),
    isEmpty: false,
  };
}
