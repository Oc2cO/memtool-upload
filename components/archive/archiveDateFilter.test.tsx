import React from "react";
import { render } from "@testing-library/react-native";

// Mocks must be declared before importing the screen so the screen's
// transitive imports pick them up at module-eval time.

// `useRouter` must return a *stable* object across renders — the
// archive screen lists `router` in its deep-link useEffect's dep
// array, so a fresh object each render would loop the effect.
// Must be `mock`-prefixed so jest.mock's out-of-scope check allows it.
const mockStableRouter = { setParams: jest.fn() };
jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(() => mockStableRouter),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Stub @expo/vector-icons so async font loading inside the real Icon
// component doesn't fire late `setState` calls after the test ends
// (which surface as harmless but noisy "update not wrapped in act"
// warnings). The chip and empty-state assertions never inspect the
// icon glyph itself, so a plain View stand-in is sufficient.
jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  const StubIcon = (props: Record<string, unknown>) =>
    React.createElement(View, props);
  return {
    Ionicons: StubIcon,
    MaterialIcons: StubIcon,
    MaterialCommunityIcons: StubIcon,
    FontAwesome: StubIcon,
    Feather: StubIcon,
  };
});

// Stable singleton — the archive screen has effects keyed on
// `memories` and `searchMemories` references, so a fresh object per
// render would loop the filter effect.
const mockMemoriesValue = {
  memories: [] as unknown[],
  deleteMemory: jest.fn(),
  refreshMemories: jest.fn(),
  searchMemories: jest.fn(),
  stuckSyncCount: 0,
  retrySync: jest.fn(),
  retryMemorySync: jest.fn(),
};
jest.mock("@/context/MemoriesContext", () => ({
  useMemories: () => mockMemoriesValue,
}));

// The locked-card branch hides the raw memory content behind a tease
// when a row is outside the user's library window. The list-filter
// tests below assert visibility of a memory's content text directly,
// so stub the locked card to render the same `snippet` as a plain
// Text node — that way an unexpected drift into the locked branch
// (e.g. someone tightens the Pro window in the future) still surfaces
// the content for the assertion to find. The list-filter assertions
// are about whether the row is in the filtered list at all, not which
// of the two card variants it renders as.
jest.mock("@/components/LockedMemoryCard", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    LockedMemoryCard: ({ snippet }: { snippet: string }) =>
      React.createElement(Text, null, snippet),
  };
});

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: { is_pro: true } }),
}));

jest.mock("@/components/alive/FrostBackground", () => ({
  FrostBackground: () => null,
}));

jest.mock("@/components/alive/BreatheCard", () => {
  const React = require("react");
  return {
    BreatheCard: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

jest.mock("@/components/alive/SettleOnMount", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    SettleOnMount: ({
      children,
      style,
    }: {
      children: React.ReactNode;
      style?: unknown;
    }) => React.createElement(View, { style }, children),
  };
});

import ArchiveScreen from "@/app/(app)/(tabs)/archive";
import { useLocalSearchParams } from "expo-router";

const mockedUseLocalSearchParams =
  useLocalSearchParams as unknown as jest.Mock;

// The chip/empty-state friendly labels are produced by
// `Date.prototype.toLocaleDateString([], …)`, which falls back to the
// host's default locale. Node's default in this jest environment is
// `en-US`, which is what the assertions below rely on (e.g. "Apr 14",
// "Dec 31, 2025"). If the test environment's default locale ever
// changes, these literal-string assertions would need to be updated
// accordingly — flagging here so the failure mode is obvious.
describe("Archive date filter chip and empty state", () => {
  beforeEach(() => {
    // Pin "today" so the same-year vs off-year branch in
    // formatDateFilterLabel is deterministic. May 1, 2026 matches the
    // project's "today" so 2026 dates render without a year and 2025
    // dates render with one.
    jest.useFakeTimers({ doNotFake: ["nextTick"] });
    jest.setSystemTime(new Date(2026, 4, 1));
  });

  afterEach(() => {
    jest.useRealTimers();
    mockedUseLocalSearchParams.mockReset();
    // Reset the shared singleton so a memory list seeded by one test
    // can't leak into the next.
    mockMemoriesValue.memories = [];
  });

  test("same-year date renders the chip with a friendly short label (no year)", () => {
    mockedUseLocalSearchParams.mockReturnValue({ date: "2026-04-14" });
    const view = render(<ArchiveScreen />);
    // The visible chip text uses the short label.
    expect(view.getByText("Apr 14")).toBeTruthy();
    // And it is *not* the raw YYYY-MM-DD string.
    expect(view.queryByText("2026-04-14")).toBeNull();
  });

  test("off-year date renders the chip with the year included", () => {
    mockedUseLocalSearchParams.mockReturnValue({ date: "2025-04-14" });
    const view = render(<ArchiveScreen />);
    expect(view.getByText("Apr 14, 2025")).toBeTruthy();
    expect(view.queryByText("2025-04-14")).toBeNull();
  });

  test("date-specific empty state title uses the same friendly label as the chip", () => {
    mockedUseLocalSearchParams.mockReturnValue({ date: "2026-04-14" });
    const view = render(<ArchiveScreen />);
    // Both surfaces should describe the filter the same way.
    expect(view.getByText("Apr 14")).toBeTruthy();
    expect(view.getByText("No memories on Apr 14")).toBeTruthy();
  });

  test("chip accessibilityLabel still references the raw YYYY-MM-DD for screen readers", () => {
    mockedUseLocalSearchParams.mockReturnValue({ date: "2025-12-31" });
    const view = render(<ArchiveScreen />);

    // Locate the chip specifically (not the empty-state action,
    // which intentionally shares the same accessibilityLabel). The
    // chip is the only surface that renders the friendly label as a
    // standalone text node — the empty state concatenates it into
    // "No memories on …", so a literal "Dec 31, 2025" Text match is
    // uniquely the chip's child.
    const chipLabel = view.getByText("Dec 31, 2025");

    // Walk up to the chip's Pressable host (the nearest ancestor
    // that carries an accessibilityLabel) and assert that label is
    // the unambiguous machine-readable date — not the friendly form.
    // Screen reader users must still hear the raw YYYY-MM-DD even
    // though sighted users see the prettier label.
    let node: typeof chipLabel | null = chipLabel.parent;
    while (node && node.props?.accessibilityLabel == null) {
      node = node.parent;
    }
    expect(node).not.toBeNull();
    expect(node!.props.accessibilityLabel).toBe(
      "Clear date filter 2025-12-31",
    );

    // Belt-and-braces: the empty-state "Clear date filter" action
    // intentionally shares the same raw-date a11y label, so both
    // surfaces should be discoverable by the same query. If a
    // future refactor drops the chip's a11y label, this count drops
    // to 1 and the test above also fails — together they pin the
    // contract on both sides.
    expect(view.getAllByLabelText("Clear date filter 2025-12-31")).toHaveLength(
      2,
    );
  });

  // Local-day boundary tests — these exercise the *actual* filter
  // behavior in the screen's search useEffect (which calls
  // applyArchiveClientFilters), not just the chip/empty-state copy.
  // A subtle bug in the local-day formatter — for example, drifting
  // to UTC instead of local time — would silently hide or surface
  // the wrong captures without breaking any of the chip-only tests
  // above. The constructed timestamps deliberately straddle a local-
  // day boundary so a UTC-based filter would misclassify at least
  // one of them in any non-UTC timezone.
  //
  // We build timestamps with `new Date(y, mIdx, d, h, m).toISOString()`
  // so the wall-clock fields encoded into the resulting Date are
  // local-time values; the screen's filter then re-reads
  // .getFullYear()/.getMonth()/.getDate() in local time, giving us a
  // round-trip that mirrors how a real device records and filters
  // captures regardless of the test runner's local timezone.
  const apr13Local2330 = new Date(2026, 3, 13, 23, 30).toISOString();
  const apr14Local0030 = new Date(2026, 3, 14, 0, 30).toISOString();

  function makeMemory(id: string, content: string, timestamp: string) {
    return {
      id,
      userId: "user@example.com",
      content,
      timestamp,
      kind: "memory" as const,
    };
  }

  test("?date filter keeps only the captures on that local day, hiding the previous-night neighbor across the local-midnight boundary", () => {
    const apr13 = makeMemory(
      "mem-apr13",
      "late night Apr 13 capture",
      apr13Local2330,
    );
    const apr14 = makeMemory(
      "mem-apr14",
      "early morning Apr 14 capture",
      apr14Local0030,
    );
    mockMemoriesValue.memories = [apr13, apr14];
    mockedUseLocalSearchParams.mockReturnValue({ date: "2026-04-14" });

    const view = render(<ArchiveScreen />);

    // The Apr 14 capture is on the requested local day → visible.
    expect(view.getByText("early morning Apr 14 capture")).toBeTruthy();
    // The Apr 13 capture is 60 minutes earlier in wall-clock terms
    // but on a different local day → must be hidden by the filter.
    // If the filter formatter drifted to UTC, in any timezone west
    // of UTC the Apr 13 23:30 local timestamp would land on Apr 14
    // UTC and incorrectly survive this filter.
    expect(view.queryByText("late night Apr 13 capture")).toBeNull();
  });

  test("?date filter with no matching captures shows the date-specific empty state from the actually-filtered list (not just the helper)", () => {
    // Seed two captures that exist on a *different* local day than
    // the requested filter. The chip-only tests above assert the
    // empty-state copy when the underlying memories array is empty;
    // this case proves the same empty-state path is reached because
    // the filter *itself* removed every row, not because there were
    // no rows to begin with.
    mockMemoriesValue.memories = [
      makeMemory("mem-apr13", "late night Apr 13 capture", apr13Local2330),
      makeMemory("mem-apr14", "early morning Apr 14 capture", apr14Local0030),
    ];
    mockedUseLocalSearchParams.mockReturnValue({ date: "2026-04-15" });

    const view = render(<ArchiveScreen />);

    // Neither seeded capture should render — the filter excluded both.
    expect(view.queryByText("late night Apr 13 capture")).toBeNull();
    expect(view.queryByText("early morning Apr 14 capture")).toBeNull();

    // And the date-specific empty state must take over the list.
    expect(view.getByText("No memories on Apr 15")).toBeTruthy();
    // The "Clear date filter" action carries the raw-date a11y label
    // for screen readers — confirms we're looking at the date branch
    // of buildEmptyStateProps, not the generic "No memories found".
    // The same a11y label is intentionally shared between the header
    // chip and the empty-state action (see the "raw YYYY-MM-DD"
    // contract test above), so we expect *both* to be present here.
    expect(
      view.getAllByLabelText("Clear date filter 2026-04-15"),
    ).toHaveLength(2);
  });
});
