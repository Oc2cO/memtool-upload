import {
  CRISIS_CARE_COPY,
  CRISIS_FIXTURES_DIRECT,
  CRISIS_FIXTURES_INDIRECT,
  SAFE_FIXTURE_LOOKALIKES,
  detectCrisisSignal,
} from "./aiGuideSafety";

describe("detectCrisisSignal — direct fixtures", () => {
  test.each(CRISIS_FIXTURES_DIRECT)(
    "trips on direct phrasing: %s",
    (phrase) => {
      const signal = detectCrisisSignal(phrase);
      expect(signal).not.toBeNull();
      expect(signal?.reason).toBe("direct");
    },
  );
});

describe("detectCrisisSignal — indirect fixtures", () => {
  test.each(CRISIS_FIXTURES_INDIRECT)(
    "trips on indirect phrasing: %s",
    (phrase) => {
      const signal = detectCrisisSignal(phrase);
      expect(signal).not.toBeNull();
      expect(signal?.reason).toBe("indirect");
    },
  );
});

describe("detectCrisisSignal — safe lookalikes do NOT trip", () => {
  test.each(SAFE_FIXTURE_LOOKALIKES)("ignores safe phrasing: %s", (phrase) => {
    const signal = detectCrisisSignal(phrase);
    expect(signal).toBeNull();
  });
});

describe("detectCrisisSignal — edge cases", () => {
  test("empty string returns null", () => {
    expect(detectCrisisSignal("")).toBeNull();
  });

  test("whitespace-only returns null", () => {
    expect(detectCrisisSignal("   \n  \t ")).toBeNull();
  });

  test("benign greeting returns null", () => {
    expect(detectCrisisSignal("hey Mem, just saying hi")).toBeNull();
  });

  test("benign memory note returns null", () => {
    expect(
      detectCrisisSignal("had coffee with Sam, talked about the new job"),
    ).toBeNull();
  });

  test("case-insensitive — matches uppercase", () => {
    expect(detectCrisisSignal("I WANT TO DIE")).not.toBeNull();
  });

  test("respects punctuation around 'I'm done'", () => {
    expect(detectCrisisSignal("I'm done.")?.reason).toBe("indirect");
    expect(detectCrisisSignal("I'm done with this puzzle")).toBeNull();
  });

  test("returns the matched label for analytics/QA", () => {
    const signal = detectCrisisSignal("I want to disappear");
    expect(signal?.matched).toBe("want to disappear");
  });
});

describe("CRISIS_CARE_COPY — content review", () => {
  test("is calm, non-clinical, and surfaces the canonical resources", () => {
    expect(CRISIS_CARE_COPY.message).toMatch(/988/);
    expect(CRISIS_CARE_COPY.message).toMatch(/Samaritans/);
    expect(CRISIS_CARE_COPY.message).toMatch(/116\s?123/);
    expect(CRISIS_CARE_COPY.message).toMatch(/trust/i);
    // Non-therapist disclaimer is mandatory in both the message and
    // the footnote disclaimer.
    expect(CRISIS_CARE_COPY.message).toMatch(/not a therapist/i);
    expect(CRISIS_CARE_COPY.disclaimer).toMatch(/not a mental health/i);
  });

  test("ships at least three concrete resources", () => {
    expect(CRISIS_CARE_COPY.resources.length).toBeGreaterThanOrEqual(3);
    for (const r of CRISIS_CARE_COPY.resources) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.detail.length).toBeGreaterThan(0);
    }
  });

  test("includes a dial-able 988 link", () => {
    const has988 = CRISIS_CARE_COPY.resources.some(
      (r) => r.href === "tel:988",
    );
    expect(has988).toBe(true);
  });

  test("includes Samaritans line", () => {
    const hasSamaritans = CRISIS_CARE_COPY.resources.some((r) =>
      /Samaritans/i.test(r.label),
    );
    expect(hasSamaritans).toBe(true);
  });

  test("language does NOT imply Mem is conscious / a person", () => {
    const banned = [
      /\bI\s+(?:feel|am\s+feeling|understand\s+like\s+a\s+human)\b/i,
      /\bI'?m\s+alive\b/i,
      /\bself[-\s]?aware\b/i,
      /\bconscious\b/i,
    ];
    for (const pat of banned) {
      expect(CRISIS_CARE_COPY.message).not.toMatch(pat);
      expect(CRISIS_CARE_COPY.disclaimer).not.toMatch(pat);
    }
  });
});
