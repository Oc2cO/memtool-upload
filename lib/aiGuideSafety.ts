/**
 * Mem AI Guide — client-side safety mirror.
 *
 * This file is the *defense-in-depth* twin of the hardened Polsia
 * brain (Task #70). The brain owns the canonical two-layer safety
 * pipeline (keyword + indirect-phrasing list, then model-based
 * moderation) and the crisis-care template. We mirror layer 1 and
 * the template here so the chat UI can:
 *
 *   1. Short-circuit to the crisis-care surface BEFORE the network
 *      round-trip (faster, calmer, never shows a typing indicator
 *      for a message that should be intercepted).
 *   2. Keep working offline. If the device has no signal, the user
 *      still sees the calm template + resources.
 *
 * The brain is the source of truth. If the brain ever updates its
 * fixture list, this file MUST be updated to match. The shared
 * fixture phrasings (direct + indirect + safe lookalikes) live in
 * `CRISIS_FIXTURES_DIRECT` / `CRISIS_FIXTURES_INDIRECT` /
 * `SAFE_FIXTURE_LOOKALIKES` below so backend and client tests can
 * assert against the same set.
 *
 * The wrapper #63 will build (`lib/aiGuide.ts`) is required to call
 * `detectCrisisSignal(message)` on the outbound user message and,
 * if it returns non-null, render `CRISIS_CARE_COPY` inline and skip
 * the POST to `/api/memtool/ai-guide/*`.
 *
 * TODO(localize): English-only for v1. When we add other locales,
 * each locale needs its own crisis pattern set + resources block.
 */

export type CrisisSignal = {
  /** Why we tripped — useful for analytics + tests, never shown. */
  reason: "direct" | "indirect";
  /** The matched phrase for debugging/QA — never surfaced to the user. */
  matched: string;
};

/**
 * Direct phrasings — explicit references to suicide / self-harm.
 * Matched with word-boundary regexes so "kill myself" trips but
 * "I'd kill for pizza" does not.
 */
const DIRECT_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bkill(?:ing)?\s+myself\b/i, label: "kill myself" },
  { pattern: /\bkill\s+me\s+now\b/i, label: "kill me now" },
  {
    // "suicide" / "suicidal" — exclude sports usage ("suicide squeeze",
    // "suicide pass") that is unrelated to self-harm.
    pattern: /\bsuicid(?:e|al)\b(?!\s+(?:squeeze|pass|sprint|drill|run))/i,
    label: "suicide/suicidal",
  },
  {
    // "want to die" — but NOT "die laughing", "die for X", "die trying",
    // "die of laughter".
    pattern:
      /\b(?:want|wanted|wanna|going|gonna|need|needed)\s+to\s+die\b(?!\s+(?:laughing|for\b|trying|of\s+(?:laughter|embarrassment|happiness)))/i,
    label: "want to die",
  },
  { pattern: /\bend\s+my\s+life\b/i, label: "end my life" },
  { pattern: /\bend\s+it\s+all\b/i, label: "end it all" },
  { pattern: /\btake\s+my\s+(?:own\s+)?life\b/i, label: "take my life" },
  { pattern: /\bhurt(?:ing)?\s+myself\b/i, label: "hurt myself" },
  {
    pattern: /\bharm(?:ing)?\s+myself\b/i,
    label: "harm myself",
  },
  {
    pattern: /\b(?:cut|cutting)\s+myself\b/i,
    label: "cut myself",
  },
  { pattern: /\bself[-\s]?harm\b/i, label: "self-harm" },
];

/**
 * Indirect phrasings — the way people actually talk about distress.
 * These are the dangerous misses for keyword-only systems.
 *
 * Each pattern is tightened with negative lookahead / explicit
 * objects so safe lookalikes ("I'm done with this puzzle") do not
 * trip. Coverage is asserted by the fixture matrix in
 * `aiGuideSafety.test.ts`.
 */
const INDIRECT_PATTERNS: { pattern: RegExp; label: string }[] = [
  {
    // "I don't want to wake up" / "I don't want to be here" /
    // "I don't want to be alive" / "I don't want to live"
    pattern:
      /\bdon'?t\s+want\s+to\s+(?:wake\s+up|be\s+here|be\s+alive|live|exist)\b/i,
    label: "don't want to wake up / be here / live",
  },
  {
    // "everyone would be better off without me", "they'd be better off without me"
    pattern: /\bbetter\s+off\s+without\s+me\b/i,
    label: "better off without me",
  },
  {
    // Guard "I'm done" so it ONLY trips when standalone — not
    // "I'm done with this puzzle / at the gym / for the day / eating".
    pattern:
      /\bi'?m\s+(?:just\s+|so\s+|totally\s+|completely\s+|absolutely\s+)?done\b(?!\s+(?:with|at|for|eating|cooking|working|playing|talking|reading|writing|cleaning|now\b|today\b|here\b|after\b))/i,
    label: "I'm done",
  },
  {
    pattern: /\bcan'?t\s+keep\s+going\b/i,
    label: "can't keep going",
  },
  {
    pattern: /\bcan'?t\s+(?:do|take)\s+(?:it|this)\s+anymore\b/i,
    label: "can't do/take this anymore",
  },
  {
    pattern: /\bcan'?t\s+go\s+on\b/i,
    label: "can't go on",
  },
  {
    // "want to disappear" / "want to vanish" — but not "want to disappear into the crowd"
    pattern: /\bwant\s+to\s+(?:disappear|vanish)\b(?!\s+into\b)/i,
    label: "want to disappear",
  },
  {
    pattern: /\b(?:no|not\s+any)\s+(?:point|reason)\s+(?:in\s+living|to\s+live|to\s+keep\s+going|anymore)\b/i,
    label: "no point/reason to live",
  },
  {
    pattern: /\bnothing\s+(?:matters|to\s+live\s+for)\b/i,
    label: "nothing matters / nothing to live for",
  },
  {
    pattern: /\bi\s+give\s+up\s+on\s+(?:life|everything|myself)\b/i,
    label: "give up on life",
  },
  {
    pattern: /\bfeel(?:ing)?\s+hopeless\b/i,
    label: "feeling hopeless",
  },
  {
    pattern: /\b(?:there'?s|there\s+is)\s+no\s+hope\b/i,
    label: "no hope",
  },
];

/**
 * Detect a crisis signal in an outbound user message.
 *
 * Returns the matched signal (with the reason + the matched phrase
 * label for analytics) or null. The chat wrapper MUST call this on
 * every user-authored message before POSTing to the brain.
 */
export function detectCrisisSignal(text: string): CrisisSignal | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  for (const { pattern, label } of DIRECT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { reason: "direct", matched: label };
    }
  }
  for (const { pattern, label } of INDIRECT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { reason: "indirect", matched: label };
    }
  }
  return null;
}

/**
 * Crisis-care reply. Calm, non-clinical, surfaces concrete
 * resources + a clear reminder that Mem is not a therapist.
 *
 * This template is content-reviewed once (Task #70) and stored as
 * a constant — never generated per-call by the model.
 *
 * Mirrored verbatim on the brain so client and server render the
 * same words whether we short-circuit locally or the brain layer 1
 * trips after a network round-trip.
 */
export const CRISIS_CARE_COPY = {
  /** The single, calm reply rendered in place of a model response. */
  message:
    "I hear you, and I'm really glad you told me. I'm not a therapist — I'm just Mem — and what you're carrying sounds like it deserves a real person on the other end of it.\n\nIf you're in the US, you can call or text 988 (Suicide & Crisis Lifeline) any time, day or night. In the UK and Ireland, Samaritans answer at 116 123. And if there's someone in your life you trust — even a little — reaching out to them tonight is a good next step.\n\nI'm here too, whenever you want to come back.",
  resources: [
    {
      label: "988 Suicide & Crisis Lifeline (US)",
      detail: "Call or text 988",
      href: "tel:988",
    },
    {
      label: "Samaritans (UK & Ireland)",
      detail: "Call 116 123, free, 24/7",
      href: "tel:116123",
    },
    {
      label: "Talk to someone you trust",
      detail: "A friend, a family member, a colleague — tonight if you can.",
      href: null,
    },
  ],
  /**
   * Shown as a small footnote under the message. Reinforces the
   * "Mem is not a therapist" framing the App Store and our own
   * trust posture both require.
   */
  disclaimer:
    "Mem is a memory companion, not a mental health service. In an emergency, call your local emergency number.",
} as const;

/**
 * Shared fixture phrasings — used by both `aiGuideSafety.test.ts`
 * (this client mirror) and the Polsia brain's regression suite.
 *
 * Editing these lists IS editing the contract. Do not remove a
 * phrasing without explicit sign-off; only add.
 */
export const CRISIS_FIXTURES_DIRECT: readonly string[] = [
  "I want to die",
  "I'm going to kill myself tonight",
  "thinking about suicide again",
  "I'm suicidal",
  "I want to end my life",
  "I want to end it all",
  "I've been hurting myself",
  "I cut myself last night",
  "I need to take my own life",
] as const;

export const CRISIS_FIXTURES_INDIRECT: readonly string[] = [
  "I don't want to wake up tomorrow",
  "I don't want to be here anymore",
  "I don't want to live like this",
  "everyone would be better off without me",
  "they'd be better off without me honestly",
  "I'm done.",
  "I'm just done",
  "I can't keep going",
  "I can't do this anymore",
  "I can't go on",
  "I want to disappear",
  "I want to vanish",
  "there's no point in living",
  "no reason to keep going",
  "nothing matters anymore",
  "I give up on life",
  "I feel hopeless",
  "there's no hope left",
] as const;

/**
 * Safe lookalikes — phrases that contain crisis-adjacent words but
 * are NOT distress signals. Tests assert these return null so we
 * don't render the crisis-care surface over a board game or a
 * workout.
 */
export const SAFE_FIXTURE_LOOKALIKES: readonly string[] = [
  "I'm done with this puzzle",
  "I'm done at the gym, heading home",
  "I'm done for the day, see you tomorrow",
  "I'm done eating, that was great",
  "I'd kill for some pizza right now",
  "this homework is killing me",
  "I'm dying of laughter",
  "I want to die laughing at this meme",
  "my phone died",
  "I want to disappear into the crowd at the show",
  "I can't take this hot weather anymore — turning the AC on",
  "I'm going to end it — the meeting, that is",
  "the suicide squeeze in baseball is wild",
  "no point arguing about pineapple on pizza",
  "she's a hopeless romantic",
] as const;
