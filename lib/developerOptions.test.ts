/**
 * Persistence + hydration semantics for the Developer options
 * toggle (Task #317). The Settings screen relies on this module's
 * sync cached read to decide whether to render the Cloud API URL
 * controls — getting hydration wrong (or letting a malformed blob
 * flip the cache to "on" in production) would either silently
 * disable the BYO-backend escape hatch for the team, or worse,
 * leak the placeholder back into a production user's view.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  DEVELOPER_OPTIONS_ENABLED_KEY,
  __resetDeveloperOptionsForTests,
  ensureDeveloperOptionsHydrated,
  isDeveloperOptionsEnabledCached,
  setDeveloperOptionsEnabled,
  subscribeDeveloperOptionsEnabled,
} from "./developerOptions";

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

beforeEach(() => {
  __resetDeveloperOptionsForTests();
  storage.getItem.mockReset();
  storage.setItem.mockReset();
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockResolvedValue(undefined);
});

describe("developerOptions hydration", () => {
  test("missing key rehydrates to the build-time default (__DEV__ → true under jest-expo)", async () => {
    storage.getItem.mockResolvedValueOnce(null);

    const enabled = await ensureDeveloperOptionsHydrated();

    expect(enabled).toBe(true);
    expect(isDeveloperOptionsEnabledCached()).toBe(true);
    expect(storage.getItem).toHaveBeenCalledWith(DEVELOPER_OPTIONS_ENABLED_KEY);
  });

  test("explicit 'true' rehydrates as on", async () => {
    storage.getItem.mockResolvedValueOnce("true");

    expect(await ensureDeveloperOptionsHydrated()).toBe(true);
    expect(isDeveloperOptionsEnabledCached()).toBe(true);
  });

  test("explicit 'false' rehydrates as off — the user's saved choice wins over the dev default", async () => {
    storage.getItem.mockResolvedValueOnce("false");

    expect(await ensureDeveloperOptionsHydrated()).toBe(false);
    expect(isDeveloperOptionsEnabledCached()).toBe(false);
  });

  test("malformed value falls back to the build-time default rather than randomly enabling in production", async () => {
    storage.getItem.mockResolvedValueOnce("yes-please");

    expect(await ensureDeveloperOptionsHydrated()).toBe(true);
  });

  test("AsyncStorage failure is swallowed and falls back to the build-time default", async () => {
    storage.getItem.mockRejectedValueOnce(new Error("storage offline"));

    expect(await ensureDeveloperOptionsHydrated()).toBe(true);
  });

  test("hydration is idempotent — repeat calls return the same in-flight promise and only read storage once", async () => {
    storage.getItem.mockResolvedValueOnce("false");

    const a = ensureDeveloperOptionsHydrated();
    const b = ensureDeveloperOptionsHydrated();

    expect(a).toBe(b);
    await Promise.all([a, b]);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });
});

describe("developerOptions writes + subscribers", () => {
  test("setDeveloperOptionsEnabled updates the cache eagerly and writes the literal string", async () => {
    await setDeveloperOptionsEnabled(false);

    expect(isDeveloperOptionsEnabledCached()).toBe(false);
    expect(storage.setItem).toHaveBeenCalledWith(
      DEVELOPER_OPTIONS_ENABLED_KEY,
      "false",
    );

    await setDeveloperOptionsEnabled(true);

    expect(isDeveloperOptionsEnabledCached()).toBe(true);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      DEVELOPER_OPTIONS_ENABLED_KEY,
      "true",
    );
  });

  test("subscribers fire on every change and receive the new value", async () => {
    const listener = jest.fn();
    const unsub = subscribeDeveloperOptionsEnabled(listener);

    await setDeveloperOptionsEnabled(false);
    await setDeveloperOptionsEnabled(true);

    expect(listener).toHaveBeenNthCalledWith(1, false);
    expect(listener).toHaveBeenNthCalledWith(2, true);

    unsub();
    await setDeveloperOptionsEnabled(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("a failed write still leaves the in-memory cache reflecting the user's intent", async () => {
    storage.setItem.mockRejectedValueOnce(new Error("disk full"));

    await setDeveloperOptionsEnabled(false);

    expect(isDeveloperOptionsEnabledCached()).toBe(false);
  });
});
