/**
 * Unit coverage for the per-signature haptic mute preferences
 * (Task #243).
 *
 * What we're pinning here:
 *   1. Default state is "nothing muted" — playback gate stays open
 *      until a user has explicitly disabled a signature.
 *   2. `setHapticMuted(name, true)` updates the cache *immediately*
 *      so the next `play()` skips the pattern, even before
 *      AsyncStorage acknowledges the write.
 *   3. The mute map is persisted to AsyncStorage under the documented
 *      key as a JSON object — so the data survives app restart.
 *   4. `ensureHapticMutePrefsHydrated()` reads back what was written
 *      and only rehydrates *once* (idempotent — no extra storage hit
 *      on every Settings re-mount).
 *   5. Garbage in storage (malformed JSON, unknown signature names,
 *      non-boolean values) is filtered out instead of crashing or
 *      silently muting an unrelated signature.
 *   6. `setHapticMuted` is resilient to AsyncStorage write failures
 *      — the in-memory state still reflects the user's tap.
 *   7. `subscribeHapticMutePrefs` notifies on every change and the
 *      unsubscribe function actually unsubscribes.
 */
import { act, renderHook, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  HAPTIC_MUTE_PREFS_KEY,
  HAPTICS_MASTER_ENABLED_KEY,
  __resetHapticMutePrefsForTests,
  bootstrapHapticPreferences,
  ensureHapticMutePrefsHydrated,
  ensureHapticsMasterEnabledHydrated,
  getHapticMutePrefsCached,
  isHapticMutedCached,
  isHapticPreferencesReady,
  isHapticsMasterEnabledCached,
  setHapticMuted,
  setHapticsMasterEnabled,
  subscribeHapticMutePrefs,
  subscribeHapticsMasterEnabled,
  useHapticPreferencesReady,
} from "./preferences";

beforeEach(() => {
  __resetHapticMutePrefsForTests();
  (AsyncStorage.getItem as jest.Mock).mockReset();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockReset();
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

describe("getHapticMutePrefsCached / isHapticMutedCached", () => {
  it("defaults to an empty map so all signatures play before hydration", () => {
    expect(getHapticMutePrefsCached()).toEqual({});
    expect(isHapticMutedCached("capture")).toBe(false);
    expect(isHapticMutedCached("streak-extended")).toBe(false);
  });
});

describe("setHapticMuted", () => {
  it("flips the cache synchronously so the very next play() skips the pattern", async () => {
    const promise = setHapticMuted("streak-extended", true);
    // Critical: the cache must update BEFORE AsyncStorage resolves,
    // otherwise the playback layer would still fire the disabled
    // signature for the brief window between the user's tap and
    // the storage round-trip completing.
    expect(isHapticMutedCached("streak-extended")).toBe(true);
    await promise;
    expect(isHapticMutedCached("streak-extended")).toBe(true);
  });

  it("removes the key when muted=false so the persisted blob doesn't grow forever", async () => {
    await setHapticMuted("error", true);
    await setHapticMuted("error", false);
    expect(getHapticMutePrefsCached()).toEqual({});
    // The latest write should be the "false → removed" state.
    const calls = (AsyncStorage.setItem as jest.Mock).mock.calls;
    const lastWritten = JSON.parse(calls[calls.length - 1][1]);
    expect(lastWritten).toEqual({});
  });

  it("persists the mute map as JSON under the documented key", async () => {
    await setHapticMuted("capture", true);
    await setHapticMuted("undo", true);
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      HAPTIC_MUTE_PREFS_KEY,
      expect.any(String),
    );
    const lastCall = (AsyncStorage.setItem as jest.Mock).mock.calls.at(-1);
    expect(JSON.parse(lastCall![1])).toEqual({ capture: true, undo: true });
  });

  it("ignores unknown signature names so a future-renamed key can't poison the cache", async () => {
    await setHapticMuted(
      "not-a-real-signature" as Parameters<typeof setHapticMuted>[0],
      true,
    );
    expect(getHapticMutePrefsCached()).toEqual({});
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it("does not throw when AsyncStorage refuses the write — in-memory state still reflects the tap", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error("disk full"));
    await expect(setHapticMuted("capture", true)).resolves.toBeUndefined();
    expect(isHapticMutedCached("capture")).toBe(true);
  });
});

describe("ensureHapticMutePrefsHydrated", () => {
  it("reads the persisted map back into the cache so survives across launches", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ "streak-extended": true, error: true }),
    );
    const hydrated = await ensureHapticMutePrefsHydrated();
    expect(hydrated).toEqual({ "streak-extended": true, error: true });
    expect(isHapticMutedCached("streak-extended")).toBe(true);
    expect(isHapticMutedCached("error")).toBe(true);
    expect(isHapticMutedCached("capture")).toBe(false);
  });

  it("is idempotent — every Settings re-mount must NOT pay a fresh AsyncStorage round-trip", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ capture: true }),
    );
    await ensureHapticMutePrefsHydrated();
    await ensureHapticMutePrefsHydrated();
    await ensureHapticMutePrefsHydrated();
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
  });

  it("treats a read failure as 'nothing muted' — better than silently swallowing every haptic", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(
      new Error("storage offline"),
    );
    const hydrated = await ensureHapticMutePrefsHydrated();
    expect(hydrated).toEqual({});
    expect(isHapticMutedCached("capture")).toBe(false);
  });

  it("filters malformed JSON down to an empty map instead of crashing the app", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("{not json");
    expect(await ensureHapticMutePrefsHydrated()).toEqual({});
  });

  it("filters unknown signature names and non-boolean values out of stored blobs", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({
        capture: true,
        // Unknown name — dropped
        "old-signature-name": true,
        // Non-boolean — dropped
        error: "yes",
      }),
    );
    expect(await ensureHapticMutePrefsHydrated()).toEqual({ capture: true });
  });

  it("returns {} when the storage value is an array (invalid shape)", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify(["capture", "error"]),
    );
    expect(await ensureHapticMutePrefsHydrated()).toEqual({});
  });
});

describe("subscribeHapticMutePrefs", () => {
  it("notifies subscribers on every mute change with a fresh snapshot", async () => {
    const listener = jest.fn();
    subscribeHapticMutePrefs(listener);
    await setHapticMuted("capture", true);
    await setHapticMuted("error", true);
    await setHapticMuted("capture", false);

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenNthCalledWith(1, { capture: true });
    expect(listener).toHaveBeenNthCalledWith(2, { capture: true, error: true });
    expect(listener).toHaveBeenNthCalledWith(3, { error: true });
  });

  it("hands back an unsubscribe function that actually stops notifications", async () => {
    const listener = jest.fn();
    const unsub = subscribeHapticMutePrefs(listener);
    await setHapticMuted("capture", true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    await setHapticMuted("error", true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("hands subscribers a copy — mutating the snapshot must not bleed into the cache", async () => {
    let received: Record<string, boolean> | null = null;
    subscribeHapticMutePrefs((p) => {
      received = { ...p };
    });
    await setHapticMuted("capture", true);
    expect(received).toEqual({ capture: true });
    received!["error"] = true;
    expect(getHapticMutePrefsCached()).toEqual({ capture: true });
  });
});

// -------------------------------------------------------------
// Master "Haptics" switch (Task #252)
// -------------------------------------------------------------
//
// What we're pinning here:
//   1. Default state is "haptics on" — a brand-new install must
//      feel its haptics; a missing storage key, a malformed value,
//      or a read failure all fall back to ON so we never silently
//      swallow every signature.
//   2. `setHapticsMasterEnabled(false)` updates the cache
//      synchronously so the very next play() in the same tick
//      respects the user's tap.
//   3. The state is persisted under the documented key so it
//      survives an app relaunch.
//   4. Subscribers are notified on every change and the
//      unsubscribe function actually unsubscribes.

describe("isHapticsMasterEnabledCached / setHapticsMasterEnabled", () => {
  it("defaults to enabled before hydration so a first-launch user feels every signature", () => {
    expect(isHapticsMasterEnabledCached()).toBe(true);
  });

  it("flips the cache synchronously so the very next play() sees the new state", async () => {
    const promise = setHapticsMasterEnabled(false);
    // Critical: must update BEFORE AsyncStorage resolves, or every
    // play() between the user's tap and the storage round-trip
    // would still fire even though the master is "off" in the UI.
    expect(isHapticsMasterEnabledCached()).toBe(false);
    await promise;
    expect(isHapticsMasterEnabledCached()).toBe(false);
  });

  it("persists the master state under the documented key", async () => {
    await setHapticsMasterEnabled(false);
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      HAPTICS_MASTER_ENABLED_KEY,
      "false",
    );
    await setHapticsMasterEnabled(true);
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      HAPTICS_MASTER_ENABLED_KEY,
      "true",
    );
  });

  it("does not throw when AsyncStorage refuses the write — in-memory state still reflects the tap", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error("disk full"));
    await expect(setHapticsMasterEnabled(false)).resolves.toBeUndefined();
    expect(isHapticsMasterEnabledCached()).toBe(false);
  });
});

describe("ensureHapticsMasterEnabledHydrated", () => {
  it("reads the persisted state back into the cache so it survives across launches", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("false");
    const hydrated = await ensureHapticsMasterEnabledHydrated();
    expect(hydrated).toBe(false);
    expect(isHapticsMasterEnabledCached()).toBe(false);
  });

  it("treats a missing key as enabled — first-launch user feels every haptic", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    expect(await ensureHapticsMasterEnabledHydrated()).toBe(true);
    expect(isHapticsMasterEnabledCached()).toBe(true);
  });

  it("treats any non-'false' string as enabled — fail-open default for malformed values", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("garbage");
    expect(await ensureHapticsMasterEnabledHydrated()).toBe(true);
  });

  it("treats a read failure as enabled — better than silently swallowing every haptic", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(
      new Error("storage offline"),
    );
    expect(await ensureHapticsMasterEnabledHydrated()).toBe(true);
  });

  it("is idempotent — re-mounts must NOT pay a fresh AsyncStorage round-trip", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("false");
    await ensureHapticsMasterEnabledHydrated();
    await ensureHapticsMasterEnabledHydrated();
    await ensureHapticsMasterEnabledHydrated();
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------
// Bootstrap entry point (Task #272)
// -------------------------------------------------------------
//
// Pinning the cold-start fix: `app/_layout.tsx` calls
// `bootstrapHapticPreferences()` at module load so the per-signature
// mute map AND the master switch are hydrated before any
// haptic-triggering UI mounts. Without this, a screen that fires a
// haptic on its very first frame could buzz a signature the user
// previously muted (or fire while the master is off) for the brief
// window between launch and `useHaptics()` mounting at the root
// navigator.
//
// What we're pinning here:
//   1. The helper triggers BOTH AsyncStorage reads — neither gate
//      can silently regress to "wait for first useHaptics() mount".
//   2. After the returned promise resolves, the cache reflects the
//      persisted state, so a `play()` from the very first screen
//      mount already respects the user's saved preferences.
//   3. The helper composes with the existing idempotency guarantee:
//      a follow-up `useHaptics()` mount must not pay another
//      AsyncStorage round-trip.

describe("bootstrapHapticPreferences", () => {
  it("kicks off both the per-signature and master hydration reads", async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === HAPTIC_MUTE_PREFS_KEY)
        return Promise.resolve(JSON.stringify({ capture: true }));
      if (key === HAPTICS_MASTER_ENABLED_KEY) return Promise.resolve("false");
      return Promise.resolve(null);
    });

    await bootstrapHapticPreferences();

    expect(AsyncStorage.getItem).toHaveBeenCalledWith(HAPTIC_MUTE_PREFS_KEY);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(
      HAPTICS_MASTER_ENABLED_KEY,
    );
  });

  it("populates the caches before resolving so the first frame's play() respects saved prefs", async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === HAPTIC_MUTE_PREFS_KEY)
        return Promise.resolve(JSON.stringify({ "streak-extended": true }));
      if (key === HAPTICS_MASTER_ENABLED_KEY) return Promise.resolve("false");
      return Promise.resolve(null);
    });

    await bootstrapHapticPreferences();

    // Both gates must reflect the persisted state by the time the
    // promise resolves — that's the whole point of bootstrapping
    // before the first screen mounts.
    expect(isHapticMutedCached("streak-extended")).toBe(true);
    expect(isHapticsMasterEnabledCached()).toBe(false);
    // And the bootstrap-ready flag must be flipped synchronously
    // with the promise resolution — the layout's render gate reads
    // this via `useHapticPreferencesReady()`.
    expect(isHapticPreferencesReady()).toBe(true);
  });

  it("is idempotent — repeat calls share the same promise, no extra round-trips", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const a = bootstrapHapticPreferences();
    const b = bootstrapHapticPreferences();
    expect(a).toBe(b);
    await a;

    // Simulate the existing `useHaptics()` mount effect firing right
    // after bootstrap — it must NOT trigger a second AsyncStorage
    // read for either key.
    await ensureHapticMutePrefsHydrated();
    await ensureHapticsMasterEnabledHydrated();

    expect(
      (AsyncStorage.getItem as jest.Mock).mock.calls.filter(
        (c) => c[0] === HAPTIC_MUTE_PREFS_KEY,
      ),
    ).toHaveLength(1);
    expect(
      (AsyncStorage.getItem as jest.Mock).mock.calls.filter(
        (c) => c[0] === HAPTICS_MASTER_ENABLED_KEY,
      ),
    ).toHaveLength(1);
  });
});

describe("useHapticPreferencesReady", () => {
  it("returns false on first mount and flips to true once bootstrap resolves", async () => {
    // Slow AsyncStorage so the first render observes the gate
    // closed — this is the worst-case path the layout must hold
    // for. Resolvers are called explicitly inside `act()` below.
    let resolveMute!: (v: string | null) => void;
    let resolveMaster!: (v: string | null) => void;
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === HAPTIC_MUTE_PREFS_KEY) {
        return new Promise<string | null>((r) => {
          resolveMute = r;
        });
      }
      if (key === HAPTICS_MASTER_ENABLED_KEY) {
        return new Promise<string | null>((r) => {
          resolveMaster = r;
        });
      }
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useHapticPreferencesReady());

    // Closed gate: layout would render `null` here (no screen
    // mounts → no first-frame haptic can fire).
    expect(result.current).toBe(false);

    await act(async () => {
      resolveMute(JSON.stringify({ capture: true }));
      resolveMaster("false");
      await bootstrapHapticPreferences();
    });

    // Open gate: caches now reflect saved prefs, so even a screen
    // that fires `play("capture")` on its very first mount will
    // hit the muted-cache short-circuit.
    expect(result.current).toBe(true);
    expect(isHapticMutedCached("capture")).toBe(true);
    expect(isHapticsMasterEnabledCached()).toBe(false);
  });

  it("returns true synchronously on remounts after bootstrap has already resolved", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await bootstrapHapticPreferences();

    // A later mount (e.g. fast refresh, or any screen calling the
    // hook in isolation) must not flash a closed gate just because
    // bootstrap finished before the component mounted.
    const { result } = renderHook(() => useHapticPreferencesReady());
    expect(result.current).toBe(true);
  });

  it("does not regress if AsyncStorage rejects — bootstrap still resolves and the gate opens", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(
      new Error("storage offline"),
    );

    const { result } = renderHook(() => useHapticPreferencesReady());
    expect(result.current).toBe(false);

    await act(async () => {
      await bootstrapHapticPreferences();
    });

    // The fail-open default (master on, nothing muted) is fine —
    // the important guarantee is that the gate eventually opens
    // and the user isn't stranded on a blank screen forever.
    await waitFor(() => expect(result.current).toBe(true));
  });
});

describe("subscribeHapticsMasterEnabled", () => {
  it("notifies subscribers on every master change with the new value", async () => {
    const listener = jest.fn();
    subscribeHapticsMasterEnabled(listener);
    await setHapticsMasterEnabled(false);
    await setHapticsMasterEnabled(true);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, false);
    expect(listener).toHaveBeenNthCalledWith(2, true);
  });

  it("hands back an unsubscribe function that actually stops notifications", async () => {
    const listener = jest.fn();
    const unsub = subscribeHapticsMasterEnabled(listener);
    await setHapticsMasterEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    await setHapticsMasterEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
