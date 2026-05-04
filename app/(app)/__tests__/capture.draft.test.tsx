/**
 * Screen-level coverage for the Task #319 draft-persistence wiring on
 * the Capture screen. The lib-level helper is locked by
 * `lib/captureDraftStore.test.ts`; this file pins the *screen*
 * contract:
 *
 *   1. Typing into the body restores after a fresh mount.
 *   2. A successful save clears the persisted draft.
 *   3. Tapping the close (cancel) button clears the persisted draft.
 *   4. A different signed-in user does not see another user's draft.
 */
import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

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

// The user id flips between test cases via the swappable getter so
// the same module-level mock can simulate an account switch.
let mockCurrentUserId: string | null = "alice";
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mockCurrentUserId ? { id: mockCurrentUserId, email: `${mockCurrentUserId}@t` } : null,
  }),
}));

jest.mock("@/context/MemoriesContext", () => ({
  useMemories: () => ({
    addMemory: mockAddMemory,
    todayMemories: [],
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: { is_pro: false } }),
}));

jest.mock("@/components/ProUpsellCard", () => ({ ProUpsellCard: () => null }));

import AsyncStorage from "@react-native-async-storage/async-storage";

import CaptureScreen from "../capture";

const mockedStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

// Simple in-memory backing store so the load-after-write flow walks
// through the real lib/captureDraftStore.ts logic. Tests still
// inspect setItem / removeItem call counts to verify behaviour.
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

describe("CaptureScreen — draft persistence (Task #319)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedStorage.getItem.mockReset();
    mockedStorage.setItem.mockReset();
    mockedStorage.removeItem.mockReset();
    mockReplace.mockReset();
    mockBack.mockReset();
    mockAddMemory.mockReset();
    mockCurrentUserId = "alice";
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("typing in the body persists, and a fresh mount restores it", async () => {
    const store = installInMemoryStorage();

    const first = render(<CaptureScreen />);
    // First mount: load resolves to null, hydrates empty.
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      first.getByPlaceholderText("What's on your mind?"),
      "in-progress note",
    );
    // Advance past the 800ms debounce so the draft lands.
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);
    first.unmount();

    // Fresh mount: the same user comes back. Draft must restore.
    const second = render(<CaptureScreen />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      second.getByPlaceholderText("What's on your mind?").props.value,
    ).toBe("in-progress note");
  });

  test("a successful save clears the persisted draft", async () => {
    const store = installInMemoryStorage();
    mockAddMemory.mockResolvedValueOnce({ syncedToCloud: true, id: "m1" });

    const view = render(<CaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getByPlaceholderText("What's on your mind?"),
      "save me",
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

    // The screen calls clearDraft after a successful save → store
    // is wiped and the next mount won't restore anything.
    expect(store.size).toBe(0);
  });

  test("tapping close (discard) clears the persisted draft", async () => {
    const store = installInMemoryStorage();

    const view = render(<CaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getByPlaceholderText("What's on your mind?"),
      "throwaway",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);

    await act(async () => {
      fireEvent.press(view.getByLabelText("Discard capture"));
      await Promise.resolve();
    });

    expect(mockBack).toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  test("cooldown block (CaptureBlockedError) clears the persisted draft", async () => {
    const store = installInMemoryStorage();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { CaptureBlockedError } = jest.requireActual("@/lib/subscription");
    mockAddMemory.mockImplementationOnce(() =>
      Promise.reject(new CaptureBlockedError()),
    );

    const view = render(<CaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getByPlaceholderText("What's on your mind?"),
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

    // Draft is dropped per task brief — a relaunch after the block
    // shouldn't restore the rejected note.
    expect(store.size).toBe(0);
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test("saving before the debounce fires does not let the timer revive the draft", async () => {
    const store = installInMemoryStorage();
    mockAddMemory.mockResolvedValueOnce({ syncedToCloud: true, id: "m1" });
    const view = render(<CaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getByPlaceholderText("What's on your mind?"),
      "fast typist",
    );
    // Press Save while the 800ms debounce is still pending.
    await act(async () => {
      jest.advanceTimersByTime(100);
      fireEvent.press(view.getByText("Save"));
      await Promise.resolve();
    });
    // Now let any stale timers fire — they must NOT re-persist.
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
    mockAddMemory.mockImplementationOnce(() =>
      Promise.reject(new CaptureBlockedError()),
    );

    const view = render(<CaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getByPlaceholderText("What's on your mind?"),
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

    // Alice is signed in and has typed something.
    mockCurrentUserId = "alice";
    const view = render(<CaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getByPlaceholderText("What's on your mind?"),
      "alice text",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.size).toBe(1);

    // Same screen stays mounted; auth flips to Bob (no prior draft).
    mockCurrentUserId = "bob";
    await act(async () => {
      view.rerender(<CaptureScreen />);
      await Promise.resolve();
    });

    // Bob's view should not show Alice's text — the field is reset
    // to empty since Bob has no stored draft.
    expect(view.getByPlaceholderText("What's on your mind?").props.value).toBe(
      "",
    );
  });

  test("a different user does not see another user's draft", async () => {
    const store = installInMemoryStorage();

    // Alice writes a draft.
    mockCurrentUserId = "alice";
    const aliceView = render(<CaptureScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.changeText(
      aliceView.getByPlaceholderText("What's on your mind?"),
      "alice secret",
    );
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });
    aliceView.unmount();
    expect(store.size).toBe(1);

    // Bob signs in on the same device.
    mockCurrentUserId = "bob";
    const bobView = render(<CaptureScreen />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      bobView.getByPlaceholderText("What's on your mind?").props.value,
    ).toBe("");
  });
});
