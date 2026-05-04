/**
 * Pre-launch polish lock-in (Task #176): on the Insights cold-start
 * view, when the server pattern fetch fails we surface a small
 * "Couldn't refresh — try again" pill so the user knows the first
 * generation didn't go through. Tapping the pill must re-run the
 * load so a transient network blip can recover without leaving the
 * tab.
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

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
const mockAuth = { user: { email: "user@example.com", id: "u1" } };
const mockSubscription = { status: { is_pro: false } };

jest.mock("expo-router", () => ({
  useRouter: () => mockRouterApi,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const ReactLib = require("react");
    ReactLib.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === "function" ? cleanup : undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  },
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

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => mockSubscription,
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

jest.mock("@/components/ProUpsellCard", () => ({
  ProUpsellCard: () => null,
}));

jest.mock("@/lib/aliveUI", () => ({
  useBreathingEnabled: () => false,
}));

jest.mock("@/lib/animationTokens", () => ({
  cardEntering: () => undefined,
}));

const mockLoadStoredPatterns = jest.fn();
jest.mock("@/lib/aiEngineStorage", () => ({
  loadStoredPatterns: (email: string) => mockLoadStoredPatterns(email),
}));

const mockFetchPatternsFromServer = jest.fn();
jest.mock("@/lib/aiEngine", () => ({
  fetchPatternsFromServer: (email: string) =>
    mockFetchPatternsFromServer(email),
}));

import InsightsScreen from "../insights";

const PILL_LABEL = "Couldn't refresh insights, try again";

describe("InsightsScreen — cold-start refresh-error pill", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Truly cold: no stored envelope, so pickInsightsView lands on
    // "cold_start" (because !patterns => isColdStart === true).
    mockLoadStoredPatterns.mockResolvedValue(null);
  });

  test("shows the 'Couldn't refresh — try again' pill when fetchPatternsFromServer rejects", async () => {
    mockFetchPatternsFromServer.mockRejectedValue(new Error("network down"));

    const view = render(<InsightsScreen />);

    const pill = await waitFor(() => view.getByLabelText(PILL_LABEL));
    expect(pill).toBeTruthy();
    expect(view.getByText("Couldn't refresh — try again")).toBeTruthy();
    expect(mockFetchPatternsFromServer).toHaveBeenCalledTimes(1);
  });

  test("pressing the pill re-runs the load (fetchPatternsFromServer fires again)", async () => {
    mockFetchPatternsFromServer.mockRejectedValue(new Error("network down"));

    const view = render(<InsightsScreen />);
    const pill = await waitFor(() => view.getByLabelText(PILL_LABEL));

    expect(mockFetchPatternsFromServer).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(pill);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockFetchPatternsFromServer).toHaveBeenCalledTimes(2);
    });
  });
});
