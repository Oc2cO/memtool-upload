/**
 * UI-level coverage for the Settings → "Export your memories" flow
 * when `fetchAllMemoriesForExport` falls back to the offline cache
 * (`usedCache: true`). The whole interactive branch — the "Cached
 * copy" alert, the AbortError-on-Cancel contract, the warning
 * share-sheet title, and the network-retry loop — lives in
 * `confirmCachedCopyExport` + the Host's performExport mirror so it's
 * mountable in jest. The real Settings screen pulls in expo-router /
 * fonts / animations and can't be rendered here, same reason as the
 * `handleExportError` extraction.
 *
 * Each test renders a tiny Host that mirrors the real `performExport`
 * sequence (fetch → cached-copy prompt → maybe retry → writeAndShare),
 * with the fetch and share calls mocked. We then drive the alert via
 * the captured button list and assert on the resulting share call (or
 * the lack of one) and on the error banner.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

import {
  CACHED_COPY_ALERT_TITLE,
  CACHED_COPY_SHARE_TITLE,
  DEFAULT_EXPORT_SHARE_TITLE,
  buildCachedCopyAlertMessage,
  confirmCachedCopyExport,
} from "./exportCachePrompt";
import { handleExportError } from "./exportErrorHandler";
import { buildJsonExport, buildCsvExport } from "./memoriesExport";
import type { Memory } from "./memories";

const mockFetch = jest.fn();
const mockWriteAndShare = jest.fn();

interface CapturedAlert {
  title: string;
  message?: string;
  buttons?: Array<{
    text?: string;
    style?: "default" | "cancel" | "destructive";
    onPress?: () => void;
  }>;
}

interface HostProps {
  onAlert: (alert: CapturedAlert) => void;
}

// Mirrors `performExport` in artifacts/memtool/app/(app)/(tabs)/settings.tsx
// closely enough to exercise the real cached-copy branch end-to-end:
// fetch → confirmCachedCopyExport → (maybe retry →) writeAndShare,
// with the same AbortError-as-user-cancel contract in the catch block
// and the same retry loop semantics.
function Host({ onAlert }: HostProps) {
  const [exportError, setExportError] = useState<string | null>(null);

  const onPress = async () => {
    try {
      let memories: Array<{ id: string }> = [];
      let usedCache = false;
      // Sticky across the loop — false on the very first prompt of
      // this export, true for every re-pop afterwards. Mirrors the
      // `hasPromptedForCachedCopy` flag in the real performExport so
      // the softer "Still couldn't reach the server" copy gets
      // exercised end-to-end (Task #142).
      let hasPromptedForCachedCopy = false;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await mockFetch();
        memories = result.memories;
        usedCache = result.usedCache;

        if (!usedCache) break;

        const outcome = await confirmCachedCopyExport({
          memoryCount: memories.length,
          isRetry: hasPromptedForCachedCopy,
          alert: (title, message, buttons) => {
            onAlert({ title, message, buttons });
          },
        });
        hasPromptedForCachedCopy = true;
        if (outcome === "resolve") break;
        if (outcome === "cancel") {
          const cancelErr = new Error("Cancelled");
          cancelErr.name = "AbortError";
          throw cancelErr;
        }
        // outcome === "retry" → loop and refetch
      }

      const shareTitle = usedCache
        ? CACHED_COPY_SHARE_TITLE
        : DEFAULT_EXPORT_SHARE_TITLE;
      await mockWriteAndShare(
        "memtool-memories.json",
        "[]",
        "application/json",
        shareTitle,
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User-cancel — same as the real performExport. Crucially,
        // this branch must NOT call setExportError, otherwise Cancel
        // would look like a server error to the user.
        return;
      }
      handleExportError(err, {
        setExportError,
        logout: () => {},
        alert: () => {},
      });
    }
  };

  return (
    <View>
      <Pressable onPress={onPress} accessibilityLabel="Run export">
        <Text>Run export</Text>
      </Pressable>
      {exportError !== null && (
        <Text testID="export-error">{exportError}</Text>
      )}
    </View>
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  mockWriteAndShare.mockReset();
});

describe("Export cached-copy prompt — Settings export flow", () => {
  test("usedCache: true → pops the 'Cached copy' alert with the warning copy and Try again / Continue / Cancel buttons", async () => {
    mockFetch.mockResolvedValueOnce({
      usedCache: true,
      memories: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
    const onAlert = jest.fn();

    const view = render(<Host onAlert={onAlert} />);
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    // 1. Exactly one alert was popped, with the right title.
    expect(onAlert).toHaveBeenCalledTimes(1);
    const captured = onAlert.mock.calls[0][0] as CapturedAlert;
    expect(captured.title).toBe(CACHED_COPY_ALERT_TITLE);

    // 2. Message warns the user the export may be incomplete and
    //    includes the actual cached-memory count so they can decide.
    expect(captured.message).toBe(buildCachedCopyAlertMessage(3));
    expect(captured.message).toMatch(/Older memories may be missing/);
    expect(captured.message).toMatch(/3 found/);

    // 3. All three buttons are offered, and Cancel is styled as the
    //    cancel role so iOS bolds Continue as the default.
    const continueBtn = captured.buttons?.find((b) => b.text === "Continue");
    const cancelBtn = captured.buttons?.find((b) => b.text === "Cancel");
    const retryBtn = captured.buttons?.find((b) => b.text === "Try again");
    expect(continueBtn).toBeDefined();
    expect(cancelBtn).toBeDefined();
    expect(retryBtn).toBeDefined();
    expect(cancelBtn?.style).toBe("cancel");

    // 4. The share sheet must NOT have opened yet — the prompt is
    //    blocking by design.
    expect(mockWriteAndShare).not.toHaveBeenCalled();
  });

  test("Continue → invokes writeAndShare with the warning share title (not the default)", async () => {
    mockFetch.mockResolvedValueOnce({
      usedCache: true,
      memories: [{ id: "1" }, { id: "2" }],
    });
    let capturedAlert: CapturedAlert | null = null;
    const onAlert = (a: CapturedAlert) => {
      capturedAlert = a;
    };

    const view = render(<Host onAlert={onAlert} />);
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    // Sanity-check the alert fired before driving Continue.
    expect(capturedAlert).not.toBeNull();
    const continueBtn = capturedAlert!.buttons!.find(
      (b) => b.text === "Continue",
    );
    expect(continueBtn).toBeDefined();

    // Tapping Continue resolves the prompt promise and lets the rest
    // of performExport (the share call) run to completion.
    await act(async () => {
      continueBtn!.onPress!();
    });

    expect(mockWriteAndShare).toHaveBeenCalledTimes(1);
    const shareTitle = mockWriteAndShare.mock.calls[0][3];
    expect(shareTitle).toBe(CACHED_COPY_SHARE_TITLE);
    // Defensive: regression guard against accidentally falling back to
    // the default title and silently dropping the warning copy.
    expect(shareTitle).not.toBe(DEFAULT_EXPORT_SHARE_TITLE);

    // Continue is a happy-path branch — no error banner should show.
    expect(view.queryByTestId("export-error")).toBeNull();
  });

  test("Cancel → skips the share entirely and does NOT surface an error banner", async () => {
    mockFetch.mockResolvedValueOnce({
      usedCache: true,
      memories: [{ id: "1" }],
    });
    let capturedAlert: CapturedAlert | null = null;
    const onAlert = (a: CapturedAlert) => {
      capturedAlert = a;
    };

    const view = render(<Host onAlert={onAlert} />);
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    expect(capturedAlert).not.toBeNull();
    const cancelBtn = capturedAlert!.buttons!.find((b) => b.text === "Cancel");
    expect(cancelBtn).toBeDefined();

    // Tapping Cancel resolves the prompt with "cancel", which the Host
    // (mirroring performExport) translates into an AbortError that the
    // catch block silently swallows.
    await act(async () => {
      cancelBtn!.onPress!();
    });

    // Hard guarantees:
    //   1. Share never opens — Cancel really means cancel.
    //   2. The user does NOT see "Couldn't build your export" — that
    //      would imply a server failure, which is misleading because
    //      the user themselves opted out.
    expect(mockWriteAndShare).not.toHaveBeenCalled();
    expect(view.queryByTestId("export-error")).toBeNull();
  });

  test("Try again → network now works → re-fetches, skips the prompt, shares with the DEFAULT title", async () => {
    // Real-world case: user tapped Export on the subway, by the time
    // the alert appears they're back on wifi. Try again must re-run
    // fetchAllMemoriesForExport, get fresh data (usedCache: false),
    // and proceed with no warning copy on the share sheet — otherwise
    // the saved file would still claim "Cached copy".
    mockFetch
      .mockResolvedValueOnce({
        usedCache: true,
        memories: [{ id: "stale-1" }],
      })
      .mockResolvedValueOnce({
        usedCache: false,
        memories: [{ id: "fresh-1" }, { id: "fresh-2" }],
      });

    let capturedAlert: CapturedAlert | null = null;
    const onAlert = jest.fn((a: CapturedAlert) => {
      capturedAlert = a;
    });

    const view = render(<Host onAlert={onAlert} />);
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    // First attempt fell back to cache → prompt fired.
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(capturedAlert).not.toBeNull();
    const retryBtn = capturedAlert!.buttons!.find(
      (b) => b.text === "Try again",
    );
    expect(retryBtn).toBeDefined();

    await act(async () => {
      retryBtn!.onPress!();
    });

    // Refetch happened (2 fetch calls total) and the prompt did NOT
    // re-pop because the second attempt got fresh data.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(onAlert).toHaveBeenCalledTimes(1);

    // Critically: the share runs with the DEFAULT title, not the
    // warning one — the recipient must not see "Cached copy" on a
    // share that contains fresh server data.
    expect(mockWriteAndShare).toHaveBeenCalledTimes(1);
    expect(mockWriteAndShare.mock.calls[0][3]).toBe(
      DEFAULT_EXPORT_SHARE_TITLE,
    );
    expect(view.queryByTestId("export-error")).toBeNull();
  });

  test("Try again → still offline → re-pops the alert with softened copy; user can then Continue with cached data", async () => {
    // The retry loop must be re-entrant: a failed retry (still
    // usedCache: true) re-pops the prompt rather than silently
    // proceeding or silently aborting. Continue from the second prompt
    // proceeds with the cached data and the warning share title.
    //
    // Task #142: the second prompt's *message* must also differ from
    // the first — the user just watched the "Retrying network…"
    // indicator come and go, so re-popping the identical "Couldn't
    // reach the server" copy reads as if the failure is being
    // announced for the first time. The softened lead-in
    // ("Still couldn't reach the server — your network looks down")
    // acknowledges the retry the user just saw.
    mockFetch
      .mockResolvedValueOnce({
        usedCache: true,
        memories: [{ id: "cached-1" }, { id: "cached-2" }],
      })
      .mockResolvedValueOnce({
        usedCache: true,
        memories: [{ id: "cached-1" }, { id: "cached-2" }],
      });

    const onAlert = jest.fn();
    let lastAlert: CapturedAlert | null = null;
    onAlert.mockImplementation((a: CapturedAlert) => {
      lastAlert = a;
    });

    const view = render(<Host onAlert={onAlert} />);
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    // First prompt — uses the original first-attempt copy. Pinning
    // this here (not just in the dedicated copy test below) protects
    // the Task #131/#132 happy-path wording from drifting if the
    // softened-copy branch is later edited carelessly.
    expect(onAlert).toHaveBeenCalledTimes(1);
    const firstAlert = onAlert.mock.calls[0][0] as CapturedAlert;
    expect(firstAlert.message).toBe(buildCachedCopyAlertMessage(2));
    expect(firstAlert.message).not.toMatch(/^Still couldn't reach/);

    const firstRetry = firstAlert.buttons!.find((b) => b.text === "Try again");
    expect(firstRetry).toBeDefined();
    await act(async () => {
      firstRetry!.onPress!();
    });

    // Retry was attempted but still came back cached, so the alert
    // re-pops with the same option set (Try again still available, as
    // do Continue/Cancel).
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(onAlert).toHaveBeenCalledTimes(2);
    expect(lastAlert).not.toBeNull();
    const secondPrompt = lastAlert as unknown as CapturedAlert;
    const secondPromptButtons = secondPrompt.buttons!;
    expect(
      secondPromptButtons.find((b) => b.text === "Continue"),
    ).toBeDefined();
    expect(
      secondPromptButtons.find((b) => b.text === "Cancel"),
    ).toBeDefined();

    // Task #142: the re-popped prompt's message is *visibly different*
    // from the first prompt and matches the retry-aware builder
    // output. Asserting both `!=` and `===` guards against (a) someone
    // collapsing both branches back into one string and (b) someone
    // editing the retry copy without updating the builder.
    expect(secondPrompt.message).not.toBe(firstAlert.message);
    expect(secondPrompt.message).toBe(
      buildCachedCopyAlertMessage(2, { isRetry: true }),
    );
    expect(secondPrompt.message).toMatch(/^Still couldn't reach the server/);
    // Memory count is still surfaced so the user can decide.
    expect(secondPrompt.message).toMatch(/2 found/);

    // Share has not fired yet — the second prompt is still blocking.
    expect(mockWriteAndShare).not.toHaveBeenCalled();

    // Continue from the second prompt — must proceed with the WARNING
    // share title because we're shipping cached data.
    const secondContinue = secondPromptButtons.find(
      (b) => b.text === "Continue",
    );
    await act(async () => {
      secondContinue!.onPress!();
    });

    expect(mockWriteAndShare).toHaveBeenCalledTimes(1);
    expect(mockWriteAndShare.mock.calls[0][3]).toBe(CACHED_COPY_SHARE_TITLE);
    expect(view.queryByTestId("export-error")).toBeNull();
  });

  test("usedCache: false → no prompt, share runs with the default title", async () => {
    mockFetch.mockResolvedValueOnce({
      usedCache: false,
      memories: [{ id: "1" }],
    });
    const onAlert = jest.fn();

    const view = render(<Host onAlert={onAlert} />);
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    // Fresh server data: no warning prompt, default share title.
    expect(onAlert).not.toHaveBeenCalled();
    expect(mockWriteAndShare).toHaveBeenCalledTimes(1);
    expect(mockWriteAndShare.mock.calls[0][3]).toBe(
      DEFAULT_EXPORT_SHARE_TITLE,
    );
    expect(view.queryByTestId("export-error")).toBeNull();
  });
});

// Mirrors performExport's *retry indicator* lifecycle (Task #136): a
// boolean state that flips on right before the follow-up fetch awaits
// and back off the moment that fetch resolves. The fetch here is a
// deferred promise the test controls so we can assert on the indicator
// state mid-flight — the existing `mockFetch` resolves synchronously
// in microtasks and would never give the test a chance to observe the
// "Retrying network…" sub-label otherwise.
interface DeferredFetch {
  promise: Promise<{ usedCache: boolean; memories: Array<{ id: string }> }>;
  resolve: (value: { usedCache: boolean; memories: Array<{ id: string }> }) => void;
}
function makeDeferred(): DeferredFetch {
  let resolve!: DeferredFetch["resolve"];
  const promise = new Promise<{
    usedCache: boolean;
    memories: Array<{ id: string }>;
  }>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface RetryHostProps {
  fetchQueue: DeferredFetch[];
  onAlert: (alert: CapturedAlert) => void;
}

function RetryHost({ fetchQueue, onAlert }: RetryHostProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [shareTitle, setShareTitle] = useState<string | null>(null);

  const onPress = async () => {
    let memories: Array<{ id: string }> = [];
    let usedCache = false;
    let isRetryAttempt = false;
    // Sticky companion to `isRetryAttempt`: that one gets cleared the
    // moment the fetch resolves so the "Retrying network…" indicator
    // doesn't bleed under a re-popped alert. This one stays true once
    // the prompt has fired even once, so we can soften the wording on
    // every subsequent re-pop (Task #142).
    let hasPromptedForCachedCopy = false;
    let queueIdx = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (isRetryAttempt) setIsRetrying(true);
        const result = await fetchQueue[queueIdx++].promise;
        setIsRetrying(false);
        isRetryAttempt = false;
        memories = result.memories;
        usedCache = result.usedCache;
        if (!usedCache) break;
        const outcome = await confirmCachedCopyExport({
          memoryCount: memories.length,
          isRetry: hasPromptedForCachedCopy,
          alert: (title, message, buttons) => {
            onAlert({ title, message, buttons });
          },
        });
        hasPromptedForCachedCopy = true;
        if (outcome === "resolve") break;
        if (outcome === "cancel") {
          const cancelErr = new Error("Cancelled");
          cancelErr.name = "AbortError";
          throw cancelErr;
        }
        isRetryAttempt = true;
      }
      setShareTitle(
        usedCache ? CACHED_COPY_SHARE_TITLE : DEFAULT_EXPORT_SHARE_TITLE,
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      throw err;
    }
  };

  return (
    <View>
      <Pressable onPress={onPress} accessibilityLabel="Run export">
        <Text>Run export</Text>
      </Pressable>
      {isRetrying && <Text testID="retrying-indicator">Retrying network…</Text>}
      {shareTitle !== null && <Text testID="share-title">{shareTitle}</Text>}
    </View>
  );
}

describe("Export retry indicator — Task #136", () => {
  test("first attempt does NOT show 'Retrying network…' even while the fetch is in flight", async () => {
    // The indicator only makes sense after the user has explicitly
    // tapped "Try again" — flashing it on the very first attempt
    // would imply something already failed, which is misleading when
    // they just opened the export menu.
    const first = makeDeferred();
    const onAlert = jest.fn();
    const view = render(
      <RetryHost fetchQueue={[first]} onAlert={onAlert} />,
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    // The first fetch is intentionally still pending here — no
    // indicator yet because this is not a retry.
    expect(view.queryByTestId("retrying-indicator")).toBeNull();

    // Resolve with fresh data so the host can complete cleanly.
    await act(async () => {
      first.resolve({ usedCache: false, memories: [{ id: "1" }] });
    });
    expect(view.queryByTestId("retrying-indicator")).toBeNull();
  });

  test("after Try again → indicator is visible while the follow-up fetch is in flight, then clears before the share runs", async () => {
    const first = makeDeferred();
    const second = makeDeferred();
    let captured: CapturedAlert | null = null;
    const onAlert = (a: CapturedAlert) => {
      captured = a;
    };

    const view = render(
      <RetryHost fetchQueue={[first, second]} onAlert={onAlert} />,
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    // First attempt resolves cached → cached-copy prompt fires.
    await act(async () => {
      first.resolve({ usedCache: true, memories: [{ id: "stale" }] });
    });
    expect(captured).not.toBeNull();
    const retryBtn = (captured as unknown as CapturedAlert)!.buttons!.find(
      (b) => b.text === "Try again",
    );
    expect(retryBtn).toBeDefined();

    await act(async () => {
      retryBtn!.onPress!();
    });

    // Follow-up fetch is in flight → indicator must be on now. This
    // is the whole point of the task: a slow retry no longer looks
    // identical to the pre-retry exporting state.
    expect(view.queryByTestId("retrying-indicator")).not.toBeNull();
    // Share has not run yet — indicator is genuinely gating it.
    expect(view.queryByTestId("share-title")).toBeNull();

    // Retry resolves with fresh data → indicator must clear BEFORE
    // the share sheet opens. Asserting on the share-title testID
    // proves the share path actually ran while the indicator is gone.
    await act(async () => {
      second.resolve({
        usedCache: false,
        memories: [{ id: "fresh-1" }, { id: "fresh-2" }],
      });
    });
    expect(view.queryByTestId("retrying-indicator")).toBeNull();
    expect(view.queryByTestId("share-title")?.props.children).toBe(
      DEFAULT_EXPORT_SHARE_TITLE,
    );
  });

  test("after Try again → still cached → indicator clears BEFORE the alert re-pops", async () => {
    // The indicator must not linger underneath a re-popped prompt;
    // otherwise the user sees "Retrying network…" stacked behind a
    // dialog asking what to do, which contradicts itself (the retry
    // already finished — that's why the prompt is back).
    const first = makeDeferred();
    const second = makeDeferred();
    const onAlert = jest.fn();
    let lastAlert: CapturedAlert | null = null;
    onAlert.mockImplementation((a: CapturedAlert) => {
      lastAlert = a;
    });

    const view = render(
      <RetryHost fetchQueue={[first, second]} onAlert={onAlert} />,
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    await act(async () => {
      first.resolve({ usedCache: true, memories: [{ id: "stale" }] });
    });
    expect(onAlert).toHaveBeenCalledTimes(1);

    const firstRetry = (onAlert.mock.calls[0][0] as CapturedAlert)
      .buttons!.find((b) => b.text === "Try again");
    await act(async () => {
      firstRetry!.onPress!();
    });

    // Follow-up fetch in flight — indicator on.
    expect(view.queryByTestId("retrying-indicator")).not.toBeNull();

    // Retry resolves still-cached. The host must (a) clear the
    // indicator and (b) re-pop the alert. The contract this test
    // pins is that the indicator is *gone by the time the alert
    // appears*, which the assertion order below validates: alert was
    // popped twice AND the indicator is null afterwards.
    await act(async () => {
      second.resolve({ usedCache: true, memories: [{ id: "stale" }] });
    });
    expect(onAlert).toHaveBeenCalledTimes(2);
    expect(view.queryByTestId("retrying-indicator")).toBeNull();
    expect(lastAlert).not.toBeNull();
    // Sanity: the second prompt still offers the full button set so
    // the user can Cancel / Continue / Try again from here.
    const secondButtons = (lastAlert as unknown as CapturedAlert)!.buttons!;
    expect(secondButtons.find((b) => b.text === "Continue")).toBeDefined();
    expect(secondButtons.find((b) => b.text === "Cancel")).toBeDefined();
    expect(secondButtons.find((b) => b.text === "Try again")).toBeDefined();
  });
});

describe("buildCachedCopyAlertMessage — first-attempt vs retry copy (Task #142)", () => {
  test("first attempt (default) uses the original 'Couldn't reach the server' lead-in unchanged", () => {
    // The first-attempt copy is part of the Task #131/#132 contract
    // (the alert that the cached-copy share-sheet flow rests on). It
    // must stay byte-for-byte stable so that any happy-path snapshot
    // or string-equality assertion elsewhere doesn't drift, and so
    // the new `isRetry` opt-in is genuinely additive.
    expect(buildCachedCopyAlertMessage(7)).toBe(
      "Couldn't reach the server — this export contains only locally cached memories. Older memories may be missing (7 found).",
    );
    // Explicit `isRetry: false` must produce the same string as
    // omitting the option — the option is opt-in, not a behavioral
    // toggle that defaults to anything else.
    expect(buildCachedCopyAlertMessage(7, { isRetry: false })).toBe(
      buildCachedCopyAlertMessage(7),
    );
  });

  test("isRetry: true acknowledges the failed retry with 'Still couldn't reach the server' and still surfaces the count", () => {
    // The whole point of the softened copy: when the user just
    // watched the "Retrying network…" indicator come and go, the
    // re-popped alert should *acknowledge* that, not re-announce the
    // failure. The exact lead-in is pinned because the surrounding
    // task description called it out specifically.
    const msg = buildCachedCopyAlertMessage(4, { isRetry: true });
    expect(msg).toBe(
      "Still couldn't reach the server — your network looks down. This export contains only locally cached memories. Older memories may be missing (4 found).",
    );
    // The two branches must produce visibly different strings — a
    // regression that collapses both back into the same copy would
    // silently undo Task #142.
    expect(msg).not.toBe(buildCachedCopyAlertMessage(4));
    // The cached-memory count is still surfaced so the user can
    // make an informed Continue/Cancel decision on the second prompt.
    expect(msg).toMatch(/4 found/);
  });
});

describe("confirmCachedCopyExport — promise contract", () => {
  test("Cancel resolves the promise with the 'cancel' outcome", async () => {
    // The catch block in performExport keys off the "cancel" outcome
    // (translating it into an AbortError) to distinguish a user cancel
    // from a real failure. If this string ever changes, Cancel will
    // start surfacing as an error banner.
    let capturedButtons: CapturedAlert["buttons"];
    const promise = confirmCachedCopyExport({
      memoryCount: 5,
      alert: (_title, _message, buttons) => {
        capturedButtons = buttons;
      },
    });

    capturedButtons!.find((b) => b.text === "Cancel")!.onPress!();
    await expect(promise).resolves.toBe("cancel");
  });

  test("Continue resolves the promise with the 'resolve' outcome", async () => {
    let capturedButtons: CapturedAlert["buttons"];
    const promise = confirmCachedCopyExport({
      memoryCount: 0,
      alert: (_title, _message, buttons) => {
        capturedButtons = buttons;
      },
    });

    capturedButtons!.find((b) => b.text === "Continue")!.onPress!();
    await expect(promise).resolves.toBe("resolve");
  });

  test("Try again resolves the promise with the 'retry' outcome", async () => {
    // performExport's retry loop branches on this exact value to
    // re-run fetchAllMemoriesForExport in place. If the discriminator
    // ever changes, Try again will silently fall through to either
    // the cached share or an aborted export.
    let capturedButtons: CapturedAlert["buttons"];
    const promise = confirmCachedCopyExport({
      memoryCount: 2,
      alert: (_title, _message, buttons) => {
        capturedButtons = buttons;
      },
    });

    capturedButtons!.find((b) => b.text === "Try again")!.onPress!();
    await expect(promise).resolves.toBe("retry");
  });
});

/**
 * End-to-end coverage for the *bytes that land on disk*. The host tests
 * above mock `writeAndShare` with a hard-coded `"[]"` content string so
 * they only cover the share-sheet title contract — they would happily
 * pass even if `performExport` stopped passing `{ usedCache }` into
 * `buildJsonExport` / `buildCsvExport` and the saved file silently
 * lost its in-file warning. That's exactly the regression Task #132
 * exists to lock down, so this block runs the *real* builders inside
 * the same performExport-shaped flow and asserts on the byte payload
 * handed to `writeAndShare`.
 */
interface FileHostProps {
  format: "json" | "csv";
  onAlert?: (alert: CapturedAlert) => void;
}

// Same shape as the Host above, but instead of stubbing the file
// content with `"[]"` it invokes the real `buildJsonExport` /
// `buildCsvExport` with `{ usedCache }` — mirroring the format branch
// in `performExport` (settings.tsx). The mocked `writeAndShare` then
// captures the actual bytes that would be persisted, so the assertions
// can pin the in-file warning end-to-end.
function FileHost({ format, onAlert }: FileHostProps) {
  const onPress = async () => {
    try {
      let memories: Memory[] = [];
      let usedCache = false;
      // Sticky across the loop — false on the very first prompt of
      // this export, true for every re-pop afterwards. Mirrors
      // performExport's `hasPromptedForCachedCopy` (Task #142).
      let hasPromptedForCachedCopy = false;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await mockFetch();
        memories = result.memories;
        usedCache = result.usedCache;

        if (!usedCache) break;

        const outcome = await confirmCachedCopyExport({
          memoryCount: memories.length,
          isRetry: hasPromptedForCachedCopy,
          alert: (title, message, buttons) => {
            onAlert?.({ title, message, buttons });
          },
        });
        hasPromptedForCachedCopy = true;
        if (outcome === "resolve") break;
        if (outcome === "cancel") {
          const cancelErr = new Error("Cancelled");
          cancelErr.name = "AbortError";
          throw cancelErr;
        }
        // outcome === "retry" → loop and refetch
      }

      const shareTitle = usedCache
        ? CACHED_COPY_SHARE_TITLE
        : DEFAULT_EXPORT_SHARE_TITLE;

      if (format === "json") {
        const content = buildJsonExport(memories, { usedCache });
        await mockWriteAndShare(
          "memtool-memories.json",
          content,
          "application/json",
          shareTitle,
        );
      } else {
        const content = buildCsvExport(memories, { usedCache });
        await mockWriteAndShare(
          "memtool-memories.csv",
          content,
          "text/csv",
          shareTitle,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      throw err;
    }
  };

  return (
    <Pressable onPress={onPress} accessibilityLabel="Run export">
      <Text>Run export</Text>
    </Pressable>
  );
}

// Minimal Memory factory — only the fields the builders actually read
// matter; everything else is `undefined` and falls through the
// builders' nullish-coalesce defaults exactly like a freshly-cached
// memory would.
function makeMemory(id: string, content: string): Memory {
  return {
    id,
    userId: "u1",
    content,
    timestamp: "2026-04-01T12:00:00.000Z",
    kind: "memory",
  };
}

describe("Saved file carries the cached-copy warning end-to-end", () => {
  test("JSON cached branch → file content has _export_metadata.cached === true and the warning note", async () => {
    mockFetch.mockResolvedValueOnce({
      usedCache: true,
      memories: [makeMemory("a", "first"), makeMemory("b", "second")],
    });
    let captured: CapturedAlert | null = null;

    const view = render(
      <FileHost
        format="json"
        onAlert={(a) => {
          captured = a;
        }}
      />,
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    // Drive Continue so the share path actually runs the real builder.
    expect(captured).not.toBeNull();
    const continueBtn = (captured as unknown as CapturedAlert)!
      .buttons!.find((b) => b.text === "Continue");
    expect(continueBtn).toBeDefined();
    await act(async () => {
      continueBtn!.onPress!();
    });

    // The bytes on disk — not just the share-sheet title — must
    // declare this file is a cached copy.
    expect(mockWriteAndShare).toHaveBeenCalledTimes(1);
    const [filename, content, mimeType, shareTitle] =
      mockWriteAndShare.mock.calls[0];
    expect(filename).toBe("memtool-memories.json");
    expect(mimeType).toBe("application/json");
    expect(shareTitle).toBe(CACHED_COPY_SHARE_TITLE);

    const parsed = JSON.parse(content as string) as {
      _export_metadata: { cached: boolean; exported_at: string; note?: string };
      memories: unknown[];
    };
    // Hard regression guards — if any of these flip, a recipient
    // opening the saved file later loses the warning.
    expect(parsed._export_metadata.cached).toBe(true);
    expect(typeof parsed._export_metadata.note).toBe("string");
    expect(parsed._export_metadata.note).toMatch(/Cached export/);
    expect(parsed._export_metadata.note).toMatch(/older memories may be missing/);
    expect(parsed.memories).toHaveLength(2);
  });

  test("CSV cached branch → file content begins with the leading '# Cached export — ...' row", async () => {
    mockFetch.mockResolvedValueOnce({
      usedCache: true,
      memories: [makeMemory("a", "first")],
    });
    let captured: CapturedAlert | null = null;

    const view = render(
      <FileHost
        format="csv"
        onAlert={(a) => {
          captured = a;
        }}
      />,
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    expect(captured).not.toBeNull();
    const continueBtn = (captured as unknown as CapturedAlert)!
      .buttons!.find((b) => b.text === "Continue");
    await act(async () => {
      continueBtn!.onPress!();
    });

    expect(mockWriteAndShare).toHaveBeenCalledTimes(1);
    const [filename, content, mimeType, shareTitle] =
      mockWriteAndShare.mock.calls[0];
    expect(filename).toBe("memtool-memories.csv");
    expect(mimeType).toBe("text/csv");
    expect(shareTitle).toBe(CACHED_COPY_SHARE_TITLE);

    // The first physical line of the CSV must be the comment row, not
    // the header row — most spreadsheet apps surface this as a visible
    // first row instead of dropping it silently.
    const firstLine = (content as string).split("\r\n")[0];
    expect(firstLine.startsWith("# Cached export — ")).toBe(true);
    expect(firstLine).toMatch(/older memories may be missing/);
    // And the header row still follows immediately after.
    const secondLine = (content as string).split("\r\n")[1];
    expect(secondLine).toBe(
      "created_at,kind,body,tags,person,is_starred,mood",
    );
  });

  test("JSON fresh branch → no warning note, _export_metadata.cached === false", async () => {
    mockFetch.mockResolvedValueOnce({
      usedCache: false,
      memories: [makeMemory("a", "first")],
    });
    const onAlert = jest.fn();

    const view = render(<FileHost format="json" onAlert={onAlert} />);
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    // No prompt, no Continue — share fires directly.
    expect(onAlert).not.toHaveBeenCalled();
    expect(mockWriteAndShare).toHaveBeenCalledTimes(1);
    const [, content, , shareTitle] = mockWriteAndShare.mock.calls[0];
    expect(shareTitle).toBe(DEFAULT_EXPORT_SHARE_TITLE);

    const parsed = JSON.parse(content as string) as {
      _export_metadata: { cached: boolean; note?: string };
    };
    // Symmetric regression guard: a fresh-server export must NOT
    // claim cached, and must NOT carry the warning note. The absence
    // of the key is itself a positive "fresh" signal for downstream
    // tooling per the builder docstring.
    expect(parsed._export_metadata.cached).toBe(false);
    expect(parsed._export_metadata.note).toBeUndefined();
  });

  test("CSV fresh branch → no leading '#' comment row, header is the first line", async () => {
    mockFetch.mockResolvedValueOnce({
      usedCache: false,
      memories: [makeMemory("a", "first")],
    });
    const onAlert = jest.fn();

    const view = render(<FileHost format="csv" onAlert={onAlert} />);
    await act(async () => {
      fireEvent.press(view.getByLabelText("Run export"));
    });

    expect(onAlert).not.toHaveBeenCalled();
    expect(mockWriteAndShare).toHaveBeenCalledTimes(1);
    const [, content, , shareTitle] = mockWriteAndShare.mock.calls[0];
    expect(shareTitle).toBe(DEFAULT_EXPORT_SHARE_TITLE);

    const firstLine = (content as string).split("\r\n")[0];
    // The header — not a comment row — must be the very first line of
    // a fresh-server export.
    expect(firstLine).toBe(
      "created_at,kind,body,tags,person,is_starred,mood",
    );
    expect((content as string).startsWith("#")).toBe(false);
  });
});
