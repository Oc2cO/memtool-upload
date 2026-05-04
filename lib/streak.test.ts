import {
  aiGuideStreakOpener,
  aiGuideStreakOpenerKey,
  canRecoverToday,
  flameIntensity,
  milestoneCopy,
  pendingMilestone,
  recapStreakLine,
  recoveryCopy,
  type StreakConfig,
  type StreakSnapshot,
} from "./streak";

const DEFAULT_CONFIG: StreakConfig = {
  milestones: [3, 7, 14, 30, 60, 100],
  freeMonthlyFreezes: 1,
  monthlyFreezeAllowance: 1,
  maxFreezeStockpile: 5,
  recoveryWindowDays: 1,
};

function snapshot(over: Partial<StreakSnapshot> = {}): StreakSnapshot {
  return {
    current: 0,
    longest: 0,
    lastCountedDay: null,
    freezesAvailable: 0,
    lastMilestone: 0,
    pendingRecoveryFor: null,
    ...over,
  };
}

describe("pendingMilestone", () => {
  it("returns null when nothing is crossed", () => {
    expect(pendingMilestone(snapshot({ current: 2, lastMilestone: 0 }))).toBe(null);
  });
  it("returns the milestone when the current matches and is unseen", () => {
    expect(pendingMilestone(snapshot({ current: 3, lastMilestone: 0 }))).toBe(3);
    expect(pendingMilestone(snapshot({ current: 7, lastMilestone: 3 }))).toBe(7);
  });
  it("returns null when the milestone has already been seen", () => {
    expect(pendingMilestone(snapshot({ current: 3, lastMilestone: 3 }))).toBe(null);
  });
  it("picks the biggest unseen milestone when several are crossed at once", () => {
    expect(pendingMilestone(snapshot({ current: 30, lastMilestone: 0 }))).toBe(30);
    expect(pendingMilestone(snapshot({ current: 100, lastMilestone: 14 }))).toBe(100);
  });
});

describe("flameIntensity", () => {
  it("is 0 when today's capture is already in", () => {
    expect(flameIntensity("2026-05-03", "2026-05-03", 23)).toBe(0);
  });
  it("is 0 in the morning even when today is empty", () => {
    expect(flameIntensity("2026-05-02", "2026-05-03", 9)).toBe(0);
    expect(flameIntensity(null, "2026-05-03", 14)).toBe(0);
  });
  it("ramps up gently in the evening", () => {
    expect(flameIntensity("2026-05-02", "2026-05-03", 18)).toBe(0.35);
    expect(flameIntensity("2026-05-02", "2026-05-03", 21)).toBe(0.65);
    expect(flameIntensity("2026-05-02", "2026-05-03", 23)).toBe(1);
  });
});

describe("canRecoverToday", () => {
  it("is true when an offer exists and current is still 1", () => {
    expect(
      canRecoverToday(
        snapshot({ pendingRecoveryFor: "2026-05-02", current: 1 }),
        "2026-05-03",
      ),
    ).toBe(true);
  });
  it("is false when the offer is gone", () => {
    expect(
      canRecoverToday(
        snapshot({ pendingRecoveryFor: null, current: 1 }),
        "2026-05-03",
      ),
    ).toBe(false);
  });
});

describe("milestoneCopy", () => {
  it("has caring, non-punitive copy for every documented milestone", () => {
    for (const m of [3, 7, 14, 30, 60, 100]) {
      const c = milestoneCopy(m);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.body.length).toBeGreaterThan(0);
      // Brand guard: the copy must NEVER use shame-shaped words.
      const blob = `${c.title} ${c.body}`.toLowerCase();
      for (const banned of ["fail", "lost", "broken", "punish", "shame", "behind"]) {
        expect(blob).not.toContain(banned);
      }
    }
  });
  it("falls back gracefully for unrecognized milestones", () => {
    const c = milestoneCopy(42);
    expect(c.title).toContain("42");
  });
});

describe("recoveryCopy", () => {
  it("never shames the user", () => {
    const c = recoveryCopy();
    const blob = `${c.title} ${c.body} ${c.cta}`.toLowerCase();
    for (const banned of ["fail", "lost", "broken", "punish", "shame"]) {
      expect(blob).not.toContain(banned);
    }
    expect(c.cta.length).toBeGreaterThan(0);
  });
});

describe("aiGuideStreakOpener", () => {
  it("returns null when there's nothing to acknowledge", () => {
    // Captured today, no milestone pending — quiet.
    expect(
      aiGuideStreakOpener(
        snapshot({ current: 4, lastCountedDay: "2026-05-03", lastMilestone: 3 }),
        DEFAULT_CONFIG,
        "2026-05-03",
        20,
      ),
    ).toBeNull();
  });
  it("celebrates a freshly crossed milestone", () => {
    const opener = aiGuideStreakOpener(
      snapshot({ current: 7, lastCountedDay: "2026-05-03", lastMilestone: 3 }),
      DEFAULT_CONFIG,
      "2026-05-03",
      10,
    );
    expect(opener).not.toBeNull();
    expect(opener!.toLowerCase()).toContain("week");
  });
  it("nudges gently in the evening when today is still empty", () => {
    const opener = aiGuideStreakOpener(
      snapshot({ current: 12, lastCountedDay: "2026-05-02", lastMilestone: 7 }),
      DEFAULT_CONFIG,
      "2026-05-03",
      19,
    );
    expect(opener).not.toBeNull();
    expect(opener).toContain("12");
    // Brand guard: never shame on a missed day.
    const lower = opener!.toLowerCase();
    for (const banned of ["fail", "lost", "broken", "miss", "shame"]) {
      expect(lower).not.toContain(banned);
    }
  });
  it("stays quiet in the morning even if today is still empty", () => {
    expect(
      aiGuideStreakOpener(
        snapshot({ current: 5, lastCountedDay: "2026-05-02", lastMilestone: 3 }),
        DEFAULT_CONFIG,
        "2026-05-03",
        9,
      ),
    ).toBeNull();
  });
});

describe("aiGuideStreakOpenerKey", () => {
  it("returns null when no opener would be shown", () => {
    expect(
      aiGuideStreakOpenerKey(
        snapshot({ current: 4, lastCountedDay: "2026-05-03", lastMilestone: 3 }),
        DEFAULT_CONFIG,
        "2026-05-03",
        20,
      ),
    ).toBeNull();
  });
  it("identifies a milestone opener by milestone number", () => {
    expect(
      aiGuideStreakOpenerKey(
        snapshot({ current: 7, lastCountedDay: "2026-05-03", lastMilestone: 3 }),
        DEFAULT_CONFIG,
        "2026-05-03",
        10,
      ),
    ).toBe("m:7");
  });
  it("identifies an at-risk opener by local day", () => {
    expect(
      aiGuideStreakOpenerKey(
        snapshot({ current: 12, lastCountedDay: "2026-05-02", lastMilestone: 7 }),
        DEFAULT_CONFIG,
        "2026-05-03",
        19,
      ),
    ).toBe("r:2026-05-03");
  });
  it("changes key when the local day rolls over", () => {
    const a = aiGuideStreakOpenerKey(
      snapshot({ current: 5, lastCountedDay: "2026-05-02", lastMilestone: 3 }),
      DEFAULT_CONFIG,
      "2026-05-03",
      19,
    );
    const b = aiGuideStreakOpenerKey(
      snapshot({ current: 5, lastCountedDay: "2026-05-03", lastMilestone: 3 }),
      DEFAULT_CONFIG,
      "2026-05-04",
      19,
    );
    expect(a).not.toBe(b);
  });
});

describe("recapStreakLine", () => {
  it("returns null when the streak is zero", () => {
    expect(recapStreakLine(snapshot({ current: 0 }))).toBeNull();
  });
  it("reuses milestone copy when one is pending", () => {
    const line = recapStreakLine(
      snapshot({ current: 7, lastMilestone: 3 }),
    );
    expect(line).not.toBeNull();
    expect(line!.title).toBe(milestoneCopy(7).title);
  });
  it("frames sub-week streaks as showed-up-of-7", () => {
    const line = recapStreakLine(snapshot({ current: 5, lastMilestone: 3 }));
    expect(line).not.toBeNull();
    expect(line!.title).toContain("5");
    expect(line!.body).toContain("5 of the last 7");
  });
  it("uses singular wording for day 1", () => {
    const line = recapStreakLine(snapshot({ current: 1, lastMilestone: 0 }));
    expect(line).not.toBeNull();
    expect(line!.body).toContain("1 of the last 7 day.");
  });
  it("celebrates a full week and beyond", () => {
    const line = recapStreakLine(snapshot({ current: 12, lastMilestone: 7 }));
    expect(line).not.toBeNull();
    expect(line!.title).toContain("12");
    expect(line!.body.toLowerCase()).toContain("every day this week");
  });
});
