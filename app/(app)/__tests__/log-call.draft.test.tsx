/**
 * Screen-level coverage for the Task #319 draft-persistence wiring on
 * the Log-a-Call screen. Mirror of `capture.draft.test.tsx` — the
 * lib-level helper is locked separately by
 * `lib/captureDraftStore.test.ts`; this file pins the *screen*
 * contract:
 *
 *   1. Typing into person + note persists, and a fresh mount restores both.
 *   2. A successful save clears the persisted draft.
 *   3. Tapping the close (cancel) button clears the persisted draft.
 *   4. A different signed-in user does not see another user's draft.
 */
import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

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

let mockCurrentUserId: string | null = "alice";
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mockCurrentUserId ? { id: mockCurrentUserId, email: `${mockCurrentUserId}@t` } : null,
  }),
}));

jest.mock("@/context/MemoriesContext", () => ({
  useMemories: () => ({
    addCall: mockAddCall,
    todayMemories: [],
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: { is_pro: false } }),
}));

jest.mock("@/components/ProUpsellCard", () => ({ ProUpsellCard: () => null }));

import AsyncStorage from "@react-native-async-storage/async-storage";

import LogCallScreen from "../log-call";

const mockedStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

function installInMemoryStorage() {
  const map = new Map<string, string>();
  mockedStorage.getItem.mockImplementation((k: string) =>
    Promise.resolve(map.has(k) ? (map.get(k) as string) : null),
  );
  mockedStorage.setItem.mockImplementation((k: string, v: string) => {
    map.set(k, v);
    return Promise.resolve();
  });
  mockedStorage.removeItem.mockImplementation((k: string) => {
    map.delete(k);
    return Promise.resolve();
  });
  return map;
}

describe("LogCallScreen — draft persistence (Task #319)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedStorage.getItem.mockReset();
    mockedStorage.setItem.mockReset();
    mockedStorage.removeItem.mockReset();
    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddCall.mockReset();
    mockCurrentUserId = "alice";
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("typing person + note persists, and a fresh mount restores both", async () => {
    const store = installInMemoryStorage();

    const first = render(<LogCallScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      first.getByPlaceholderText("Who did you speak with?"),
      "Alex",
    );
    fireEvent.changeText(
      first.getByPlaceholderText("What was discussed?"),
      "weekend plans",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);
    first.unmount();

    const second = render(<LogCallScreen />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      second.getByPlaceholderText("Who did you speak with?").props.value,
    ).toBe("Alex");
    expect(
      second.getByPlaceholderText("What was discussed?").props.value,
    ).toBe("weekend plans");
  });

  test("a successful save clears the persisted draft", async () => {
    const store = installInMemoryStorage();
    mockAddCall.mockResolvedValueOnce({ syncedToCloud: true });

    const view = render(<LogCallScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getByPlaceholderText("Who did you speak with?"),
      "Alex",
    );
    fireEvent.changeText(
      view.getByPlaceholderText("What was discussed?"),
      "weekend plans",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
      await Promise.resolve();
    });

    expect(store.size).toBe(0);
  });

  test("tapping close (discard) clears the persisted draft", async () => {
    const store = installInMemoryStorage();

    const view = render(<LogCallScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getByPlaceholderText("Who did you speak with?"),
      "Alex",
    );
    fireEvent.changeText(
      view.getByPlaceholderText("What was discussed?"),
      "throwaway",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);

    await act(async () => {
      fireEvent.press(view.getByLabelText("Discard log call"));
      await Promise.resolve();
    });

    expect(mockBack).toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  test("cooldown block (CaptureBlockedError) clears the persisted draft", async () => {
    const store = installInMemoryStorage();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { CaptureBlockedError } = jest.requireActual("@/lib/subscription");
    mockAddCall.mockImplementationOnce(() =>
      Promise.reject(new CaptureBlockedError()),
    );

    const view = render(<LogCallScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getByPlaceholderText("Who did you speak with?"),
      "Alex",
    );
    fireEvent.changeText(
      view.getByPlaceholderText("What was discussed?"),
      "blocked attempt",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);

    await act(async () => {
      fireEvent.press(view.getByText("Save"));
      await Promise.resolve();
    });

    expect(store.size).toBe(0);
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test("saving before the debounce fires does not let the timer revive the draft", async () => {
    const store = installInMemoryStorage();
    mockAddCall.mockResolvedValueOnce({ syncedToCloud: true, id: "c1" });
    const view = render(<LogCallScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getByPlaceholderText("Who did you speak with?"),
      "Alex",
    );
    fireEvent.changeText(
      view.getByPlaceholderText("What was discussed?"),
      "fast typist",
    );
    await act(async () => {
      jest.advanceTimersByTime(100);
      fireEvent.press(view.getByText("Save"));
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(store.size).toBe(0);
  });

  test("blocked save before the debounce fires also keeps storage cleared", async () => {
    const store = installInMemoryStorage();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { CaptureBlockedError } = jest.requireActual("@/lib/subscription");
    mockAddCall.mockImplementationOnce(() =>
      Promise.reject(new CaptureBlockedError()),
    );

    const view = render(<LogCallScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getByPlaceholderText("Who did you speak with?"),
      "Alex",
    );
    fireEvent.changeText(
      view.getByPlaceholderText("What was discussed?"),
      "blocked fast",
    );
    await act(async () => {
      jest.advanceTimersByTime(100);
      fireEvent.press(view.getByText("Save"));
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(store.size).toBe(0);
    alertSpy.mockRestore();
  });

  test("hot account switch on a mounted screen wipes the previous user's text", async () => {
    const store = installInMemoryStorage();

    mockCurrentUserId = "alice";
    const view = render(<LogCallScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getByPlaceholderText("Who did you speak with?"),
      "Mom",
    );
    fireEvent.changeText(
      view.getByPlaceholderText("What was discussed?"),
      "alice text",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);

    mockCurrentUserId = "bob";
    await act(async () => {
      view.rerender(<LogCallScreen />);
      await Promise.resolve();
    });

    expect(
      view.getByPlaceholderText("Who did you speak with?").props.value,
    ).toBe("");
    expect(
      view.getByPlaceholderText("What was discussed?").props.value,
    ).toBe("");
  });

  test("a different user does not see another user's draft", async () => {
    const store = installInMemoryStorage();

    mockCurrentUserId = "alice";
    const aliceView = render(<LogCallScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      aliceView.getByPlaceholderText("Who did you speak with?"),
      "Alex",
    );
    fireEvent.changeText(
      aliceView.getByPlaceholderText("What was discussed?"),
      "alice secret",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    aliceView.unmount();
    expect(store.size).toBe(1);

    mockCurrentUserId = "bob";
    const bobView = render(<LogCallScreen />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      bobView.getByPlaceholderText("Who did you speak with?").props.value,
    ).toBe("");
    expect(
      bobView.getByPlaceholderText("What was discussed?").props.value,
    ).toBe("");
  });
});
