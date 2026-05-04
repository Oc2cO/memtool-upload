/**
 * Unit tests for AuthContext.deleteAccount — Task #299.
 *
 * Verifies that after a successful server-side deletion:
 *   - Display-name AsyncStorage key is removed.
 *   - Avatar AsyncStorage key is removed.
 *   - AI engine cache is cleared (clearAiEngineCache called with the user's email).
 *   - apiLogout is called to clear the auth token.
 *   - user state resets to null.
 */
import React from "react";
import { renderHook, act } from "@testing-library/react-native";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiDeleteAccount = jest.fn();
const mockApiLogout = jest.fn();
const mockApiLogin = jest.fn();
const mockClearAiEngineCache = jest.fn();
const mockAsyncStorageRemoveItem = jest.fn().mockResolvedValue(undefined);
const mockAsyncStorageGetItem = jest.fn().mockResolvedValue(null);
const mockAsyncStorageSetItem = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/accountApi", () => ({
  apiDeleteAccount: () => mockApiDeleteAccount(),
  apiUpdateDisplayName: jest.fn().mockResolvedValue(""),
}));

jest.mock("@/lib/aiEngineStorage", () => ({
  clearAiEngineCache: (email: string) => mockClearAiEngineCache(email),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: (key: string) => mockAsyncStorageGetItem(key),
  setItem: (key: string, value: string) => mockAsyncStorageSetItem(key, value),
  removeItem: (key: string) => mockAsyncStorageRemoveItem(key),
  multiRemove: (keys: string[]) =>
    Promise.all(keys.map((k) => mockAsyncStorageRemoveItem(k))),
}));

jest.mock("@/lib/auth", () => {
  const actual = jest.requireActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    apiLogin: (email: string, pass: string) => mockApiLogin(email, pass),
    apiLogout: () => mockApiLogout(),
    apiMe: jest.fn().mockRejectedValue(new Error("no session")),
    apiRegister: jest.fn(),
    getToken: jest.fn().mockResolvedValue(null),
    setToken: jest.fn().mockResolvedValue(undefined),
    clearToken: jest.fn().mockResolvedValue(undefined),
  };
});

// ---------------------------------------------------------------------------

import { AuthProvider, useAuth } from "./AuthContext";

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(AuthProvider, null, children);
}

beforeEach(() => {
  mockApiDeleteAccount.mockReset().mockResolvedValue(undefined);
  mockApiLogout.mockReset().mockResolvedValue(undefined);
  mockApiLogin.mockReset();
  mockClearAiEngineCache.mockReset().mockResolvedValue(undefined);
  mockAsyncStorageRemoveItem.mockReset().mockResolvedValue(undefined);
  mockAsyncStorageGetItem.mockReset().mockResolvedValue(null);
  mockAsyncStorageSetItem.mockReset().mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------

describe("AuthContext.deleteAccount — data wipe (Task #299)", () => {
  test("throws 'not signed in' when called with no logged-in user", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });

    await expect(result.current.deleteAccount()).rejects.toThrow("not signed in");
  });

  test("after successful delete: clears AI cache, removes display-name and avatar keys, calls apiLogout, sets user to null", async () => {
    // Seed a signed-in user via the login path.
    mockApiLogin.mockResolvedValueOnce({
      token: "fake-token",
      user: { email: "user@example.com", display_name: "Test" },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    // Wait for the initial loadState (getToken returns null → no auto-login).
    await act(async () => { await Promise.resolve(); });

    // Sign in
    await act(async () => {
      await result.current.login("user@example.com", "pass");
    });
    expect(result.current.user?.email).toBe("user@example.com");

    // Delete account
    await act(async () => {
      await result.current.deleteAccount();
    });

    // Server call
    expect(mockApiDeleteAccount).toHaveBeenCalledTimes(1);
    // AI engine cache cleared with the correct email
    expect(mockClearAiEngineCache).toHaveBeenCalledWith("user@example.com");
    // Local storage keys removed — identity + all per-user data
    const removed = mockAsyncStorageRemoveItem.mock.calls.map(
      ([k]: [string]) => k,
    );
    expect(removed).toContain("mt_display_name_user@example.com");
    expect(removed).toContain("mt_avatar_user@example.com");
    expect(removed).toContain("mt_profile_user@example.com");
    expect(removed).toContain("syncOutbox_user@example.com");
    expect(removed).toContain("mt_review_asked_user@example.com");
    expect(removed).toContain("mt_account_first_seen_user@example.com");
    expect(removed).toContain("mt_ai_guide_count_v1");
    // Auth token cleared via apiLogout
    expect(mockApiLogout).toHaveBeenCalledTimes(1);
    // User state reset
    expect(result.current.user).toBeNull();
  });

  test("does not clear local data when the server call fails", async () => {
    mockApiLogin.mockResolvedValueOnce({
      token: "fake-token",
      user: { email: "user@example.com", display_name: "Test" },
    });
    mockApiDeleteAccount.mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.login("user@example.com", "pass");
    });

    await act(async () => {
      await expect(result.current.deleteAccount()).rejects.toThrow("network error");
    });

    // Local data must NOT have been touched before confirmation of server success
    expect(mockClearAiEngineCache).not.toHaveBeenCalled();
    expect(mockApiLogout).not.toHaveBeenCalled();
    // User should still be set
    expect(result.current.user?.email).toBe("user@example.com");
  });
});
