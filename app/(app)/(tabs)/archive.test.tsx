import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

// Animation wrappers don't change the tree we care about; collapse them
// to plain pass-throughs so we don't have to mock reanimated's worklet
// machinery for an interaction-only test.
jest.mock("@/components/alive/BreatheCard", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    BreatheCard: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      ReactLib.createElement(RNView, { style }, children),
  };
});

jest.mock("@/components/alive/SettleOnMount", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    SettleOnMount: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      ReactLib.createElement(RNView, { style }, children),
  };
});

// Toast renders its message Text unconditionally (visibility is just an
// animated opacity), so we can't infer "is the toast visible" from the
// rendered text alone. Mock it to surface its `visible` prop verbatim.
jest.mock("@/components/Toast", () => {
  const ReactLib = require("react");
  const { Text: RNText, View: RNView } = require("react-native");
  return {
    Toast: ({ visible, message }: { visible: boolean; message: string }) =>
      ReactLib.createElement(
        RNView,
        { testID: "retry-toast" },
        ReactLib.createElement(
          RNText,
          { testID: "retry-toast-visible" },
          visible ? "yes" : "no",
        ),
        ReactLib.createElement(
          RNText,
          { testID: "retry-toast-message" },
          message,
        ),
      ),
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: jest.fn() }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: { is_pro: true } }),
}));

// Stubbable MemoriesContext. Tests reassign the fields below so each
// case can wire a different `retryMemorySync` outcome / memory list.
type RetryOutcome = "synced" | "failed" | "noop";
const mockMemoriesStub: {
  memories: unknown[];
  todayMemories: unknown[];
  lastSearchWasOffline: boolean;
  addMemory: jest.Mock;
  addCall: jest.Mock;
  updateMemory: jest.Mock;
  deleteMemory: jest.Mock;
  refreshMemories: jest.Mock;
  searchMemories: jest.Mock;
  isLoading: boolean;
  stuckSyncCount: number;
  retrySync: jest.Mock;
  retryMemorySync: jest.Mock<Promise<RetryOutcome>, [string]>;
} = {
  memories: [],
  todayMemories: [],
  lastSearchWasOffline: false,
  addMemory: jest.fn(),
  addCall: jest.fn(),
  updateMemory: jest.fn(),
  deleteMemory: jest.fn(),
  refreshMemories: jest.fn().mockResolvedValue(undefined),
  searchMemories: jest.fn().mockResolvedValue([]),
  isLoading: false,
  stuckSyncCount: 0,
  retrySync: jest.fn().mockResolvedValue(undefined),
  retryMemorySync: jest.fn<Promise<RetryOutcome>, [string]>(),
};

// We expose a "notify" callback list so tests can trigger a real
// React re-render of every consumer after mutating the stub. This
// mirrors how the real provider would push setMemories down to
// useMemories consumers — without it, mutating mockMemoriesStub.memories
// is invisible to React (no setState was called) and the screen never
// re-renders after a successful retry.
const mockMemoriesSubscribers = new Set<() => void>();
function mockNotifyMemoriesChange() {
  for (const fn of mockMemoriesSubscribers) fn();
}

jest.mock("@/context/MemoriesContext", () => {
  const ReactLib = require("react");
  return {
    useMemories: () => {
      const [, force] = ReactLib.useReducer((x: number) => x + 1, 0);
      ReactLib.useEffect(() => {
        mockMemoriesSubscribers.add(force);
        return () => {
          mockMemoriesSubscribers.delete(force);
        };
      }, []);
      return mockMemoriesStub;
    },
  };
});

// Imported AFTER the mocks are registered — order matters because
// expo-router and the contexts are resolved eagerly inside the screen
// module.
import ArchiveScreen from "./archive";

const RETRY_BADGE_LABEL = "Saved offline, tap to retry sync";
const RETRY_BADGE_HINT = "Retries syncing this memory";
const SYNCED_BADGE_LABEL = "Synced";
const TOAST_VISIBLE_TEST_ID = "retry-toast-visible";

function makeFailedRow(id: string, content = "stuck offline draft") {
  // Recent timestamp keeps the row inside the Pro library window so
  // it renders as a normal editable card (and therefore exposes the
  // MemorySyncStatus badge), not the LockedMemoryCard tease.
  return {
    id,
    userId: "user@example.com",
    content,
    timestamp: new Date().toISOString(),
    kind: "memory",
    pendingSync: true,
    syncFailed: true,
  };
}

function makeSyncedRow(id: string, content = "happily synced draft") {
  // Same shape as makeFailedRow but cleared of the pending/failed
  // flags so MemorySyncStatus renders the muted "Synced" indicator.
  return {
    id,
    userId: "user@example.com",
    content,
    timestamp: new Date().toISOString(),
    kind: "memory",
    pendingSync: false,
    syncFailed: false,
  };
}

function resetMemoriesStub() {
  mockMemoriesStub.memories = [];
  mockMemoriesStub.todayMemories = [];
  mockMemoriesStub.lastSearchWasOffline = false;
  mockMemoriesStub.stuckSyncCount = 0;
  mockMemoriesStub.refreshMemories = jest.fn().mockResolvedValue(undefined);
  mockMemoriesStub.searchMemories = jest.fn().mockResolvedValue([]);
  mockMemoriesStub.retrySync = jest.fn().mockResolvedValue(undefined);
  mockMemoriesStub.retryMemorySync = jest.fn<Promise<RetryOutcome>, [string]>();
  mockMemoriesStub.deleteMemory = jest.fn();
}

beforeEach(() => {
  resetMemoriesStub();
});

describe("ArchiveScreen — per-row tap-to-retry on the offline badge", () => {
  test("tapping a failed badge calls retryMemorySync with that row's id", async () => {
    const row = makeFailedRow("mem-target");
    mockMemoriesStub.memories = [
      makeFailedRow("mem-other", "another stuck draft"),
      row,
    ];
    mockMemoriesStub.retryMemorySync.mockResolvedValue("noop");

    const view = render(<ArchiveScreen />);

    // Both failed rows render their own pressable badge — we want to
    // assert the tapped one's id is the one passed through, so tap
    // the SECOND badge and verify the second row's id is forwarded.
    const badges = await waitFor(() => {
      const found = view.getAllByLabelText(RETRY_BADGE_LABEL);
      expect(found.length).toBe(2);
      return found;
    });

    await act(async () => {
      fireEvent.press(badges[1]);
    });

    expect(mockMemoriesStub.retryMemorySync).toHaveBeenCalledTimes(1);
    expect(mockMemoriesStub.retryMemorySync).toHaveBeenCalledWith("mem-target");
  });

  test('"failed" outcome surfaces the "Still offline" toast', async () => {
    mockMemoriesStub.memories = [makeFailedRow("mem-1")];
    mockMemoriesStub.retryMemorySync.mockResolvedValue("failed");

    const view = render(<ArchiveScreen />);
    const badge = await waitFor(() => view.getByLabelText(RETRY_BADGE_LABEL));

    expect(view.getByTestId(TOAST_VISIBLE_TEST_ID).props.children).toBe("no");

    await act(async () => {
      fireEvent.press(badge);
    });

    expect(view.getByTestId(TOAST_VISIBLE_TEST_ID).props.children).toBe("yes");
    expect(view.getByTestId("retry-toast-message").props.children).toBe(
      "Still offline — try again later",
    );
  });

  test('"synced" outcome surfaces the success toast and the badge re-renders as synced', async () => {
    const row = makeFailedRow("mem-2");
    mockMemoriesStub.memories = [row];
    mockMemoriesStub.retryMemorySync.mockResolvedValue("synced");

    const view = render(<ArchiveScreen />);
    const badge = await waitFor(() => view.getByLabelText(RETRY_BADGE_LABEL));

    expect(view.getByTestId(TOAST_VISIBLE_TEST_ID).props.children).toBe("no");

    await act(async () => {
      fireEvent.press(badge);
    });

    // The badge silently flipping is easy to miss on a long list, so
    // a successful per-row retry now also fires a brief positive
    // confirmation toast. The badge transition below still happens —
    // the toast just makes the success readable too.
    expect(view.getByTestId(TOAST_VISIBLE_TEST_ID).props.children).toBe("yes");
    expect(view.getByTestId("retry-toast-message").props.children).toBe(
      "Saved to your library",
    );

    // Simulate the post-retry state the real provider applies via its
    // outcomes handler: clear the pending/syncFailed flags on the row
    // and notify subscribers so the screen re-reads the updated list
    // through useMemories.
    mockMemoriesStub.memories = [
      { ...row, pendingSync: false, syncFailed: false },
    ];
    await act(async () => {
      mockNotifyMemoriesChange();
    });

    // The retry badge is gone; the synced indicator takes its place.
    await waitFor(() => {
      expect(view.queryByLabelText(RETRY_BADGE_LABEL)).toBeNull();
      expect(view.getByLabelText("Synced")).toBeTruthy();
    });
  });

  test('"noop" outcome (race with heartbeat) shows no toast', async () => {
    mockMemoriesStub.memories = [makeFailedRow("mem-3")];
    mockMemoriesStub.retryMemorySync.mockResolvedValue("noop");

    const view = render(<ArchiveScreen />);
    const badge = await waitFor(() => view.getByLabelText(RETRY_BADGE_LABEL));

    await act(async () => {
      fireEvent.press(badge);
    });

    expect(mockMemoriesStub.retryMemorySync).toHaveBeenCalledWith("mem-3");
    // The drained-by-heartbeat case must stay silent — the badge has
    // already disappeared on the heartbeat tick, a toast here would
    // be misleading noise.
    expect(view.getByTestId(TOAST_VISIBLE_TEST_ID).props.children).toBe("no");
  });

  test('"Sync all" header button no longer crashes (regression: undefined `pinnedMemories`)', async () => {
    // Regression coverage for the Pre-launch Round 2 blocker fix:
    // handleSyncAll previously read `pinnedMemories.length`, a name
    // that didn't exist anywhere in the file. Tapping the button
    // crashed the screen to the global ErrorBoundary. The fix
    // derives the snapshot from filteredMemories.filter(isPendingOrFailed)
    // — this test would have caught the original crash, and it pins
    // the toast wording to the new pre-drain count.

    // Need at least 2 pending rows so the pinned-header renders the
    // "Sync all" affordance (single-row case hides it intentionally).
    mockMemoriesStub.memories = [
      makeFailedRow("mem-a", "first stuck"),
      makeFailedRow("mem-b", "second stuck"),
      makeFailedRow("mem-c", "third stuck"),
    ];
    mockMemoriesStub.retrySync = jest
      .fn()
      .mockResolvedValue({ synced: 2, failed: 1 });

    const view = render(<ArchiveScreen />);
    const syncAll = await waitFor(() =>
      view.getByLabelText("Sync all 3 pending memories"),
    );

    expect(view.getByTestId(TOAST_VISIBLE_TEST_ID).props.children).toBe("no");

    await act(async () => {
      fireEvent.press(syncAll);
    });

    // Two of three drained, one still pending — the toast frames the
    // result against the user's pre-tap visible count (3), confirming
    // pendingBefore is wired to the right list.
    expect(mockMemoriesStub.retrySync).toHaveBeenCalledTimes(1);
    expect(view.getByTestId(TOAST_VISIBLE_TEST_ID).props.children).toBe("yes");
    expect(view.getByTestId("retry-toast-message").props.children).toBe(
      "2 of 3 synced — 1 still pending",
    );
  });

  test('"Sync all" full-success path frames the count correctly', async () => {
    // Companion case to the partial-success test: every visible row
    // drains, so the toast falls into the "All N memories synced"
    // branch. Also reaches handleSyncAll without crashing — second
    // line of defense against the `pinnedMemories` regression.
    mockMemoriesStub.memories = [
      makeFailedRow("mem-x", "x"),
      makeFailedRow("mem-y", "y"),
    ];
    mockMemoriesStub.retrySync = jest
      .fn()
      .mockResolvedValue({ synced: 2, failed: 0 });

    const view = render(<ArchiveScreen />);
    const syncAll = await waitFor(() =>
      view.getByLabelText("Sync all 2 pending memories"),
    );

    await act(async () => {
      fireEvent.press(syncAll);
    });

    expect(view.getByTestId(TOAST_VISIBLE_TEST_ID).props.children).toBe("yes");
    expect(view.getByTestId("retry-toast-message").props.children).toBe(
      "All 2 memories synced",
    );
  });

  test("a second tap during an in-flight retry is ignored (retryingId lock)", async () => {
    mockMemoriesStub.memories = [makeFailedRow("mem-lock")];
    // Hold the retry mid-flight so we can fire a second press while
    // the first is still pending. If the lock is wired correctly the
    // second press becomes a no-op and retryMemorySync is only called
    // once for this id.
    let releaseRetry: (v: RetryOutcome) => void = () => {};
    mockMemoriesStub.retryMemorySync.mockImplementation(
      () =>
        new Promise<RetryOutcome>((resolve) => {
          releaseRetry = resolve;
        }),
    );

    const view = render(<ArchiveScreen />);
    const badge = await waitFor(() => view.getByLabelText(RETRY_BADGE_LABEL));

    await act(async () => {
      fireEvent.press(badge);
      // Let the press handler enter retryMemorySync (it sets the
      // retryingId lock synchronously before awaiting). A second tap
      // after this point should be swallowed.
      await Promise.resolve();
    });

    expect(mockMemoriesStub.retryMemorySync).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(badge);
      await Promise.resolve();
    });

    // Lock held → still only one call.
    expect(mockMemoriesStub.retryMemorySync).toHaveBeenCalledTimes(1);

    // Release the in-flight retry so React doesn't complain about
    // unresolved state updates after the test ends.
    await act(async () => {
      releaseRetry("failed");
      await Promise.resolve();
    });
  });
});

describe("ArchiveScreen — offline search banner", () => {
  test("banner is hidden when lastSearchWasOffline is false", async () => {
    mockMemoriesStub.lastSearchWasOffline = false;

    const view = render(<ArchiveScreen />);

    // Type a query; banner condition requires non-empty search
    await act(async () => {
      fireEvent.changeText(
        view.getByPlaceholderText("Search memories..."),
        "hello",
      );
    });

    // Flag is false → banner must stay hidden regardless of query
    expect(view.queryByTestId("offline-search-banner")).toBeNull();
  });

  test("banner appears when lastSearchWasOffline is true and a query is active", async () => {
    mockMemoriesStub.lastSearchWasOffline = false;

    const view = render(<ArchiveScreen />);

    // Type a search term
    await act(async () => {
      fireEvent.changeText(
        view.getByPlaceholderText("Search memories..."),
        "hello",
      );
    });

    // No banner yet — search hasn't failed
    expect(view.queryByTestId("offline-search-banner")).toBeNull();

    // Simulate context reporting an offline fallback
    mockMemoriesStub.lastSearchWasOffline = true;
    await act(async () => {
      mockNotifyMemoriesChange();
    });

    expect(view.getByTestId("offline-search-banner")).toBeTruthy();
    expect(
      view.getByText("Showing offline matches — couldn't reach the server"),
    ).toBeTruthy();
  });

  test("banner is hidden when query is empty even if lastSearchWasOffline is true", async () => {
    mockMemoriesStub.lastSearchWasOffline = true;

    const view = render(<ArchiveScreen />);

    // No query typed → banner must stay hidden
    await act(async () => {
      mockNotifyMemoriesChange();
    });

    expect(view.queryByTestId("offline-search-banner")).toBeNull();
  });

  test("dismiss button hides the banner", async () => {
    mockMemoriesStub.lastSearchWasOffline = true;

    const view = render(<ArchiveScreen />);

    // Type a query so the banner condition is met
    await act(async () => {
      fireEvent.changeText(
        view.getByPlaceholderText("Search memories..."),
        "hello",
      );
    });

    expect(view.getByTestId("offline-search-banner")).toBeTruthy();

    // Tap the dismiss button
    await act(async () => {
      fireEvent.press(
        view.getByLabelText("Dismiss offline search notice"),
      );
    });

    expect(view.queryByTestId("offline-search-banner")).toBeNull();
  });

  test("banner re-appears after dismiss when a new offline result fires", async () => {
    mockMemoriesStub.lastSearchWasOffline = true;

    const view = render(<ArchiveScreen />);

    // Type a query so the banner shows
    await act(async () => {
      fireEvent.changeText(
        view.getByPlaceholderText("Search memories..."),
        "hello",
      );
    });
    expect(view.getByTestId("offline-search-banner")).toBeTruthy();

    // Dismiss the banner
    await act(async () => {
      fireEvent.press(view.getByLabelText("Dismiss offline search notice"));
    });
    expect(view.queryByTestId("offline-search-banner")).toBeNull();

    // Simulate a successful server search (clears the flag) — dismiss resets
    mockMemoriesStub.lastSearchWasOffline = false;
    await act(async () => {
      mockNotifyMemoriesChange();
    });

    // …then a new offline fallback for the next query
    mockMemoriesStub.lastSearchWasOffline = true;
    await act(async () => {
      mockNotifyMemoriesChange();
    });

    // Banner must re-appear because the dismiss was reset by the success
    expect(view.getByTestId("offline-search-banner")).toBeTruthy();
  });
});

describe("ArchiveScreen — sync badge accessibility labels", () => {
  // These tests pin the screen-reader contract for MemorySyncStatus so
  // a refactor that drops the labels (e.g. swapping the Pressable for
  // an icon-only View) breaks CI instead of silently shipping an
  // unusable badge to VoiceOver / TalkBack users.

  test("failed badge exposes a button role with both an a11y label and hint that explain the retry action", async () => {
    mockMemoriesStub.memories = [makeFailedRow("mem-a11y-failed")];
    mockMemoriesStub.retryMemorySync.mockResolvedValue("noop");

    const view = render(<ArchiveScreen />);

    const badge = await waitFor(() => view.getByLabelText(RETRY_BADGE_LABEL));

    // Role must be "button" so VoiceOver announces it as actionable
    // (otherwise it reads as a static image and the user has no idea
    // they can double-tap to recover their stuck entry).
    expect(badge.props.accessibilityRole).toBe("button");

    // Label is the "what" — a hint without a label leaves the user
    // hearing "double tap to retry syncing this entry" with no context
    // about WHY the entry is stuck.
    expect(badge.props.accessibilityLabel).toBe(RETRY_BADGE_LABEL);

    // Hint is the "what happens if I activate this" — together with
    // VoiceOver's automatic "double tap to activate", this becomes
    // "Saved offline, tap to retry sync. Double tap to activate.
    //  Retries syncing this entry."
    expect(badge.props.accessibilityHint).toBe(RETRY_BADGE_HINT);

    // Sanity: querying directly by the hint text returns the same node,
    // so a future refactor that drops the hint while keeping the label
    // also fails this test.
    expect(view.getByHintText(RETRY_BADGE_HINT)).toBe(badge);
  });

  test("synced badge exposes the 'Synced' a11y label and is NOT announced as a button", async () => {
    mockMemoriesStub.memories = [makeSyncedRow("mem-a11y-synced")];

    const view = render(<ArchiveScreen />);

    const badge = await waitFor(() => view.getByLabelText(SYNCED_BADGE_LABEL));

    // The synced state is passive — it must NOT be a button (there is
    // nothing to retry) so screen readers don't promise an action that
    // does nothing. Role "image" is fine; "button" is the regression
    // we're guarding against.
    expect(badge.props.accessibilityRole).not.toBe("button");
    expect(badge.props.accessibilityLabel).toBe(SYNCED_BADGE_LABEL);

    // And no hint should leak in — the synced state has no action so
    // a hint would be misleading.
    expect(badge.props.accessibilityHint).toBeUndefined();

    // The retry-button label must be absent from the synced surface,
    // otherwise we'd be telling the user a happily-synced row is stuck.
    expect(view.queryByLabelText(RETRY_BADGE_LABEL)).toBeNull();
  });
});
