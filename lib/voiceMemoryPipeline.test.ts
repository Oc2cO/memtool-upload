import {
  cleanTranscript,
  extractPeople,
  extractStructuredMemory,
  extractTags,
  extractTitle,
  extractTone,
  PEOPLE_MAX,
  TAG_MAX,
  TITLE_MAX_CHARS,
  VOICE_SUGGESTED_TAGS_POOL,
} from "./voiceMemoryPipeline";

describe("cleanTranscript", () => {
  it("returns empty string for empty / whitespace input", () => {
    expect(cleanTranscript("")).toBe("");
    expect(cleanTranscript("   ")).toBe("");
    expect(cleanTranscript("\n\t  \n")).toBe("");
  });

  it("strips standalone single-word fillers but leaves 'like coffee' alone", () => {
    const out = cleanTranscript("um I really, uh, like coffee");
    // "like" inside "I like coffee" must stay — it's a verb here,
    // not a filler. Only the standalone "um" and "uh" should drop.
    expect(out.toLowerCase()).toContain("like coffee");
    expect(out.toLowerCase()).not.toContain(" um ");
    expect(out.toLowerCase()).not.toContain(" uh ");
  });

  it("strips multi-word fillers and reflows punctuation", () => {
    const out = cleanTranscript("Well, you know, it was a long day");
    // "you know," should disappear; the surrounding "Well," and the
    // sentence body should remain readable. We don't pin exact
    // punctuation because the cleanup may collapse the comma — what
    // matters is the filler is gone and the real words survive.
    expect(out.toLowerCase()).not.toContain("you know");
    expect(out).toMatch(/Well/);
    expect(out).toMatch(/long day/);
  });

  it("collapses runs of whitespace", () => {
    expect(cleanTranscript("hello    world")).toBe("Hello world");
    expect(cleanTranscript("  hello\n\nworld  ")).toBe("Hello world");
  });

  it("capitalizes the first character of the cleaned body", () => {
    expect(cleanTranscript("today was good")).toBe("Today was good");
  });

  it("returns empty when the transcript was nothing but fillers", () => {
    expect(cleanTranscript("um uh um, you know, uhh")).toBe("");
  });
});

describe("extractTitle", () => {
  it("uses the first sentence and strips a trailing period", () => {
    expect(extractTitle("Coffee with Sarah this morning. It was great.")).toBe(
      "Coffee with Sarah this morning",
    );
  });

  it("preserves ! and ? as part of the headline", () => {
    expect(extractTitle("Got the promotion! Cannot believe it.")).toBe(
      "Got the promotion!",
    );
    expect(extractTitle("Should I take the job? Need to think.")).toBe(
      "Should I take the job?",
    );
  });

  it("falls back to the whole body when no sentence terminator exists", () => {
    expect(extractTitle("Quick note about the meeting tomorrow")).toBe(
      "Quick note about the meeting tomorrow",
    );
  });

  it("truncates over-long sentences at a word boundary with ellipsis", () => {
    const long = "A".repeat(80);
    const title = extractTitle(long);
    // No spaces inside, so we fall back to the hard slice — verify
    // the length cap is honored either way.
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX_CHARS + 1);

    const longWithSpaces =
      "This is a really long opening sentence that keeps going past the title limit and then some more words after that";
    const t2 = extractTitle(longWithSpaces);
    expect(t2.length).toBeLessThanOrEqual(TITLE_MAX_CHARS + 1);
    expect(t2.endsWith("…")).toBe(true);
    // No mid-word cut: the part before the ellipsis ends on a real word.
    expect(t2.replace("…", "").trim().split(" ").pop()).toMatch(/^[a-zA-Z]+$/);
  });

  it("returns empty for empty input", () => {
    expect(extractTitle("")).toBe("");
  });
});

describe("extractTags", () => {
  it("matches the canonical pool by keyword", () => {
    const tags = extractTags("I went to the gym after the standup with my boss");
    expect(tags).toContain("health");
    expect(tags).toContain("work");
  });

  it("returns tags in the canonical pool order, not match order", () => {
    // Pool order is: social, work, health, idea, errand, call, reflection.
    // This transcript triggers reflection, idea, work — but the
    // result must come back ordered work, idea, reflection.
    const tags = extractTags(
      "I felt grateful and had an idea about a work project",
    );
    const expected = ["work", "idea", "reflection"];
    expect(tags).toEqual(expected);
  });

  it("does not double-suggest a tag if multiple keywords match", () => {
    const tags = extractTags("Gym, then a run, then yoga");
    expect(tags.filter((t) => t === "health").length).toBe(1);
  });

  it("respects word boundaries (no false-positive substrings)", () => {
    // "scrumming" must not match the "run" keyword for `health`.
    const tags = extractTags("just scrumming around in the codebase");
    expect(tags).not.toContain("health");
  });

  it("caps at TAG_MAX", () => {
    // Sanity check — even a transcript that hits every pool entry
    // can't exceed the cap. (The pool is currently 7 long but the
    // cap could be tightened in future.)
    const tags = extractTags(
      "called my friend at the gym about a work idea then ran an errand and had a quiet reflection",
    );
    expect(tags.length).toBeLessThanOrEqual(TAG_MAX);
  });

  it("returns empty for empty input", () => {
    expect(extractTags("")).toEqual([]);
  });
});

describe("extractPeople", () => {
  it("picks up names after relation cues", () => {
    expect(extractPeople("I called Sarah this morning")).toContain("Sarah");
    expect(extractPeople("Met with David at lunch")).toContain("David");
    expect(extractPeople("Spoke to Priya about the project")).toContain("Priya");
  });

  it("captures two-word names in one chip", () => {
    const people = extractPeople("Hung out with Sarah Chen and her dog");
    expect(people).toContain("Sarah Chen");
  });

  it("filters out weekday names, months, and common interjections", () => {
    const people = extractPeople(
      "Tuesday I called Sarah. Today was a good day.",
    );
    expect(people).toContain("Sarah");
    expect(people).not.toContain("Tuesday");
    expect(people).not.toContain("Today");
  });

  it("de-duplicates case-insensitively", () => {
    const people = extractPeople(
      "Sarah said hi. Then Sarah told me about the trip. SARAH was excited.",
    );
    expect(people.filter((p) => p.toLowerCase() === "sarah").length).toBe(1);
  });

  it("respects PEOPLE_MAX cap", () => {
    const people = extractPeople(
      "I called Alice and Bob and Carol and Dave and Eve and Frank and Grace",
    );
    expect(people.length).toBeLessThanOrEqual(PEOPLE_MAX);
  });

  it("returns empty when the transcript has no plausible names", () => {
    expect(extractPeople("today was a good day at the gym")).toEqual([]);
  });
});

describe("extractTone", () => {
  it("detects happy", () => {
    expect(extractTone("I'm so happy and grateful today")).toBe("happy");
  });

  it("detects anxious", () => {
    expect(extractTone("I'm worried and stressed about the deadline")).toBe(
      "anxious",
    );
  });

  it("detects excited over happy when both keywords appear", () => {
    // EMOTIONAL_TONES order resolves ties: excited > happy. This
    // transcript scores 1 for excited and 1 for happy; excited wins.
    expect(extractTone("I'm thrilled and happy")).toBe("excited");
  });

  it("returns neutral when no lexicon matches", () => {
    expect(extractTone("Bought milk and eggs at the store")).toBe("neutral");
  });

  it("returns neutral for empty input", () => {
    expect(extractTone("")).toBe("neutral");
  });
});

describe("extractStructuredMemory (composition)", () => {
  it("turns a realistic ramble into a clean draft", () => {
    const draft = extractStructuredMemory(
      "um so today I called Sarah about the new project at work, and I'm really excited because, you know, it could be a big deal",
    );
    expect(draft.isEmpty).toBe(false);
    // Title comes from the first sentence of the cleaned body.
    expect(draft.title.length).toBeGreaterThan(0);
    expect(draft.title).not.toMatch(/\bum\b/i);
    // Body is cleaned but still substantive.
    expect(draft.body).not.toMatch(/\bum\b/i);
    expect(draft.body).not.toMatch(/you know/i);
    expect(draft.body.toLowerCase()).toContain("sarah");
    // Tags + people + tone all populated.
    expect(draft.tags).toContain("work");
    expect(draft.tags).toContain("call");
    expect(draft.people).toContain("Sarah");
    expect(draft.tone).toBe("excited");
  });

  it("flags an empty transcript with isEmpty: true", () => {
    const draft = extractStructuredMemory("um uh, you know");
    expect(draft.isEmpty).toBe(true);
    expect(draft.title).toBe("");
    expect(draft.body).toBe("");
    expect(draft.tags).toEqual([]);
    expect(draft.people).toEqual([]);
    expect(draft.tone).toBe("neutral");
  });

  it("keeps the canonical tag pool exposed for the screen to import", () => {
    // Defense against an accidental rename — the screen wires its
    // chip pool from this constant, so any change here is a UI
    // change.
    expect(VOICE_SUGGESTED_TAGS_POOL).toEqual([
      "social",
      "work",
      "health",
      "idea",
      "errand",
      "call",
      "reflection",
    ]);
  });
});
