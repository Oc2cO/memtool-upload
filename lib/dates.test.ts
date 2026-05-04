import {
  formatChartLabel,
  formatDate,
  formatDayMonth,
  formatLongDate,
  formatRelative,
  formatRelativeAge,
  formatShortDayMonth,
} from "./dates";

// Pin the wall clock so the relative-age helpers produce stable
// boundaries. We choose a date deep enough into a month / year that
// the year-boundary cases ("1 year ago") don't straddle a leap day,
// which would otherwise make the integer-day floor flake by ±1.
const NOW = new Date("2026-10-24T12:00:00Z").getTime();

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

describe("formatDate", () => {
  it("renders a YYYY-MM-DD string in 'Mon DD, YYYY' form", () => {
    // Critical case from the audit — recap.date is `"2026-04-28"` and
    // was rendered raw before this helper landed.
    expect(formatDate("2026-04-28")).toBe("Apr 28, 2026");
  });

  it("treats YYYY-MM-DD as a local calendar day (no UTC drift)", () => {
    // `new Date("2026-04-28")` parses as UTC midnight; in negative
    // timezones (e.g. America/Los_Angeles) that lands on Apr 27. Our
    // helper has to bypass that parser path for date-only inputs.
    const proto = Date.prototype as unknown as {
      getTimezoneOffset: () => number;
    };
    const original = proto.getTimezoneOffset;
    proto.getTimezoneOffset = () => 480; // PST = UTC-8
    try {
      expect(formatDate("2026-04-28")).toBe("Apr 28, 2026");
    } finally {
      proto.getTimezoneOffset = original;
    }
  });

  it("accepts a Date directly", () => {
    expect(formatDate(new Date(2026, 9, 24))).toBe("Oct 24, 2026");
  });

  it("returns '' for an invalid input rather than throwing", () => {
    expect(formatDate("not a date")).toBe("");
  });
});

describe("formatLongDate", () => {
  it("renders 'Month DD, YYYY' for the subscription renewal date", () => {
    // Subscription renewal copy reads more comfortably with a spelled
    // out month — this is the only surface that asks for the long form.
    expect(formatLongDate("2026-10-24")).toBe("October 24, 2026");
  });

  it("accepts a Date directly", () => {
    expect(formatLongDate(new Date(2026, 3, 28))).toBe("April 28, 2026");
  });

  it("returns '' for an invalid input", () => {
    expect(formatLongDate("garbage")).toBe("");
  });
});

describe("formatDayMonth", () => {
  it("renders 'Month DD' with no year", () => {
    expect(formatDayMonth("2026-10-24")).toBe("October 24");
  });

  it("returns '' for an invalid input", () => {
    expect(formatDayMonth("garbage")).toBe("");
  });
});

describe("formatShortDayMonth", () => {
  it("renders 'Mon DD' with no year", () => {
    expect(formatShortDayMonth("2026-04-14")).toBe("Apr 14");
  });

  it("returns '' for an invalid input", () => {
    expect(formatShortDayMonth("garbage")).toBe("");
  });
});

describe("formatRelative", () => {
  it("returns '—' for empty / null / undefined input", () => {
    expect(formatRelative("")).toBe("—");
    expect(formatRelative(null)).toBe("—");
    expect(formatRelative(undefined)).toBe("—");
  });

  it("returns '—' for an invalid date string", () => {
    expect(formatRelative("not a date")).toBe("—");
  });

  it("returns 'just now' for sub-minute deltas", () => {
    expect(formatRelative(new Date(NOW - 10_000))).toBe("just now");
  });

  it("renders minutes / hours / days for recent inputs", () => {
    expect(formatRelative(new Date(NOW - 5 * 60_000))).toBe("5 min ago");
    expect(formatRelative(new Date(NOW - 3 * 60 * 60_000))).toBe("3h ago");
    expect(formatRelative(new Date(NOW - 5 * 24 * 60 * 60_000))).toBe(
      "5d ago",
    );
  });

  it("falls back to formatDate once the gap is wider than two weeks", () => {
    // 30 days back from 2026-10-24 = 2026-09-24.
    const old = new Date(NOW - 30 * 24 * 60 * 60_000);
    expect(formatRelative(old)).toBe(formatDate(old));
  });
});

describe("formatRelativeAge", () => {
  it("returns 'today' for the same calendar day", () => {
    expect(formatRelativeAge(new Date(NOW))).toBe("today");
  });

  it("returns 'yesterday' for ~24h ago", () => {
    expect(formatRelativeAge(new Date(NOW - 24 * 60 * 60_000))).toBe(
      "yesterday",
    );
  });

  it("buckets sub-month ages by day", () => {
    expect(formatRelativeAge(new Date(NOW - 5 * 24 * 60 * 60_000))).toBe(
      "5 days ago",
    );
  });

  it("buckets older ages by month / year with correct singulars", () => {
    expect(formatRelativeAge(new Date(NOW - 30 * 24 * 60 * 60_000))).toBe(
      "1 month ago",
    );
    expect(formatRelativeAge(new Date(NOW - 90 * 24 * 60 * 60_000))).toBe(
      "3 months ago",
    );
    expect(formatRelativeAge(new Date(NOW - 365 * 24 * 60 * 60_000))).toBe(
      "1 year ago",
    );
    expect(formatRelativeAge(new Date(NOW - 2 * 365 * 24 * 60 * 60_000))).toBe(
      "2 years ago",
    );
  });

  it("returns 'earlier' for an invalid input", () => {
    expect(formatRelativeAge("not a date")).toBe("earlier");
  });
});

describe("formatChartLabel", () => {
  it("renders the weekday for style='weekday'", () => {
    // 2026-10-24 is a Saturday.
    expect(formatChartLabel("2026-10-24", "weekday")).toBe("Sat");
  });

  it("renders 'M/D' for style='monthDay' with no leading zeroes", () => {
    expect(formatChartLabel("2026-04-28", "monthDay")).toBe("4/28");
  });

  it("defaults to 'monthDay' style", () => {
    expect(formatChartLabel("2026-10-24")).toBe("10/24");
  });

  it("returns '' for an invalid input", () => {
    expect(formatChartLabel("garbage")).toBe("");
  });
});
