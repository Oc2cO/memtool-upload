/**
 * Coverage for the daily illustration quota hint on the Home tab
 * (Task #211 / #214). The hint has three branches:
 *
 *   1. Free user with N > 0 left  → "N of M illustration(s) left today"
 *      row, sparkles icon, NOT pressable.
 *   2. Free user with 0 left      → upsell row "Upgrade for unlimited
 *      illustrations" that routes to /subscription on tap.
 *   3. Pro user (limit === null)  → row is hidden entirely, so the cap
 *      we don't enforce isn't advertised.
 *
 * Plus the singular/plural noun toggle ("illustration" vs
 * "illustrations") is wired off the cap, not the remaining count, and
 * the test pins both shapes so a future refactor that flips that wiring
 * surfaces here.
 *
 * The home screen itself pulls in expo-router, several contexts, and
 * the alive-* animation chrome, so the bulk of this file is mocking
 * those dependencies down to no-op shells. The actual assertions in
 * each `test` are short — that's the point: lock the contract, not the
 * scaffolding.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

import { ILLUSTRATION_UPSELL_LABEL } from "@/lib/captureLimits";

// Animation chrome — collapse to plain pass-through views so we don't
// have to drive reanimated worklets just to render the screen tree we
// actually care about.
jest.mock("@/components/alive/SettleOnMount", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    SettleOnMount: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      ReactLib.createElement(RNView, { style }, children),
  };
});

jest.mock("@/components/alive/BreatheCard", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    BreatheCard: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      ReactLib.createElement(RNView, { style }, children),
  };
});

jest.mock("@/components/alive/GradientBackground", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    GradientBackground: (props: object) => ReactLib.createElement(RNView, props),
  };
});

jest.mock("@/components/alive/AmbientBlobs", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    AmbientBlobs: (props: object) => ReactLib.createElement(RNView, props),
  };
});

jest.mock("@/components/alive/FrostBackground", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    FrostBackground: (props: object) => ReactLib.createElement(RNView, props),
  };
});

// AliveButton drives shared values + ripple geometry; for an
// interaction test we only need it to render its children inside a
// pressable surface so the screen-shape assertions pass.
jest.mock("@/components/alive/AliveButton", () => {
  const ReactLib = require("react");
  const { Pressable: RNPressable } = require("react-native");
  return {
    AliveButton: ({
      children,
      onPress,
      accessibilityLabel,
      style,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      accessibilityLabel?: string;
      style?: object;
    }) =>
      ReactLib.createElement(
        RNPressable,
        {
          onPress,
          accessibilityLabel,
          accessibilityRole: "button",
          style,
        },
        children,
      ),
  };
});

// expo-linear-gradient renders a native LinearGradient view that
// jest-expo doesn't bridge in jsdom — flatten to a View so its
// children still mount.
jest.mock("expo-linear-gradient", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    LinearGradient: ({ children, style }: { children?: React.ReactNode; style?: object }) =>
      ReactLib.createElement(RNView, { style }, children),
  };
});

// MemNoticedCard pulls in AsyncStorage + the on-device patterns engine.
// It's not part of the quota contract this file covers, so stub it out
// to keep the import graph small.
jest.mock("@/components/MemNoticedCard", () => ({
  MemNoticedCard: () => null,
}));

// MemorySyncStatus drives an Animated loop — we don't care about the
// per-row badge here, only the recent-captures shape, so collapse it.
jest.mock("@/components/MemorySyncStatus", () => ({
  MemorySyncStatus: () => null,
}));

// Stub the vector-icons set so its async font-loading setState doesn't
// fire after the test body exits and trip the act() warning.
jest.mock("@expo/vector-icons", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  const Stub = (props: object) => ReactLib.createElement(RNView, props);
  return { Ionicons: Stub };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

// Auth — only the `user.email` field is read by the home screen header.
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "user@example.com" } }),
}));

// GameStats — the home screen reads `stats.game24CurrentStreak.{easy,
// medium,hard}` to render the streak tile. Provide a zeroed shape so
// the tile renders but doesn't influence quota assertions.
jest.mock("@/context/GameStatsContext", () => ({
  useGameStats: () => ({
    stats: {
      memoryMatchGamesPlayed: 0,
      memoryMatchBestScore: { easy: null, medium: null, hard: null },
      game24GamesPlayed: 0,
      game24CurrentStreak: { easy: 0, medium: 0, hard: 0 },
      game24BestStreak: { easy: 0, medium: 0, hard: 0 },
      game24BestTime: { easy: null, medium: null, hard: null },
    },
  }),
}));

// Tips — `useTips` is read for the daily boost + fact rows. We don't
// assert on them, but we provide a deterministic shape so the screen
// can mount.
jest.mock("@/context/TipsContext", () => ({
  useTips: () => ({
    todayTip: { id: "tip-1", text: "Stay curious", category: "memory" },
    todayFact: { id: "fact-1", text: "The brain weighs about 1.4kg" },
    favorites: [] as string[],
    toggleFavorite: jest.fn(),
  }),
}));

// Haptics — the home screen calls `haptics.play("undo" | "capture")`.
// A no-op stub keeps the press handlers from blowing up.
jest.mock("@/lib/haptics", () => ({
  useHaptics: () => ({ play: jest.fn() }),
}));

// Stubbable Subscription + Memories contexts. Each test reassigns
// `mockSubscriptionStub` / `mockMemoriesStub` before render so the
// quota branches can be driven independently.
const mockSubscriptionStub: {
  status: { is_pro: boolean } | null;
  freeDailyCaptureLimit: number;
} = {
  status: { is_pro: false },
  freeDailyCaptureLimit: 10,
};
jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => mockSubscriptionStub,
}));

const mockMemoriesStub: {
  memories: unknown[];
  todayMemories: unknown[];
  illustrationsUsedToday: number;
  illustrationsLimit: number | null;
} = {
  memories: [],
  todayMemories: [],
  illustrationsUsedToday: 0,
  illustrationsLimit: 1,
};
jest.mock("@/context/MemoriesContext", () => ({
  useMemories: () => mockMemoriesStub,
}));

// Imported AFTER the mocks are registered — module resolution order
// matters because expo-router and the contexts are read at module
// top-level inside the screen.
import HomeScreen from "./index";

function resetStubs() {
  mockSubscriptionStub.status = { is_pro: false };
  mockSubscriptionStub.freeDailyCaptureLimit = 10;
  mockMemoriesStub.memories = [];
  mockMemoriesStub.todayMemories = [];
  mockMemoriesStub.illustrationsUsedToday = 0;
  mockMemoriesStub.illustrationsLimit = 1;
  mockRouterPush.mockReset();
}

beforeEach(() => {
  resetStubs();
});

describe("HomeScreen — illustration quota hint", () => {
  test("free user with remaining > 0 renders the 'N of M illustrations left today' row (plural cap)", () => {
    // Cap of 3 → noun is plural ("illustrations") regardless of what
    // remaining count we land on. 3 used 0 → "3 of 3 illustrations
    // left today".
    mockSubscriptionStub.status = { is_pro: false };
    mockMemoriesStub.illustrationsLimit = 3;
    mockMemoriesStub.illustrationsUsedToday = 0;

    const view = render(<HomeScreen />);

    expect(view.queryByText("3 of 3 illustrations left today")).toBeTruthy();
    // The upsell sentence must NOT be advertised while the user still
    // has slots — that's the regression we'd see if the atLimit branch
    // collapsed to "always upsell".
    expect(view.queryByText(ILLUSTRATION_UPSELL_LABEL)).toBeNull();
  });

  test("singular cap of 1 uses the singular noun ('1 of 1 illustration left today')", () => {
    // Pluralization tracks the cap, not the remaining count, so "1 of
    // 1" reads singular. This is the legacy phrasing the helper was
    // written to preserve — flipping it back to plural here would feel
    // like a copy regression on every free user's first day.
    mockSubscriptionStub.status = { is_pro: false };
    mockMemoriesStub.illustrationsLimit = 1;
    mockMemoriesStub.illustrationsUsedToday = 0;

    const view = render(<HomeScreen />);

    expect(view.queryByText("1 of 1 illustration left today")).toBeTruthy();
    expect(view.queryByText(ILLUSTRATION_UPSELL_LABEL)).toBeNull();
  });

  test("free user with 2 remaining of 3 still uses plural noun", () => {
    // Mid-day state: cap 3, one used. The noun stays plural because
    // the cap (not the remaining) drives it.
    mockSubscriptionStub.status = { is_pro: false };
    mockMemoriesStub.illustrationsLimit = 3;
    mockMemoriesStub.illustrationsUsedToday = 1;

    const view = render(<HomeScreen />);

    expect(view.queryByText("2 of 3 illustrations left today")).toBeTruthy();
  });

  test("free user with 0 left renders the upsell row and tapping it routes to /subscription", async () => {
    // At-limit branch: the row flips to ILLUSTRATION_UPSELL_LABEL and
    // becomes pressable. Tap routes to /subscription so the home
    // screen doubles as a Pro discovery surface.
    mockSubscriptionStub.status = { is_pro: false };
    mockMemoriesStub.illustrationsLimit = 1;
    mockMemoriesStub.illustrationsUsedToday = 1;

    const view = render(<HomeScreen />);

    expect(view.queryByText(ILLUSTRATION_UPSELL_LABEL)).toBeTruthy();
    // The "X of Y left today" sentence must NOT render when we've
    // flipped to the upsell — otherwise the user sees both messages
    // and the row's intent is muddled.
    expect(view.queryByText(/illustration[s]? left today/)).toBeNull();

    const upsellRow = view.getByLabelText(ILLUSTRATION_UPSELL_LABEL);

    await act(async () => {
      fireEvent.press(upsellRow);
    });

    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith("/subscription");
  });

  test("pro user (illustrationsLimit === null) does not render the row at all", () => {
    // The whole row is gated on `quota.visible`, which is false when
    // the limit is null (Pro). Asserting on BOTH the remaining-count
    // and upsell strings being absent guards against either branch
    // accidentally re-emerging for Pro.
    mockSubscriptionStub.status = { is_pro: true };
    mockMemoriesStub.illustrationsLimit = null;
    mockMemoriesStub.illustrationsUsedToday = 0;

    const view = render(<HomeScreen />);

    expect(view.queryByText(ILLUSTRATION_UPSELL_LABEL)).toBeNull();
    expect(view.queryByText(/illustration[s]? left today/)).toBeNull();
  });

  test("free user with remaining > 0 renders a non-pressable row (no /subscription navigation on tap)", async () => {
    // The non-at-limit row is intentionally informational — tapping
    // it must NOT route to /subscription, otherwise a brand-new free
    // user with 9 of 10 left lands on the paywall the moment they
    // brush the row.
    mockSubscriptionStub.status = { is_pro: false };
    mockMemoriesStub.illustrationsLimit = 3;
    mockMemoriesStub.illustrationsUsedToday = 0;

    const view = render(<HomeScreen />);

    const row = view.getByLabelText("3 of 3 illustrations left today");

    await act(async () => {
      fireEvent.press(row);
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});

// Small smoke check: the helper export the test imports is the same
// constant the screen renders. Without this, a rename of the constant
// would silently make the upsell-tap test pass against a stale string.
test("ILLUSTRATION_UPSELL_LABEL constant matches the user-facing copy", () => {
  expect(ILLUSTRATION_UPSELL_LABEL).toBe("Upgrade for unlimited illustrations");
});
