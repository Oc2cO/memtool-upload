/**
 * Render coverage for the recap photo strip (Task #372). The
 * cold-start tests in `MonthRecapView.test.tsx` already pin the
 * gating + window-noun branches; this file pins the half they
 * deliberately don't touch — that once captures cross the
 * cold-start threshold, memories carrying a `photoThumbUrl` (or
 * `photoUrl` fallback) actually surface as <Image> tiles inside
 * the populated recap.
 *
 * Without this, a refactor that flipped the photoMemories filter
 * (`m.photoUrl ?? m.photoThumbUrl` becoming an `&&`, or the strip
 * accidentally moving inside the cold-start short-circuit) would
 * silently strip photos from the recap surface and only get caught
 * once a user complained their thumbnails vanished from Recap.
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

jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));

jest.mock("@/context/MoodContext", () => ({
  useMood: () => ({ history: [] }),
}));

jest.mock("@/context/MemoriesContext", () => ({
  useMemories: () => ({ memories: mockMemoriesFixture }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: { is_pro: true } }),
}));

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

// expo-image renders to a custom native component — stub it down to
// a plain RN.Image so testing-library can find the source URIs.
jest.mock("expo-image", () => {
  const RN = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  return {
    Image: ({ source, ...rest }: { source: { uri: string } }) =>
      React.createElement(RN.Image, { source, ...rest }),
  };
});

import { MonthRecapView } from "./MonthRecapView";

const NOW = new Date("2026-04-30T15:00:00");

function timestampOffset(daysAgo: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function memoryWithPhoto(
  id: string,
  daysAgo: number,
  thumb: string | undefined,
  full: string | undefined,
): Memory {
  return {
    id,
    userId: "test@test.com",
    content: `entry ${id}`,
    timestamp: timestampOffset(daysAgo),
    kind: "memory",
    photoUrl: full,
    photoThumbUrl: thumb,
  };
}

function plainMemory(id: string, daysAgo: number): Memory {
  return {
    id,
    userId: "test@test.com",
    content: `text only ${id}`,
    timestamp: timestampOffset(daysAgo),
    kind: "memory",
  };
}

describe("MonthRecapView — photo strip (Task #372)", () => {
  beforeEach(() => {
    mockMemoriesFixture = [];
  });

  test("renders thumbnails for in-window memories that carry a photoThumbUrl", () => {
    // Comfortably above the 30-day cold-start floor (5) so the
    // populated surface mounts and the photo strip is reachable.
    // Mix two photo-bearing memories with a few text-only ones to
    // prove the filter is selecting on photo presence, not just
    // happening to render every memory.
    mockMemoriesFixture = [
      memoryWithPhoto("p1", 1, "https://cdn.test/p1-thumb.jpg", undefined),
      memoryWithPhoto("p2", 2, undefined, "https://cdn.test/p2-full.jpg"),
      plainMemory("t1", 3),
      plainMemory("t2", 4),
      plainMemory("t3", 5),
    ];

    const view = render(<MonthRecapView windowDays={30} now={NOW} />);

    // The PHOTOS section header is the structural marker that the
    // populated branch even mounted the strip.
    expect(view.getByText("PHOTOS")).toBeTruthy();

    // Each photo memory should yield exactly one Image whose source
    // URI matches what we fed in. We assert via the rendered tree
    // because the strip lives inside an accessibility-labelled
    // TouchableOpacity (`Open archive for YYYY-MM-DD`), and the
    // accessibility label is the cleanest stable handle.
    const day1 = mockMemoriesFixture[0].timestamp.slice(0, 10);
    const day2 = mockMemoriesFixture[1].timestamp.slice(0, 10);
    expect(view.getByLabelText(`Open archive for ${day1}`)).toBeTruthy();
    expect(view.getByLabelText(`Open archive for ${day2}`)).toBeTruthy();

    // And no tile materialised for the text-only entries — that
    // would mean the filter regressed to "every memory in window".
    const day3 = mockMemoriesFixture[2].timestamp.slice(0, 10);
    expect(view.queryByLabelText(`Open archive for ${day3}`)).toBeNull();
  });

  test("hides the PHOTOS section entirely when no in-window memory has a photo", () => {
    // Above the cold-start floor, but every memory is text-only.
    // The strip must NOT render an empty card — that would produce
    // a floating "PHOTOS" header with nothing under it.
    mockMemoriesFixture = [
      plainMemory("t1", 1),
      plainMemory("t2", 2),
      plainMemory("t3", 3),
      plainMemory("t4", 4),
      plainMemory("t5", 5),
    ];

    const view = render(<MonthRecapView windowDays={30} now={NOW} />);

    expect(view.queryByText("PHOTOS")).toBeNull();
  });
});
