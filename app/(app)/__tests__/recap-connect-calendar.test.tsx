/**
 * Pre-launch polish lock-in (Task #176): when calendar permission is
 * denied the Recap screen replaces the silent empty "Tomorrow's
 * events" strip with an inline "Connect calendar" affordance that
 * opens iOS/Android Settings on press. Without this regression
 * coverage a refactor of `recap.tsx` could quietly drop the
 * affordance and the user would never discover the integration
 * exists.
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

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
  destructive: "#ef4444",
  accent: "#5eead4",
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

const CONNECT_LABEL = "Connect calendar to see tomorrow's events";

describe("RecapScreen — calendar-permission-denied 'Connect calendar' affordance", () => {
  test("renders the inline Connect calendar button and opens settings on press", async () => {
    const openSettingsSpy = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue(undefined as unknown as void);

    const view = render(<RecapScreen />);

    const button = await waitFor(() => view.getByLabelText(CONNECT_LABEL));
    expect(button).toBeTruthy();
    expect(view.getByText("Connect calendar")).toBeTruthy();

    await act(async () => {
      fireEvent.press(button);
    });

    expect(openSettingsSpy).toHaveBeenCalledTimes(1);

    openSettingsSpy.mockRestore();
  });
});
