/**
 * Render-level coverage for the MonthRecapView cold-start nudge.
 *
 * `aggregateRangeRecap.isColdStart` already has unit coverage in
 * `lib/recapMonth.test.ts`. This file pins the OTHER half of the
 * contract: that MonthRecapView actually short-circuits to the
 * friendly nudge when the aggregator flags cold-start, that the
 * window-noun mapping (week / month / quarter / year) flows through
 * to the rendered title for each of the four preset Recap tabs, and
 * that the body copy names the right window length. A control case
 * confirms that crossing the threshold flips the surface to the
 * populated counter card so a regression in the gating direction
 * doesn't pass silently.
 */
import React from "react";
import { render } from "@testing-library/react-native";

import type { Memory } from "@/lib/memories";
import { coldStartMinForWindow } from "@/lib/recapMonth";

const mockColors = {
  background: "#fff",
  foreground: "#000",
  card: "#fff",
  border: "#ccc",
  muted: "#eee",
  mutedForeground: "#666",
  primary: "#007aff",
  primaryForeground: "#fff",
  secondary: "#eef",
  accent: "#5eead4",
  radius: 8,
};

// Mutable handles so each test can swap in its own fixture without
// re-mocking the whole module. The hook factories below close over
// these refs. The `mock` prefix is required by jest's
// out-of-scope-variable guard for jest.mock() factories.
let mockMemoriesFixture: Memory[] = [];

jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// `user: null` keeps the mount effect's loadStoredPatterns short-
// circuit on the no-email branch, so we don't need to mock the
// AsyncStorage-backed pattern reader at all.
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));

jest.mock("@/context/MoodContext", () => ({
  useMood: () => ({ history: [] }),
}));

jest.mock("@/context/MemoriesContext", () => ({
  useMemories: () => ({ memories: mockMemoriesFixture }),
}));

// Free tier is the default for every test; the cold-start branch
// renders identically for Pro and free users (both go through the
// same short-circuit before the Pro gating runs), so we don't
// parametrise this.
jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: { is_pro: false } }),
}));

// CaptureHeatmap and MoodSparkline pull in svg + layout-measurement
// machinery that's irrelevant to the cold-start nudge. The control
// test only checks the headline counter card, which lives outside
// these children.
jest.mock("@/components/CaptureHeatmap", () => ({
  CaptureHeatmap: () => null,
}));
jest.mock("@/components/MoodSparkline", () => ({
  MoodSparkline: () => null,
}));
jest.mock("@/components/ProUpsellCard", () => ({
  ProUpsellCard: () => null,
}));
jest.mock("@/components/alive/LiftPress", () => {
  const RN = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  return {
    LiftPress: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: unknown;
    }) => React.createElement(RN.View, { style }, children),
  };
});

import { MonthRecapView } from "./MonthRecapView";

// Anchor the window math to a fixed clock so the captures we build
// below land deterministically inside (or outside) each preset
// window regardless of when the test suite runs.
const NOW = new Date("2026-04-30T15:00:00");

function timestampOffset(daysAgo: number, hour = 12): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function memory(id: string, daysAgo: number): Memory {
  return {
    id,
    userId: "test@test.com",
    content: "thought",
    timestamp: timestampOffset(daysAgo),
    kind: "memory",
  };
}

/** Build N captures spaced one day apart starting from `daysAgo`,
 *  newest first. Spacing keeps the captures inside any window long
 *  enough to hold them without piling them all on the same day
 *  (which the daysWithCaptures branch would otherwise muddle). */
function memoriesBelowThreshold(windowDays: number, count: number): Memory[] {
  // Spread captures across the window so we don't accidentally walk
  // off the back edge for short windows. For windowDays=7 with
  // count=1 this is a no-op; for 365/60 the spacing keeps every
  // capture comfortably inside the year.
  const spacing = Math.max(1, Math.floor((windowDays - 1) / Math.max(1, count)));
  return Array.from({ length: count }).map((_, i) =>
    memory(`m${i}`, i * spacing),
  );
}

beforeEach(() => {
  mockMemoriesFixture = [];
});

describe("MonthRecapView cold-start nudge", () => {
  // The four preset tabs on the Recap screen. Each row pins:
  //   - windowDays: what the screen passes to MonthRecapView
  //   - noun: the friendly window noun (week/month/quarter/year)
  //   - belowThreshold: a capture count strictly below the
  //     coldStartMinForWindow gate so the surface MUST cold-start
  const PRESETS: Array<{
    windowDays: number;
    noun: "week" | "month" | "quarter" | "year";
    belowThreshold: number;
  }> = [
    { windowDays: 7, noun: "week", belowThreshold: 1 },
    { windowDays: 30, noun: "month", belowThreshold: 4 },
    { windowDays: 90, noun: "quarter", belowThreshold: 14 },
    { windowDays: 365, noun: "year", belowThreshold: 60 },
  ];

  for (const preset of PRESETS) {
    test(`renders the "${preset.noun}" cold-start copy for the ${preset.windowDays}-day window`, () => {
      // Sanity: the fixture really is below the gate. Catches a
      // future tweak to coldStartMinForWindow that would otherwise
      // silently turn this into a populated-surface assertion.
      expect(preset.belowThreshold).toBeLessThan(
        coldStartMinForWindow(preset.windowDays),
      );

      mockMemoriesFixture = memoriesBelowThreshold(
        preset.windowDays,
        preset.belowThreshold,
      );

      const view = render(
        <MonthRecapView windowDays={preset.windowDays} now={NOW} />,
      );

      // Title carries the friendly noun for this window. Asserting
      // the full string (not just the noun) guards against a
      // regression that swaps the template wholesale — e.g. moving
      // to "Your week needs more" would still contain "week" but
      // would no longer be the documented nudge.
      expect(
        view.getByText(`Your ${preset.noun} is just getting started`),
      ).toBeTruthy();

      // Body mentions the raw window length in days so the user
      // knows which range Mem is talking about. Substring match
      // (rather than a verbatim string) keeps the test resilient
      // to small copy tweaks while still catching the regression
      // the task calls out: rendering the wrong window length.
      expect(
        view.getByText(
          new RegExp(`past ${preset.windowDays} days`),
        ),
      ).toBeTruthy();

      // The headline counter ("X memories across Y days") belongs
      // to the populated surface — its absence is the structural
      // proof we really are on the cold-start branch and not just
      // happening to render the same noun somewhere downstream.
      expect(view.queryByText(`Past ${preset.windowDays} days`)).toBeNull();
    });
  }

  test("renders the populated counter card once captures cross the threshold", () => {
    // 30-day window with exactly the cold-start floor of captures
    // (5). isColdStart flips false at >= the floor, so the surface
    // must show the counter card instead of the nudge.
    const windowDays = 30;
    const atThreshold = coldStartMinForWindow(windowDays);
    mockMemoriesFixture = memoriesBelowThreshold(windowDays, atThreshold);

    const view = render(<MonthRecapView windowDays={windowDays} now={NOW} />);

    // Counter card is present — its title is the headerLabel
    // default, "Past N days". The recap screen's tab labels rely
    // on this exact string.
    expect(view.getByText(`Past ${windowDays} days`)).toBeTruthy();

    // And the cold-start nudge is gone. Both halves matter: a
    // regression that renders BOTH (the short-circuit accidentally
    // becoming additive) would slip past a one-sided assertion.
    expect(
      view.queryByText("Your month is just getting started"),
    ).toBeNull();
    expect(view.queryByText(/just getting started$/)).toBeNull();
  });
});
