/**
 * Unit tests for the force-update / soft-update logic in
 * `lib/forceUpdate.ts` (Task #300).
 *
 * Tests cover:
 *   1. `getCurrentVersion` — reads from `expo-constants` correctly.
 *   2. `checkForUpdate` — correctly compares versions and returns the
 *      right status for each case (up_to_date, soft_update,
 *      force_update, error on network failure, error on missing base
 *      URL).
 *   3. `dismissSoftUpdate` / `isSoftUpdateDismissed` — persists and
 *      reads the dismiss flag correctly.
 */

const mockGetItem = jest.fn();
const mockSetItem = jest.fn().mockResolvedValue(undefined);

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    nativeBuildVersion: "84",
    expoConfig: {
      version: "1.2.0",
      ios: { buildNumber: "42" },
      android: { versionCode: 42 },
      sdkVersion: "54.0.0",
    },
  },
}));

jest.mock("react-native", () => ({
  Platform: { OS: "ios", Version: "17.0" },
}));

import {
  checkForUpdate,
  dismissSoftUpdate,
  getCurrentVersion,
  getCurrentBuildNumber,
  isSoftUpdateDismissed,
} from "./forceUpdate";

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getCurrentVersion", () => {
  test("returns version from expo-constants", () => {
    expect(getCurrentVersion()).toBe("1.2.0");
  });
});

describe("getCurrentBuildNumber", () => {
  test("prefers nativeBuildVersion from the installed binary", () => {
    expect(getCurrentBuildNumber()).toBe("84");
  });
});

describe("checkForUpdate", () => {
  function mockFetchConfig(config: object) {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => config,
    });
  }

  test("returns error when baseUrl is empty", async () => {
    const result = await checkForUpdate("");
    expect(result.status).toBe("error");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns up_to_date when current version matches latest", async () => {
    mockFetchConfig({ minimum_version: "1.0.0", latest_version: "1.2.0" });
    const result = await checkForUpdate("https://api.example.com");
    expect(result.status).toBe("up_to_date");
  });

  test("returns soft_update when current is between minimum and latest", async () => {
    mockFetchConfig({ minimum_version: "1.0.0", latest_version: "1.3.0" });
    const result = await checkForUpdate("https://api.example.com");
    expect(result.status).toBe("soft_update");
    expect(result.latestVersion).toBe("1.3.0");
  });

  test("returns force_update when current is below minimum", async () => {
    mockFetchConfig({ minimum_version: "2.0.0", latest_version: "2.0.0" });
    const result = await checkForUpdate("https://api.example.com");
    expect(result.status).toBe("force_update");
  });

  test("returns error on network failure", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));
    const result = await checkForUpdate("https://api.example.com");
    expect(result.status).toBe("error");
  });

  test("returns error on non-OK response", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
    const result = await checkForUpdate("https://api.example.com");
    expect(result.status).toBe("error");
  });

  test("uses cached config when within TTL window", async () => {
    const cachedConfig = {
      minimum_version: "1.0.0",
      latest_version: "1.2.0",
    };
    const recentTimestamp = new Date(Date.now() - 1000).toISOString();
    mockGetItem.mockImplementation((key: string) => {
      if (key === "mt_update_last_check") return Promise.resolve(recentTimestamp);
      if (key === "mt_update_cached_config") return Promise.resolve(JSON.stringify(cachedConfig));
      return Promise.resolve(null);
    });

    const result = await checkForUpdate("https://api.example.com");
    expect(result.status).toBe("up_to_date");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("includes store URL from config in force_update result", async () => {
    mockFetchConfig({
      minimum_version: "2.0.0",
      latest_version: "2.0.0",
      store_url_ios: "https://apps.apple.com/app/memtool",
    });
    const result = await checkForUpdate("https://api.example.com");
    expect(result.status).toBe("force_update");
    expect(result.storeUrl).toBe("https://apps.apple.com/app/memtool");
  });

  test("force=true bypasses TTL cache and fetches fresh config", async () => {
    const cachedConfig = { minimum_version: "1.0.0", latest_version: "1.2.0" };
    const recentTimestamp = new Date(Date.now() - 1000).toISOString();
    mockGetItem.mockImplementation((key: string) => {
      if (key === "mt_update_last_check") return Promise.resolve(recentTimestamp);
      if (key === "mt_update_cached_config") return Promise.resolve(JSON.stringify(cachedConfig));
      return Promise.resolve(null);
    });

    mockFetchConfig({ minimum_version: "2.0.0", latest_version: "2.0.0" });

    const result = await checkForUpdate("https://api.example.com", true);
    expect(result.status).toBe("force_update");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("dismissSoftUpdate / isSoftUpdateDismissed", () => {
  test("isSoftUpdateDismissed returns false when not dismissed", async () => {
    mockGetItem.mockResolvedValueOnce(null);
    expect(await isSoftUpdateDismissed("1.3.0")).toBe(false);
  });

  test("dismissSoftUpdate persists, isSoftUpdateDismissed then returns true", async () => {
    mockGetItem.mockResolvedValueOnce("1");
    await dismissSoftUpdate("1.3.0");
    expect(mockSetItem).toHaveBeenCalledWith(
      "mt_soft_dismissed_1.3.0",
      "1",
    );
    expect(await isSoftUpdateDismissed("1.3.0")).toBe(true);
  });
});
