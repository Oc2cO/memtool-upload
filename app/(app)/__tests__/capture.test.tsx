/**
 * Screen-level coverage for the cooldown branch on the Capture screen
 * (`app/(app)/capture.tsx`, line 67). Task #121 introduced
 * `CaptureBlockedError` so a server-side auto-blocked account sees a
 * calm "you're blocked for the rest of the day" alert instead of the
 * generic upsell. Task #127 pinned the data-layer translation; this
 * test pins the *screen-level* contract:
 *
 *   1. `addMemory` throws `CaptureBlockedError` →
 *      `Alert.alert` is called with the cooldown title + copy, AND
 *   2. `router.replace("/subscription")` is NOT called.
 *
 * Without this, a future refactor of `handleSave` could route a
 * blocked user into the upsell flow — exactly the user-facing bug the
 * `CaptureBlockedError` split was designed to prevent.
 *
 * The Capture screen pulls in expo-router, safe-area, and several
 * contexts; we mock the hook surface so the screen can mount without
 * a full provider tree, then drive the Save button.
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
const mockAddMemory = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    push: jest.fn(),
  }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const cleanup = cb();
    if (typeof cleanup === "function") cleanup();
  },
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
    addMemory: mockAddMemory,
    todayMemories: [],
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({
    status: { is_pro: false },
  }),
}));

// ProUpsellCard pulls in expo-linear-gradient and the AliveButton
// surface. The cooldown branch keeps the user under the cap (so the
// upsell card never renders), but stubbing it keeps the import graph
// light and protects against drift if the screen starts rendering it.
jest.mock("@/components/ProUpsellCard", () => ({
  ProUpsellCard: () => null,
}));

import CaptureScreen from "../capture";

describe("CaptureScreen — cooldown branch (Task #138)", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddMemory.mockReset();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("addMemory throws CaptureBlockedError → cooldown alert fires AND no /subscription redirect", async () => {
    // Use mockImplementationOnce instead of mockRejectedValueOnce so
    // the rejection is created lazily inside the handler's await,
    // not at mock-setup time. The eager form leaves jest's
    // unhandled-rejection watcher briefly seeing an orphan rejection
    // which then deadlocks the act() wrapper.
    mockAddMemory.mockImplementationOnce(() =>
      Promise.reject(new CaptureBlockedError()),
    );

    const view = render(<CaptureScreen />);

    // Type something so the Save button enables — the handler early-
    // exits when the content is empty, which would mask the bug.
    const input = view.getByPlaceholderText("What's on your mind?");
    fireEvent.changeText(input, "hello world");

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    // 1. The cooldown alert was popped, with the calm copy that calls
    //    out the auto-clear at UTC midnight. Asserting against the
    //    *same* shared constants the screen uses (instead of re-typing
    //    the strings or matching with regex) means the screen and the
    //    test cannot drift together to a wrong-but-consistent message
    //    — any future copy tweak is a one-line change in subscription.ts
    //    and both screens + both tests pick it up automatically.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, body] = alertSpy.mock.calls[0];
    expect(title).toBe(CAPTURE_COOLDOWN_ALERT_TITLE);
    expect(body).toBe(CAPTURE_COOLDOWN_ALERT_BODY);

    // 2. Critically, the user was NOT routed to the upsell. This is
    //    the whole reason `CaptureBlockedError` exists as a separate
    //    type from `CaptureLimitReachedError` — a blocked account has
    //    no Pro plan to buy out of, and pushing them at /subscription
    //    would feel like an upsell trap.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  test("addMemory succeeds → no cooldown alert, save flow proceeds normally", async () => {
    // Sanity baseline so the cooldown assertion above isn't trivially
    // satisfied by a screen that pops the alert on every save.
    mockAddMemory.mockResolvedValueOnce({ syncedToCloud: true });

    const view = render(<CaptureScreen />);
    const input = view.getByPlaceholderText("What's on your mind?");
    fireEvent.changeText(input, "hello world");

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
    });

    expect(mockAddMemory).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
