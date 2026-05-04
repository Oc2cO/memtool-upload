/**
 * Render coverage for the recap daily-selfie strip (Task #375).
 * Pins the two pieces the helper-level tests can't cover:
 *   1. Within a window with a mix of present and missed days,
 *      every day in the window gets a cell — present cells deep-
 *      link to the archive for that day, missed cells render a
 *      placeholder so streak gaps stay visible.
 *   2. The strip surfaces even when the current window is all
 *      missed (the user has used the ritual at least once),
 *      because missed-day visibility is the whole point.
 */
import React from "react";
import { render } from "@testing-library/react-native";

import type { Memory } from "@/lib/memories";

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

let mockMemoriesFixture: Memory[] = [];

jest.mock("@/hooks/useColors", () => ({ useColors: () => mockColors }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/context/MoodContext", () => ({ useMood: () => ({ history: [] }) }));
jest.mock("@/context/MemoriesContext", () => ({
  useMemories: () => ({ memories: mockMemoriesFixture }),
}));
jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: { is_pro: true } }),
}));
jest.mock("@/components/CaptureHeatmap", () => ({ CaptureHeatmap: () => null }));
jest.mock("@/components/MoodSparkline", () => ({ MoodSparkline: () => null }));
jest.mock("@/components/ProUpsellCard", () => ({ ProUpsellCard: () => null }));
jest.mock("@/components/alive/LiftPress", () => {
  const RN = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  return {
    LiftPress: ({ children, style }: { children?: React.ReactNode; style?: unknown }) =>
      React.createElement(RN.View, { style }, children),
  };
});
jest.mock("expo-image", () => {
  const RN = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  return {
    Image: ({ source, ...rest }: { source: { uri: string } }) =>
      React.createElement(RN.Image, { source, ...rest }),
  };
});

import { MonthRecapView } from "./MonthRecapView";

const NOW = new Date(2026, 3, 30, 15, 0, 0);

function ymdOffset(daysAgo: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function dayKey(daysAgo: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function selfie(id: string, daysAgo: number): Memory {
  return {
    id,
    userId: "u@test.com",
    content: "Daily selfie",
    timestamp: ymdOffset(daysAgo),
    kind: "memory",
    tags: ["daily-selfie"],
    photoThumbUrl: `https://cdn.test/${id}-thumb.jpg`,
  };
}

function plain(id: string, daysAgo: number): Memory {
  return {
    id,
    userId: "u@test.com",
    content: `text ${id}`,
    timestamp: ymdOffset(daysAgo),
    kind: "memory",
  };
}

describe("MonthRecapView — daily selfie strip (Task #375)", () => {
  beforeEach(() => {
    mockMemoriesFixture = [];
  });

  test("renders one cell per day with present + missed gaps in a 7-day window", () => {
    // Above the cold-start floor for windowDays=7. Selfies on
    // days -1 and -3; days -2, -4..-6 are missed (and day -0 is
    // today, also missed in this fixture).
    mockMemoriesFixture = [
      selfie("s1", 1),
      selfie("s3", 3),
      // Pad with text-only entries to clear cold-start.
      plain("t1", 0),
      plain("t2", 2),
      plain("t3", 4),
    ];

    const view = render(<MonthRecapView windowDays={7} now={NOW} />);

    expect(view.getByText("DAILY SELFIES")).toBeTruthy();
    // Present-day cells expose an "Open archive for YYYY-MM-DD" label.
    // Selfies also appear in the photo strip (Task #372), so the
    // archive-link label can match more than one element — we just
    // assert that at least one cell exists per present day.
    expect(view.getAllByLabelText(`Open archive for ${dayKey(1)}`).length).toBeGreaterThanOrEqual(1);
    expect(view.getAllByLabelText(`Open archive for ${dayKey(3)}`).length).toBeGreaterThanOrEqual(1);
    // Missed-day cells use a "No selfie on YYYY-MM-DD" label so the
    // gap is visible to assistive tech, not just sighted users.
    expect(view.getByLabelText(`No selfie on ${dayKey(2)}`)).toBeTruthy();
    expect(view.getByLabelText(`No selfie on ${dayKey(4)}`)).toBeTruthy();
    expect(view.getByLabelText(`No selfie on ${dayKey(0)}`)).toBeTruthy();
  });

  test("strip still surfaces when the current window is all-missed (user used ritual before)", () => {
    // One selfie in deep history (50 days ago) — outside the 7-day
    // window but enough to mark the user as a ritual participant.
    // Inside the window: only text-only entries.
    mockMemoriesFixture = [
      selfie("ancient", 50),
      plain("t1", 0),
      plain("t2", 1),
      plain("t3", 2),
      plain("t4", 3),
      plain("t5", 4),
    ];

    const view = render(<MonthRecapView windowDays={7} now={NOW} />);

    expect(view.getByText("DAILY SELFIES")).toBeTruthy();
    // Every day in the window is a missed cell.
    expect(view.getByLabelText(`No selfie on ${dayKey(0)}`)).toBeTruthy();
    expect(view.getByLabelText(`No selfie on ${dayKey(6)}`)).toBeTruthy();
  });

  test("strip is hidden entirely for a user who has never taken a daily selfie", () => {
    mockMemoriesFixture = [plain("t1", 0), plain("t2", 1), plain("t3", 2), plain("t4", 3), plain("t5", 4)];
    const view = render(<MonthRecapView windowDays={7} now={NOW} />);
    expect(view.queryByText("DAILY SELFIES")).toBeNull();
  });
});
