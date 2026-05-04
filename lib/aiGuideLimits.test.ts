import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  bumpAiGuideCounter,
  getAiGuideLimitState,
  loadAiGuideCounter,
  localIsoDay,
  resetAiGuideCounter,
} from "./aiGuideLimits";
import { FREE_DAILY_AI_GUIDE_LIMIT } from "./subscription";

const COUNTER_KEY = "mt_ai_guide_count_v1";

const mockedStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

describe("localIsoDay", () => {
  it("renders YYYY-MM-DD with zero-padded month and day", () => {
    const d = new Date(2026, 0, 5, 23, 30); // Jan 5, 2026
    expect(localIsoDay(d)).toBe("2026-01-05");
  });

  it("uses local time, not UTC", () => {
    // Whatever the test runner's TZ is, the day should match getDate().
    const d = new Date(2026, 5, 30, 12, 0);
    expect(localIsoDay(d)).toBe("2026-06-30");
  });
});

describe("getAiGuideLimitState", () => {
  it("computes remaining + atLimit for a free user under the cap", () => {
    const s = getAiGuideLimitState(1, false);
    expect(s.isPro).toBe(false);
    expect(s.sentToday).toBe(1);
    expect(s.limit).toBe(FREE_DAILY_AI_GUIDE_LIMIT);
    expect(s.remainingToday).toBe(FREE_DAILY_AI_GUIDE_LIMIT - 1);
    expect(s.atLimit).toBe(false);
  });

  it("flips atLimit at exactly the cap for free users", () => {
    const s = getAiGuideLimitState(FREE_DAILY_AI_GUIDE_LIMIT, false);
    expect(s.atLimit).toBe(true);
    expect(s.remainingToday).toBe(0);
  });

  it("never flips atLimit for Pro users", () => {
    const s = getAiGuideLimitState(FREE_DAILY_AI_GUIDE_LIMIT * 10, true);
    expect(s.atLimit).toBe(false);
    expect(s.remainingToday).toBe(0);
  });

  it("clamps malformed counters to zero", () => {
    const s = getAiGuideLimitState(Number.NaN, false);
    expect(s.sentToday).toBe(0);
    expect(s.atLimit).toBe(false);
  });
});

describe("loadAiGuideCounter", () => {
  beforeEach(() => {
    mockedStorage.getItem.mockReset();
    mockedStorage.setItem.mockReset();
    mockedStorage.removeItem.mockReset();
  });

  it("returns a fresh zero counter when storage is empty", async () => {
    mockedStorage.getItem.mockResolvedValueOnce(null);
    const out = await loadAiGuideCounter(new Date(2026, 4, 1));
    expect(out).toEqual({ date: "2026-05-01", count: 0 });
    expect(mockedStorage.getItem).toHaveBeenCalledWith(COUNTER_KEY);
  });

  it("returns the persisted count when the date matches today", async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({ date: "2026-05-01", count: 2 }),
    );
    const out = await loadAiGuideCounter(new Date(2026, 4, 1));
    expect(out).toEqual({ date: "2026-05-01", count: 2 });
  });

  it("resets to zero when the persisted date is yesterday", async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({ date: "2026-04-30", count: 5 }),
    );
    const out = await loadAiGuideCounter(new Date(2026, 4, 1));
    expect(out).toEqual({ date: "2026-05-01", count: 0 });
  });

  it("recovers from corrupt JSON with a fresh zero counter", async () => {
    mockedStorage.getItem.mockResolvedValueOnce("{not-json");
    const out = await loadAiGuideCounter(new Date(2026, 4, 1));
    expect(out).toEqual({ date: "2026-05-01", count: 0 });
  });

  it("recovers from a wrong-shape value", async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({ count: "two" }),
    );
    const out = await loadAiGuideCounter(new Date(2026, 4, 1));
    expect(out).toEqual({ date: "2026-05-01", count: 0 });
  });

  it("recovers from a negative count", async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({ date: "2026-05-01", count: -3 }),
    );
    const out = await loadAiGuideCounter(new Date(2026, 4, 1));
    expect(out).toEqual({ date: "2026-05-01", count: 0 });
  });

  it("floors a non-integer count", async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({ date: "2026-05-01", count: 2.7 }),
    );
    const out = await loadAiGuideCounter(new Date(2026, 4, 1));
    expect(out).toEqual({ date: "2026-05-01", count: 2 });
  });
});

describe("bumpAiGuideCounter", () => {
  beforeEach(() => {
    mockedStorage.getItem.mockReset();
    mockedStorage.setItem.mockReset();
  });

  it("increments and persists same-day", async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({ date: "2026-05-01", count: 1 }),
    );
    const next = await bumpAiGuideCounter(new Date(2026, 4, 1));
    expect(next).toEqual({ date: "2026-05-01", count: 2 });
    expect(mockedStorage.setItem).toHaveBeenCalledWith(
      COUNTER_KEY,
      JSON.stringify({ date: "2026-05-01", count: 2 }),
    );
  });

  it("starts a new day at 1 after a stale-date load", async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({ date: "2026-04-30", count: 5 }),
    );
    const next = await bumpAiGuideCounter(new Date(2026, 4, 1));
    expect(next).toEqual({ date: "2026-05-01", count: 1 });
  });
});

describe("resetAiGuideCounter", () => {
  it("removes the persisted key", async () => {
    mockedStorage.removeItem.mockReset();
    await resetAiGuideCounter();
    expect(mockedStorage.removeItem).toHaveBeenCalledWith(COUNTER_KEY);
  });
});
