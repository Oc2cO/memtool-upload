import {
  DAILY_SELFIE_TAG,
  buildSelfieStrip,
  computeSelfieStreak,
  findSelfieForDay,
  isDailySelfie,
  selfieLateDayNudge,
  selfieLocalDayKey,
  selfieStreakMilestone,
  selfieStreakMilestoneCopy,
} from "./dailySelfie";
import type { Memory } from "./memories";

function mem(partial: Partial<Memory> & { id: string; timestamp: string }): Memory {
  return {
    userId: "u@example.com",
    content: "",
    kind: "memory",
    ...partial,
  } as Memory;
}

describe("dailySelfie", () => {
  it("DAILY_SELFIE_TAG is the literal the capture flow writes", () => {
    expect(DAILY_SELFIE_TAG).toBe("daily-selfie");
  });

  it("isDailySelfie matches case-insensitively and ignores other tags", () => {
    expect(isDailySelfie(mem({ id: "a", timestamp: "2026-05-03T12:00:00Z", tags: ["Daily-Selfie", "x"] }))).toBe(true);
    expect(isDailySelfie(mem({ id: "b", timestamp: "2026-05-03T12:00:00Z", tags: ["selfie"] }))).toBe(false);
    expect(isDailySelfie(mem({ id: "c", timestamp: "2026-05-03T12:00:00Z" }))).toBe(false);
  });

  it("selfieLocalDayKey buckets to the device-local YYYY-MM-DD", () => {
    // Build a date at noon local so DST/timezone nudges can't push
    // it across midnight on either side. Round-trip through Date so
    // the test runs identically wherever Vitest happens to invoke.
    const local = new Date(2026, 4, 3, 12, 0, 0, 0); // May 3, 2026 noon
    expect(selfieLocalDayKey(local.toISOString())).toBe("2026-05-03");
  });

  it("selfieLocalDayKey returns null on garbage input", () => {
    expect(selfieLocalDayKey("not-a-date")).toBeNull();
  });

  it("findSelfieForDay picks the most-recent selfie for the same local day", () => {
    const earlier = mem({
      id: "e",
      timestamp: new Date(2026, 4, 3, 8, 0, 0).toISOString(),
      tags: ["daily-selfie"],
    });
    const later = mem({
      id: "l",
      timestamp: new Date(2026, 4, 3, 18, 0, 0).toISOString(),
      tags: ["daily-selfie"],
    });
    const otherDay = mem({
      id: "o",
      timestamp: new Date(2026, 4, 2, 9, 0, 0).toISOString(),
      tags: ["daily-selfie"],
    });
    const nonSelfie = mem({
      id: "n",
      timestamp: new Date(2026, 4, 3, 19, 0, 0).toISOString(),
      tags: ["work"],
    });
    const hit = findSelfieForDay([earlier, later, otherDay, nonSelfie], "2026-05-03");
    expect(hit?.id).toBe("l");
  });

  it("findSelfieForDay returns null when no selfie matches", () => {
    expect(
      findSelfieForDay(
        [mem({ id: "x", timestamp: new Date(2026, 4, 1, 9, 0, 0).toISOString(), tags: ["daily-selfie"] })],
        "2026-05-03",
      ),
    ).toBeNull();
  });

  it("buildSelfieStrip returns one cell per local day with present/missed gaps", () => {
    const day1 = mem({
      id: "d1",
      timestamp: new Date(2026, 4, 1, 12, 0, 0).toISOString(),
      tags: ["daily-selfie"],
    });
    // Skip May 2 entirely
    const day3 = mem({
      id: "d3",
      timestamp: new Date(2026, 4, 3, 12, 0, 0).toISOString(),
      tags: ["daily-selfie"],
    });
    const cells = buildSelfieStrip([day1, day3], "2026-05-01", "2026-05-03");
    expect(cells.map((c) => c.date)).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
    expect(cells[0].kind).toBe("present");
    expect(cells[1].kind).toBe("missed");
    expect(cells[2].kind).toBe("present");
    if (cells[0].kind === "present") expect(cells[0].memory.id).toBe("d1");
    if (cells[2].kind === "present") expect(cells[2].memory.id).toBe("d3");
  });

  it("buildSelfieStrip returns empty when end < start", () => {
    expect(buildSelfieStrip([], "2026-05-05", "2026-05-01")).toEqual([]);
  });

  // Timezone-boundary regression: a selfie taken just before local
  // midnight and another just after must NOT collapse to the same
  // local-day bucket. `selfieLocalDayKey` reads the device's local
  // calendar via `getFullYear()/getMonth()/getDate()`, so this
  // mirrors the production gate: even on a DST transition or a
  // user-driven timezone change, two captures bracketing midnight
  // produce two distinct day keys, which is what makes "one selfie
  // per local day" a real per-day invariant rather than a per-24h
  // window approximation.
  it("selfieLocalDayKey buckets across local-midnight boundary", () => {
    const justBefore = new Date(2026, 4, 3, 23, 59, 0);
    const justAfter = new Date(2026, 4, 4, 0, 1, 0);
    expect(selfieLocalDayKey(justBefore.toISOString())).toBe("2026-05-03");
    expect(selfieLocalDayKey(justAfter.toISOString())).toBe("2026-05-04");
  });

  it("findSelfieForDay treats two captures bracketing local midnight as distinct days", () => {
    // Same scenario the on-device replace prompt sees: a user
    // takes a selfie at 23:59 local, the OS rolls past midnight,
    // they open the app again. `findSelfieForDay("2026-05-04")`
    // must return null (the new day has no selfie yet) even
    // though the `23:59` selfie is "less than 2 minutes old".
    const lateNight = mem({
      id: "late",
      timestamp: new Date(2026, 4, 3, 23, 59, 0).toISOString(),
      tags: ["daily-selfie"],
    });
    expect(findSelfieForDay([lateNight], "2026-05-03")?.id).toBe("late");
    expect(findSelfieForDay([lateNight], "2026-05-04")).toBeNull();
  });

  describe("computeSelfieStreak", () => {
    function selfie(id: string, dayLocal: [number, number, number]): Memory {
      const [y, m, d] = dayLocal;
      return mem({
        id,
        timestamp: new Date(y, m - 1, d, 12, 0, 0).toISOString(),
        tags: ["daily-selfie"],
      });
    }

    it("returns zero when no selfies exist", () => {
      expect(computeSelfieStreak([], "2026-05-03")).toEqual({
        current: 0,
        endsOn: null,
        todayCaptured: false,
      });
    });

    it("counts a streak ending today when today is captured", () => {
      const ms = [
        selfie("a", [2026, 5, 1]),
        selfie("b", [2026, 5, 2]),
        selfie("c", [2026, 5, 3]),
      ];
      const r = computeSelfieStreak(ms, "2026-05-03");
      expect(r.current).toBe(3);
      expect(r.endsOn).toBe("2026-05-03");
      expect(r.todayCaptured).toBe(true);
    });

    it("counts a streak ending yesterday when today is missing", () => {
      const ms = [
        selfie("a", [2026, 5, 1]),
        selfie("b", [2026, 5, 2]),
      ];
      const r = computeSelfieStreak(ms, "2026-05-03");
      expect(r.current).toBe(2);
      expect(r.endsOn).toBe("2026-05-02");
      expect(r.todayCaptured).toBe(false);
    });

    it("returns zero when neither today nor yesterday is captured", () => {
      const r = computeSelfieStreak(
        [selfie("a", [2026, 4, 28])],
        "2026-05-03",
      );
      expect(r.current).toBe(0);
      expect(r.endsOn).toBe(null);
    });

    it("ignores non-selfie memories", () => {
      const ms = [
        mem({
          id: "x",
          timestamp: new Date(2026, 4, 3, 12, 0, 0).toISOString(),
          tags: ["work"],
        }),
      ];
      expect(computeSelfieStreak(ms, "2026-05-03").current).toBe(0);
    });

    it("collapses two same-day selfies into one streak day", () => {
      const ms = [
        selfie("a", [2026, 5, 3]),
        mem({
          id: "b",
          timestamp: new Date(2026, 4, 3, 18, 0, 0).toISOString(),
          tags: ["daily-selfie"],
        }),
      ];
      expect(computeSelfieStreak(ms, "2026-05-03").current).toBe(1);
    });
  });

  describe("selfieStreakMilestone", () => {
    it("returns the milestone exactly when current matches", () => {
      expect(
        selfieStreakMilestone({ current: 7, endsOn: "x", todayCaptured: true }),
      ).toBe(7);
      expect(
        selfieStreakMilestone({ current: 30, endsOn: "x", todayCaptured: true }),
      ).toBe(30);
      expect(
        selfieStreakMilestone({ current: 100, endsOn: "x", todayCaptured: true }),
      ).toBe(100);
    });

    it("returns null off-milestone or at zero", () => {
      expect(
        selfieStreakMilestone({ current: 6, endsOn: "x", todayCaptured: true }),
      ).toBeNull();
      expect(
        selfieStreakMilestone({ current: 0, endsOn: null, todayCaptured: false }),
      ).toBeNull();
    });

    it("milestone copy covers each celebrated day", () => {
      for (const m of [7, 30, 100]) {
        const c = selfieStreakMilestoneCopy(m);
        expect(c.title.length).toBeGreaterThan(0);
        expect(c.body.length).toBeGreaterThan(0);
      }
    });
  });

  describe("selfieLateDayNudge", () => {
    it("returns null when today is captured", () => {
      expect(
        selfieLateDayNudge(
          { current: 5, endsOn: "2026-05-03", todayCaptured: true },
          21,
        ),
      ).toBeNull();
    });

    it("returns null in the morning even on a live streak", () => {
      expect(
        selfieLateDayNudge(
          { current: 5, endsOn: "2026-05-02", todayCaptured: false },
          10,
        ),
      ).toBeNull();
    });

    it("returns null when there's no streak yet", () => {
      expect(
        selfieLateDayNudge(
          { current: 0, endsOn: null, todayCaptured: false },
          21,
        ),
      ).toBeNull();
    });

    it("nudges in the evening on a live streak", () => {
      const out = selfieLateDayNudge(
        { current: 5, endsOn: "2026-05-02", todayCaptured: false },
        18,
      );
      expect(out).not.toBeNull();
      expect(out).toContain("Day 5");
    });
  });

  it("buildSelfieStrip ignores non-selfie memories", () => {
    const cells = buildSelfieStrip(
      [
        mem({
          id: "p",
          timestamp: new Date(2026, 4, 1, 12, 0, 0).toISOString(),
          tags: ["work"],
        }),
      ],
      "2026-05-01",
      "2026-05-01",
    );
    expect(cells).toEqual([{ date: "2026-05-01", kind: "missed" }]);
  });
});
