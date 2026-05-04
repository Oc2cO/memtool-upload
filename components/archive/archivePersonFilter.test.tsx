import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

// Mocks must be declared before importing the screen so the screen's
// transitive imports pick them up at module-eval time. The mock
// pattern here mirrors archiveDateFilter.test.tsx — the only
// difference is the search-param shape (`person` instead of `date`).

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
// when a row is outside the user's library window. Stub the locked
// card to render the same `snippet` as a plain Text node — keeps the
// mock surface aligned with archiveDateFilter.test.tsx even though
// the person-filter tests below don't exercise the locked branch.
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

describe("Archive person filter chip and empty state", () => {
  afterEach(() => {
    mockedUseLocalSearchParams.mockReset();
    // Reset the shared singleton so a memory list seeded by one test
    // can't leak into the next.
    mockMemoriesValue.memories = [];
  });

  test("renders the dismissable chip with the person's name and clears the filter when pressed", () => {
    mockedUseLocalSearchParams.mockReturnValue({ person: "Alice" });
    const view = render(<ArchiveScreen />);

    // The visible chip text echoes the raw person name.
    expect(view.getByText("Alice")).toBeTruthy();

    // The "Clear person filter Alice" a11y label intentionally
    // appears on *two* surfaces when the filter matches nothing:
    // the header chip and the empty-state action. Both are valid
    // dismiss buttons for the user — pressing either one should
    // clear the filter. We target the first match (the header
    // chip, which renders earlier in the tree) to assert the chip
    // specifically carries a working onPress handler.
    const dismissTargets = view.getAllByLabelText(
      "Clear person filter Alice",
    );
    expect(dismissTargets.length).toBeGreaterThanOrEqual(1);
    fireEvent.press(dismissTargets[0]);

    // After dismissing, the chip is unmounted — the person filter
    // text and its a11y label both disappear from the tree. If the
    // onPress handler were missing or wired to something else, the
    // chip would stick around and these queries would still match.
    expect(view.queryByText("Alice")).toBeNull();
    expect(view.queryByLabelText("Clear person filter Alice")).toBeNull();
  });

  test("renders the person-specific empty state with a name-aware title and accessible action", () => {
    // Default `mockMemoriesValue.memories = []` — the per-person
    // filter has nothing to match against, so the empty-state
    // branch in `buildEmptyStateProps` must take over.
    mockedUseLocalSearchParams.mockReturnValue({ person: "Alice" });
    const view = render(<ArchiveScreen />);

    // Production copy is "No memories from <name>" (see
    // `buildEmptyStateProps` in app/(app)/(tabs)/archive.tsx). The
    // task brief uses "captures" colloquially, but the test must
    // mirror the actual string the component renders — we're
    // forbidden from touching production files here.
    expect(view.getByText("No memories from Alice")).toBeTruthy();

    // The empty-state primary action carries the same raw-name
    // a11y label as the header chip ("Clear person filter Alice"),
    // so a screen-reader user can dismiss the filter from either
    // surface. `getAllByLabelText` picks up both — asserting the
    // count pins the contract on both sides.
    const clearTargets = view.getAllByLabelText("Clear person filter Alice");
    expect(clearTargets).toHaveLength(2);
    // And every match must include the person's name in its
    // accessibility label, per the task brief.
    for (const node of clearTargets) {
      expect(node.props.accessibilityLabel).toContain("Alice");
    }
  });
});
