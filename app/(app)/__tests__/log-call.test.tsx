/**
 * Screen-level coverage for the cooldown branch on the Log-a-call
 * screen (`app/(app)/log-call.tsx`, line 59). Mirror of the Capture
 * test (Task #138) — log-a-call also creates a memory and shares the
 * exact same cooldown contract, so both screens must stay in lockstep:
 *
 *   1. `addCall` throws `CaptureBlockedError` →
 *      `Alert.alert` is called with the cooldown title + copy, AND
 *   2. `router.replace("/subscription")` is NOT called.
 *
 * Without this, log-a-call could silently regress while the Capture
 * branch remains correct, leaving one of the two memory-creation
 * surfaces routing blocked users into the upsell.
 */
import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

import {
  CAPTURE_COOLDOWN_ALERT_BODY,
  CAPTURE_COOLDOWN_ALERT_TITLE,
  CaptureBlockedError,
} from "@/lib/subscription";

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockAddCall = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    push: jest.fn(),
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#fff",
    border: "#ccc",
    primary: "#007aff",
    primaryForeground: "#fff",
    mutedForeground: "#666",
    radius: 8,
  }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "u1@test" } }),
}));

jest.mock("@/context/MemoriesContext", () => ({
  useMemories: () => ({
    addCall: mockAddCall,
    todayMemories: [],
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({
    status: { is_pro: false },
  }),
}));

jest.mock("@/components/ProUpsellCard", () => ({
  ProUpsellCard: () => null,
}));

import LogCallScreen from "../log-call";

describe("LogCallScreen — cooldown branch (Task #138)", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddCall.mockReset();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("addCall throws CaptureBlockedError → cooldown alert fires AND no /subscription redirect", async () => {
    // mockImplementationOnce (not mockRejectedValueOnce) — same
    // reason as the Capture test: the eager form trips jest's
    // unhandled-rejection watcher and deadlocks act().
    mockAddCall.mockImplementationOnce(() =>
      Promise.reject(new CaptureBlockedError()),
    );

    const view = render(<LogCallScreen />);

    // Both fields must be filled — the handler early-exits when
    // either is empty, which would mask the bug.
    fireEvent.changeText(
      view.getByPlaceholderText("Who did you speak with?"),
      "Alex",
    );
    fireEvent.changeText(
      view.getByPlaceholderText("What was discussed?"),
      "weekend plans",
    );

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    // 1. Cooldown alert popped with the locked title + body. Asserting
    //    against the *same* shared constants the screen uses (instead
    //    of re-typing the strings or matching with regex) means the
    //    screen and the test cannot drift together to a wrong-but-
    //    consistent message — a future copy tweak is one line in
    //    subscription.ts and both screens + both tests pick it up.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, body] = alertSpy.mock.calls[0];
    expect(title).toBe(CAPTURE_COOLDOWN_ALERT_TITLE);
    expect(body).toBe(CAPTURE_COOLDOWN_ALERT_BODY);

    // 2. No upsell redirect — log-a-call honors the same "blocked is
    //    not an upsell" rule as Capture.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  test("addCall succeeds → no cooldown alert, save flow proceeds normally", async () => {
    mockAddCall.mockResolvedValueOnce({ syncedToCloud: true });

    const view = render(<LogCallScreen />);
    fireEvent.changeText(
      view.getByPlaceholderText("Who did you speak with?"),
      "Alex",
    );
    fireEvent.changeText(
      view.getByPlaceholderText("What was discussed?"),
      "weekend plans",
    );

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    expect(mockAddCall).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
