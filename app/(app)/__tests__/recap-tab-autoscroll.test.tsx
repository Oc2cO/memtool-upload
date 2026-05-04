/**
 * Regression coverage for the Recap screen's horizontal-tab-bar
 * auto-scroll pipeline (`app/(app)/recap.tsx`,
 * `attemptScrollActiveTabIntoView` + the three onLayout /
 * onContentSizeChange handlers that feed it).
 *
 * The screen now scrolls its segmented tab bar so the active window
 * tab is centred in view. This depends on three independent layout
 * measurements arriving in any order — tab segment positions, the
 * scroller's viewport width, and its content width — plus the
 * persisted active tab from AsyncStorage. Because each measurement
 * can land first, regressing the gating (or the centring math) would
 * silently break the affordance on narrow phones the next time
 * someone tweaks the tab labels, padding, or count.
 *
 * What we pin here:
 *
 *   1. On first mount, once all three measurements have landed, the
 *      horizontal ScrollView is asked to scrollTo the active tab
 *      (non-animated — the screen should LAND on the right offset).
 *   2. After that initial scroll, switching tabs scrollTo's the new
 *      active tab with `animated: true`.
 *   3. Wide layouts (content fits the viewport) are a no-op — we do
 *      NOT touch the scroller on devices that don't need it.
 *   4. A persisted active tab restored from AsyncStorage triggers
 *      the same scroll-into-view once the layout measurements arrive,
 *      with `animated: false` (still the initial paint).
 *
 * To do this we replace `react-native`'s ScrollView with a forwardRef
 * <View> that exposes `scrollTo` as a jest.fn via useImperativeHandle.
 * Only the inner horizontal tab-bar ScrollView's ref is touched by
 * the screen (the outer vertical scroller has no ref prop), so any
 * recorded scrollTo call is unambiguously the tab bar.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const mockScrollTo = jest.fn();

// Replace react-native's ScrollView with a forwardRef'd <View> that
// exposes a `scrollTo` jest.fn via useImperativeHandle. The outer
// vertical ScrollView in recap.tsx has no `ref` prop, so its mock
// imperative handle is never attached — every recorded scrollTo call
// is therefore a tab-bar call. We strip `refreshControl` because it
// is a JSX element React would otherwise render as a child.
//
// Why a Proxy and not a spread: `react-native` exposes its top-level
// surface via lazy getters. A `{ ...RN, ... }` spread enumerates all
// of them, which trips deprecation warnings AND hard-crashes on
// `DevMenu` (TurboModuleRegistry.getEnforcing → invariant). The Proxy
// only evaluates the keys consumers actually touch, so DevMenu / etc.
// stay untouched unless someone tries to use them.
jest.mock("react-native", () => {
  const RN = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  const ScrollViewMock = React.forwardRef(function MockScrollView(
    props: Record<string, unknown>,
    ref: React.Ref<{ scrollTo: typeof mockScrollTo }>,
  ) {
    React.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }), []);
    const { children, refreshControl: _refreshControl, ...rest } = props as {
      children?: React.ReactNode;
      refreshControl?: unknown;
    };
    return React.createElement(RN.View, rest, children);
  });
  return new Proxy(RN, {
    get(target, prop) {
      if (prop === "ScrollView") return ScrollViewMock;
      return Reflect.get(target, prop);
    },
  });
});

// Every hook below must return a STABLE reference across renders —
// the recap screen wraps `loadRecap` in useCallback with `haptics` in
// its deps array, so a fresh `{ play }` object each render would
// invalidate the callback every time, re-fire the mount effect, set
// state, re-render, and infinite-loop. Same defensive stability for
// the other contexts in case future deps grow into them.
const mockRouterApi = { replace: jest.fn(), back: jest.fn(), push: jest.fn() };
const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
const mockColors = {
  background: "#fff",
  foreground: "#000",
  card: "#fff",
  border: "#ccc",
  muted: "#eee",
  mutedForeground: "#666",
  primary: "#007aff",
  primaryForeground: "#fff",
  radius: 8,
};
const mockAuth = { user: null };
const mockMood = {
  history: [],
  todayLog: null,
  setRating: jest.fn(),
  setStress: jest.fn(),
  setNote: jest.fn(),
  refreshHistory: jest.fn(),
  isLoading: false,
};
const mockSubscription = { status: { is_pro: false } };
const mockHaptics = { play: jest.fn() };

jest.mock("expo-router", () => ({
  useRouter: () => mockRouterApi,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const cleanup = cb();
    if (typeof cleanup === "function") cleanup();
  },
}));

jest.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({ profile: null }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

jest.mock("@/context/MoodContext", () => ({
  useMood: () => mockMood,
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => mockSubscription,
}));

jest.mock("@/lib/recap", () => ({
  apiGetRecap: jest.fn(() =>
    Promise.resolve({
      summary: "",
      themes: [],
      mood_trend: null,
      suggestion: null,
      capture_count: 0,
      date: "2026-05-02",
      cached: false,
    }),
  ),
}));

jest.mock("@/lib/reviewPrompt", () => ({
  maybeRequestReview: jest.fn(() => Promise.resolve()),
}));

jest.mock("@/lib/haptics", () => ({
  useHaptics: () => mockHaptics,
}));

jest.mock("@/lib/aliveUI", () => ({
  useBreathingEnabled: () => false,
}));

jest.mock("@/lib/animationTokens", () => ({
  cardEntering: () => undefined,
}));

// The alive surfaces pull in expo-linear-gradient and reanimated
// timelines that aren't relevant to the auto-scroll logic — stub them
// down to plain wrappers so the screen mounts cheaply.
jest.mock("@/components/alive/GradientBackground", () => ({
  GradientBackground: () => null,
}));

jest.mock("@/components/alive/SettleOnMount", () => {
  const RN = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  return {
    SettleOnMount: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: unknown;
    }) => React.createElement(RN.View, { style }, children),
  };
});

// MonthRecapView pulls in CaptureHeatmap + MoodSparkline + a network
// fetch. The auto-scroll behaviour lives entirely in the parent, so a
// null stub is enough — and keeps the layout walker below from
// firing layout handlers inside the heatmap.
jest.mock("@/components/MonthRecapView", () => ({
  MonthRecapView: () => null,
}));

jest.mock("@/components/DateRangePickerModal", () => ({
  DateRangePickerModal: () => null,
  MAX_RANGE_DAYS: 365,
}));

jest.mock("@/components/ProUpsellCard", () => ({
  ProUpsellCard: () => null,
}));

// Calendar permission denied keeps `fetchTomorrowEvents` on the
// short-circuit branch so the test doesn't have to mock event
// fixtures unrelated to the auto-scroll pipeline.
jest.mock("expo-calendar", () => ({
  getCalendarPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: "denied", canAskAgain: false }),
  ),
  requestCalendarPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: "denied", canAskAgain: false }),
  ),
  getCalendarsAsync: jest.fn(() => Promise.resolve([])),
  getEventsAsync: jest.fn(() => Promise.resolve([])),
  EntityTypes: { EVENT: "event" },
}));

import RecapScreen from "../recap";

const RECAP_TAB_STORAGE_KEY = "recap_active_tab_v1";
const RECAP_CUSTOM_RANGE_STORAGE_KEY = "recap_custom_range_v1";

// Six tab segments. Widths are illustrative — what matters for the
// pinned scroll math is the cumulative x and width of the active
// segment, not the absolute pixel values. Total content reaches
// ~700px, well past a 300px viewport, so every preset tab past
// "today" lives off-screen on a narrow phone.
const TAB_LAYOUTS: Array<{ label: string; x: number; width: number }> = [
  { label: "Today recap", x: 0, width: 60 },
  { label: "Past 7 days recap", x: 70, width: 90 },
  { label: "Past 30 days recap", x: 170, width: 100 },
  { label: "Past 90 days recap", x: 280, width: 100 },
  { label: "Past 365 days recap", x: 390, width: 110 },
  { label: "Custom recap", x: 510, width: 80 },
];

function findHorizontalScroller(view: ReturnType<typeof render>) {
  // The mocked ScrollView is a forwardRef around a <View>, which
  // means the same props (horizontal, onLayout, onContentSizeChange)
  // appear on multiple TestInstances along the chain — the
  // forwardRef wrapper, the inner View component, and the host
  // element React Test Renderer emits below it. Restricting to host
  // nodes (`typeof type === "string"`) collapses the chain to one
  // unambiguous match — the same node a real RN renderer would
  // attach the layout / content-size callbacks to.
  const matches = view.UNSAFE_root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props != null &&
      node.props.horizontal === true &&
      typeof node.props.onLayout === "function" &&
      typeof node.props.onContentSizeChange === "function",
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one horizontal scroller, found ${matches.length}`,
    );
  }
  return matches[0];
}

/** Fire onLayout on every tab segment with the supplied x/width
 *  pairs. Using the accessibilityLabel each segment already exposes
 *  (`<label> recap`) keeps the test honest — it goes through the
 *  same accessibility surface a screen reader would. */
function reportTabSegmentLayouts(
  view: ReturnType<typeof render>,
  layouts: typeof TAB_LAYOUTS,
) {
  act(() => {
    for (const { label, x, width } of layouts) {
      const segment = view.getByLabelText(label);
      fireEvent(segment, "layout", {
        nativeEvent: { layout: { x, y: 0, width, height: 36 } },
      });
    }
  });
}

function reportScrollerViewportLayout(
  view: ReturnType<typeof render>,
  width: number,
) {
  act(() => {
    const scroller = findHorizontalScroller(view);
    scroller.props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width, height: 48 } },
    });
  });
}

function reportScrollerContentSize(
  view: ReturnType<typeof render>,
  width: number,
) {
  act(() => {
    const scroller = findHorizontalScroller(view);
    scroller.props.onContentSizeChange(width, 48);
  });
}

/** Flush the AsyncStorage Promise.all microtask in the mount effect
 *  so the persisted active tab (if any) has been applied to state
 *  before the test starts dispatching layout events. */
async function flushAsyncStorage() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const VIEWPORT_NARROW = 300;
const CONTENT_NARROW = 700;

// Centring math, mirrored from `attemptScrollActiveTabIntoView` so a
// regression in the math (e.g. someone replaces the centre with a
// left-align) is caught here:
//   ideal  = layout.x + layout.width / 2 - viewportWidth / 2
//   target = clamp(ideal, 0, contentWidth - viewportWidth)
function expectedScrollX(
  label: string,
  viewportWidth: number,
  contentWidth: number,
): number {
  const layout = TAB_LAYOUTS.find((t) => t.label === label);
  if (!layout) throw new Error(`Unknown tab: ${label}`);
  const ideal = layout.x + layout.width / 2 - viewportWidth / 2;
  const maxScroll = contentWidth - viewportWidth;
  return Math.max(0, Math.min(maxScroll, ideal));
}

describe("RecapScreen — horizontal tab bar auto-scroll", () => {
  beforeEach(() => {
    mockScrollTo.mockReset();
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockReset();
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  test("on first mount, once layouts settle, the active tab is scrolled into view (non-animated)", async () => {
    const view = render(<RecapScreen />);
    await flushAsyncStorage();

    // Drive the three independent measurements in their natural
    // order: segments first (each Pressable's onLayout fires as it
    // mounts), then the scroller's viewport, then the content
    // width once the inner row has measured itself. The handler
    // must gate on ALL three before scrolling — until then every
    // attemptScrollActiveTabIntoView() call is a no-op.
    reportTabSegmentLayouts(view, TAB_LAYOUTS);
    expect(mockScrollTo).not.toHaveBeenCalled();

    reportScrollerViewportLayout(view, VIEWPORT_NARROW);
    expect(mockScrollTo).not.toHaveBeenCalled();

    reportScrollerContentSize(view, CONTENT_NARROW);

    // "Today" sits at the very left. Its centred ideal is negative
    // (-120), so the clamp pins us to the start of the scrollable
    // range. The first scroll is non-animated because the screen
    // hasn't completed an initial scroll yet — the user must LAND
    // on the right offset, not see the bar slide in from elsewhere.
    expect(mockScrollTo).toHaveBeenCalled();
    const lastCall = mockScrollTo.mock.calls.at(-1)![0];
    expect(lastCall).toEqual({
      x: expectedScrollX("Today recap", VIEWPORT_NARROW, CONTENT_NARROW),
      animated: false,
    });
    expect(lastCall.x).toBe(0);
  });

  test("switching to a tab off the right edge scrolls it into view (animated after the initial paint)", async () => {
    const view = render(<RecapScreen />);
    await flushAsyncStorage();

    reportTabSegmentLayouts(view, TAB_LAYOUTS);
    reportScrollerViewportLayout(view, VIEWPORT_NARROW);
    reportScrollerContentSize(view, CONTENT_NARROW);

    // Initial scroll happened — clear the recorder so the tab-change
    // assertion only sees the post-switch call. If we didn't reset
    // here a regression that fires the second scroll non-animated
    // would slip past us (the call still exists, just with the wrong
    // shape).
    expect(mockScrollTo).toHaveBeenCalled();
    mockScrollTo.mockClear();

    // Tap the right-most preset tab. With viewport 300 and content
    // 700, max scroll is 400 and the centred target for "Past 365
    // days" is 295 — well inside the scrollable range, so the clamp
    // is a no-op and we get the raw centred value.
    act(() => {
      fireEvent.press(view.getByLabelText("Past 365 days recap"));
    });

    expect(mockScrollTo).toHaveBeenCalledTimes(1);
    expect(mockScrollTo).toHaveBeenCalledWith({
      x: expectedScrollX(
        "Past 365 days recap",
        VIEWPORT_NARROW,
        CONTENT_NARROW,
      ),
      animated: true,
    });
  });

  test("no-op on wide layouts where every tab already fits the viewport", async () => {
    const view = render(<RecapScreen />);
    await flushAsyncStorage();

    // Same segments, but the viewport is now WIDER than the content.
    // The handler's wide-layout guard must short-circuit before
    // touching the scroller — otherwise we'd be jiggling the bar on
    // tablets / large phones where the affordance isn't needed and
    // any scroll is visible noise.
    const VIEWPORT_WIDE = 700;
    const CONTENT_FITS = 600;

    reportTabSegmentLayouts(view, TAB_LAYOUTS);
    reportScrollerViewportLayout(view, VIEWPORT_WIDE);
    reportScrollerContentSize(view, CONTENT_FITS);

    expect(mockScrollTo).not.toHaveBeenCalled();

    // Switching tabs on a wide layout must also stay a no-op — the
    // guard applies on every attemptScroll call, not just the
    // initial paint.
    act(() => {
      fireEvent.press(view.getByLabelText("Past 365 days recap"));
    });
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  test("persisted active tab from AsyncStorage triggers the same auto-scroll once layouts arrive (non-animated)", async () => {
    // Simulate reopening Recap on the right-most preset the user was
    // last on. `getItem` returns "year" for the tab key and null for
    // the custom-range key — same shape the live AsyncStorage hands
    // back when only the tab has been persisted.
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === RECAP_TAB_STORAGE_KEY) return Promise.resolve("year");
      if (key === RECAP_CUSTOM_RANGE_STORAGE_KEY) return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const view = render(<RecapScreen />);

    // The mount effect's Promise.all needs to resolve and the
    // resulting setActiveTab("year") needs to flush before we
    // dispatch layouts — otherwise we'd be testing the default
    // "today" path again.
    await flushAsyncStorage();

    reportTabSegmentLayouts(view, TAB_LAYOUTS);
    reportScrollerViewportLayout(view, VIEWPORT_NARROW);
    reportScrollerContentSize(view, CONTENT_NARROW);

    // The screen restored "year" without the user ever tapping a tab,
    // so the FIRST scroll must still be non-animated — the user opens
    // the screen and lands on the right offset, no slide-in animation
    // narrating a state change they didn't make.
    expect(mockScrollTo).toHaveBeenCalled();
    const firstCall = mockScrollTo.mock.calls[0][0];
    expect(firstCall).toEqual({
      x: expectedScrollX("Past 365 days recap", VIEWPORT_NARROW, CONTENT_NARROW),
      animated: false,
    });
    // Sanity: the centred target is non-zero (the persisted tab was
    // genuinely off-screen). If this drifted to 0 we'd be silently
    // back to "today" without noticing.
    expect(firstCall.x).toBeGreaterThan(0);
  });
});
