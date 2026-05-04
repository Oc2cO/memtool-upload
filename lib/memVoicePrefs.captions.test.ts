import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import {
  CAPTIONS_KEY_PREFIX,
  ensureMemCaptionsEnabledHydrated,
  isMemCaptionsEnabledSync,
  setMemCaptionsEnabled,
  useMemCaptionsEnabled,
  _resetMemVoicePrefsForTests,
} from "./memVoicePrefs";

const asyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe("memVoicePrefs — Mem captions toggle (Task #293)", () => {
  beforeEach(() => {
    _resetMemVoicePrefsForTests();
    asyncStorage.getItem.mockReset();
    asyncStorage.setItem.mockReset();
    asyncStorage.getItem.mockResolvedValue(null);
    asyncStorage.setItem.mockResolvedValue(undefined);
  });

  it("defaults to OFF for a fresh install", async () => {
    const enabled = await ensureMemCaptionsEnabledHydrated("user-a");
    expect(enabled).toBe(false);
    expect(isMemCaptionsEnabledSync("user-a")).toBe(false);
    expect(asyncStorage.getItem).toHaveBeenCalledWith(
      `${CAPTIONS_KEY_PREFIX}user-a`,
    );
  });

  it("hydrates ON when AsyncStorage already has the flag set", async () => {
    asyncStorage.getItem.mockResolvedValueOnce("1");
    const enabled = await ensureMemCaptionsEnabledHydrated("user-a");
    expect(enabled).toBe(true);
    expect(isMemCaptionsEnabledSync("user-a")).toBe(true);
  });

  it("persists the flag through setMemCaptionsEnabled", async () => {
    await setMemCaptionsEnabled("user-a", true);
    expect(asyncStorage.setItem).toHaveBeenCalledWith(
      `${CAPTIONS_KEY_PREFIX}user-a`,
      "1",
    );
    expect(isMemCaptionsEnabledSync("user-a")).toBe(true);

    await setMemCaptionsEnabled("user-a", false);
    expect(asyncStorage.setItem).toHaveBeenLastCalledWith(
      `${CAPTIONS_KEY_PREFIX}user-a`,
      "0",
    );
    expect(isMemCaptionsEnabledSync("user-a")).toBe(false);
  });

  it("collapses to OFF when AsyncStorage throws on read", async () => {
    asyncStorage.getItem.mockRejectedValueOnce(new Error("boom"));
    const enabled = await ensureMemCaptionsEnabledHydrated("user-a");
    expect(enabled).toBe(false);
    expect(isMemCaptionsEnabledSync("user-a")).toBe(false);
  });

  it("isolates the flag per user", async () => {
    asyncStorage.getItem.mockImplementation((key) =>
      Promise.resolve(key === `${CAPTIONS_KEY_PREFIX}user-a` ? "1" : null),
    );
    await ensureMemCaptionsEnabledHydrated("user-a");
    expect(isMemCaptionsEnabledSync("user-a")).toBe(true);

    await ensureMemCaptionsEnabledHydrated("user-b");
    // Cache now belongs to user-b; user-a's sync read should
    // fall back to false because the cache key doesn't match.
    expect(isMemCaptionsEnabledSync("user-a")).toBe(false);
    expect(isMemCaptionsEnabledSync("user-b")).toBe(false);
  });

  it("useMemCaptionsEnabled hydrates and reflects later toggles", async () => {
    asyncStorage.getItem.mockResolvedValueOnce("1");
    const { result } = renderHook(() => useMemCaptionsEnabled("user-a"));

    // First render is the synchronous default (false).
    expect(result.current).toBe(false);

    // After hydration completes, the hook flips to the stored value.
    await waitFor(() => expect(result.current).toBe(true));

    // A subsequent setter call from elsewhere in the tree should
    // notify the hook subscriber and update the rendered value.
    await act(async () => {
      await setMemCaptionsEnabled("user-a", false);
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("useMemCaptionsEnabled is stable when userId is empty", async () => {
    const { result } = renderHook(() => useMemCaptionsEnabled(""));
    expect(result.current).toBe(false);
    // No hydrate call should have been issued for an empty id.
    expect(asyncStorage.getItem).not.toHaveBeenCalled();
  });
});
