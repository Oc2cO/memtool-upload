// Integration-level coverage for the module-level setup that
// `app/_layout.tsx` runs at boot. Loading `app/_layout.tsx` itself in
// jest is impractical (it pulls in expo-router, fonts, RevenueCat,
// the gesture root view, and a dozen providers), so we exercise the
// same code path via the dedicated `lib/setupApiClient.ts` module
// the layout now delegates to.
//
// The two contracts under test (Task #285):
//   1. With a valid `EXPO_PUBLIC_REPLIT_API_BASE_URL` env var
//      (matching how the EAS preview / production profiles and the
//      dev script export it), the codegen client's `setBaseUrl` is
//      called with that exact URL.
//   2. With env unset OR set to garbage (e.g. the literal
//      "https://undefined" template-string regression), the bridge
//      fails loud — `setBaseUrl` is NEVER called, an error is
//      logged, and the function returns `false` so the layout can
//      surface a `CrashScreen` instead of letting the first
//      post-login fetch blow up.

jest.mock("@workspace/api-client-react", () => ({
  __esModule: true,
  setBaseUrl: jest.fn(),
}));

import { setBaseUrl } from "@workspace/api-client-react";

import { setupApiClientBaseUrl } from "./setupApiClient";

const setBaseUrlMock = setBaseUrl as jest.Mock;

describe("setupApiClientBaseUrl", () => {
  const originalEnv = process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"];
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    setBaseUrlMock.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    if (originalEnv === undefined) {
      delete process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"];
    } else {
      process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = originalEnv;
    }
  });

  it("wires the codegen client to the production host configured in eas.json", () => {
    // Mirrors the EAS production / preview profile setting in
    // artifacts/memtool/eas.json.
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = "https://memtool.replit.app";
    expect(setupApiClientBaseUrl()).toBe(true);
    expect(setBaseUrlMock).toHaveBeenCalledTimes(1);
    expect(setBaseUrlMock).toHaveBeenCalledWith("https://memtool.replit.app");
  });

  it("wires the codegen client to the local Replit dev domain when the dev script is the source", () => {
    // Mirrors the dev script in artifacts/memtool/package.json:
    //   EXPO_PUBLIC_REPLIT_API_BASE_URL=https://$REPLIT_DEV_DOMAIN
    // This proves the existing dev wiring is preserved — local
    // `pnpm run dev` still points the codegen client at the local
    // Replit dev domain rather than the production host.
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] =
      "https://workspace.user.replit.dev";
    expect(setupApiClientBaseUrl()).toBe(true);
    expect(setBaseUrlMock).toHaveBeenCalledWith(
      "https://workspace.user.replit.dev",
    );
  });

  it("fails loud when the env var is missing (the original Task #285 production crash)", () => {
    // The shipped TestFlight bundle had EXPO_PUBLIC_REPLIT_API_BASE_URL
    // unset, so the codegen client was wired to "https://undefined"
    // and crashed on the first post-login request. Now that case
    // returns `false` and skips `setBaseUrl` entirely.
    delete process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"];
    expect(setupApiClientBaseUrl()).toBe(false);
    expect(setBaseUrlMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("fails loud when the env var is set to the literal 'https://undefined'", () => {
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = "https://undefined";
    expect(setupApiClientBaseUrl()).toBe(false);
    expect(setBaseUrlMock).not.toHaveBeenCalled();
  });

  it("fails loud when the env var is set to an empty string", () => {
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = "";
    expect(setupApiClientBaseUrl()).toBe(false);
    expect(setBaseUrlMock).not.toHaveBeenCalled();
  });

  it("never calls setBaseUrl with any value containing 'undefined' or an empty string", () => {
    // Defensive sweep across the failure modes the shipped bundle
    // could plausibly produce — none of them must reach
    // `setBaseUrl`.
    for (const bad of ["", "   ", "https://undefined", "https://api.undefined.example", "memtool.replit.app"]) {
      setBaseUrlMock.mockReset();
      process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = bad;
      setupApiClientBaseUrl();
      for (const call of setBaseUrlMock.mock.calls) {
        const arg = String(call[0] ?? "");
        expect(arg.toLowerCase()).not.toContain("undefined");
        expect(arg).not.toBe("");
      }
    }
  });
});
