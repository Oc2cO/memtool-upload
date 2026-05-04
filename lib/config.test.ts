// Regression coverage for Task #285. The shipped TestFlight bundle
// crashed shortly after login because `app/_layout.tsx` was calling
// `setBaseUrl(\`https://${process.env.EXPO_PUBLIC_DOMAIN}\`)` and the
// env var wasn't set in the production EAS build profile, so the
// codegen client's base URL became the literal string
// `"https://undefined"`. The fix moved URL resolution into
// `lib/config.ts` and split it into two helpers:
//   - `resolveReplitApiBase` — lenient, returns a usable string with
//     a fallback (raw-fetch lib modules use this).
//   - `resolveReplitApiBaseStrict` — fails loud when env is unset
//     OR invalid (the codegen client setup uses this).

import {
  FALLBACK_AUTH_API_BASE,
  FALLBACK_REPLIT_API_BASE,
  isValidApiBaseUrl,
  resolveAuthApiBase,
  resolveReplitApiBase,
  resolveReplitApiBaseStrict,
} from "./config";

describe("isValidApiBaseUrl", () => {
  it("accepts a normal absolute https URL", () => {
    expect(isValidApiBaseUrl("https://memtool.replit.app")).toBe(true);
  });

  it("accepts a URL with a path and trailing slash", () => {
    expect(isValidApiBaseUrl("https://api.example.com/v1/")).toBe(true);
  });

  it("accepts http for local dev", () => {
    expect(isValidApiBaseUrl("http://localhost:5000")).toBe(true);
  });

  it("rejects empty and whitespace-only strings", () => {
    expect(isValidApiBaseUrl("")).toBe(false);
    expect(isValidApiBaseUrl("   ")).toBe(false);
  });

  it("rejects the literal 'undefined' template-string bug", () => {
    expect(isValidApiBaseUrl("https://undefined")).toBe(false);
    expect(isValidApiBaseUrl("https://undefined/api/profile")).toBe(false);
    expect(isValidApiBaseUrl("HTTPS://UNDEFINED")).toBe(false);
  });

  it("rejects 'undefined' anywhere in the string", () => {
    expect(isValidApiBaseUrl("https://api.undefined.example")).toBe(false);
  });

  it("rejects strings without an http(s) scheme", () => {
    expect(isValidApiBaseUrl("memtool.replit.app")).toBe(false);
    expect(isValidApiBaseUrl("ftp://memtool.replit.app")).toBe(false);
    expect(isValidApiBaseUrl("//memtool.replit.app")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isValidApiBaseUrl(undefined)).toBe(false);
    expect(isValidApiBaseUrl(null)).toBe(false);
    expect(isValidApiBaseUrl(42)).toBe(false);
    expect(isValidApiBaseUrl({})).toBe(false);
  });
});

describe("config.ts source — Expo babel inlining guard", () => {
  // `babel-preset-expo` only statically replaces `EXPO_PUBLIC_*`
  // env reads when they use direct member access
  // (`process.env.EXPO_PUBLIC_FOO`). Bracket notation
  // (`process.env["EXPO_PUBLIC_FOO"]`) is NOT inlined and resolves
  // to `undefined` on device — exactly the class of bug Task #285
  // is fixing. Lock this in so a future "tidy-up" pass doesn't
  // silently regress the production startup path.
  it("reads EXPO_PUBLIC_REPLIT_API_BASE_URL via dot notation, never bracket notation", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs: typeof import("fs") = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path: typeof import("path") = require("path");
    const source = fs.readFileSync(
      path.join(__dirname, "config.ts"),
      "utf8",
    );
    // No bracket-style read of the public env var anywhere in
    // the production module.
    expect(source).not.toMatch(
      /process\.env\[\s*["']EXPO_PUBLIC_REPLIT_API_BASE_URL["']\s*\]/,
    );
    // And the dot-style read must be present so the resolver
    // stays wired up.
    expect(source).toMatch(
      /process\.env\.EXPO_PUBLIC_REPLIT_API_BASE_URL\b/,
    );
  });
});

describe("resolveReplitApiBaseStrict", () => {
  const originalEnv = process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"];
    } else {
      process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = originalEnv;
    }
  });

  it("fails loud when the env var is unset (regression for the original Task #285 crash)", () => {
    delete process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"];
    const result = resolveReplitApiBaseStrict();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("not set");
    }
  });

  it("fails loud when the env var is empty / whitespace-only", () => {
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = "";
    expect(resolveReplitApiBaseStrict().ok).toBe(false);
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = "   ";
    expect(resolveReplitApiBaseStrict().ok).toBe(false);
  });

  it("fails loud and surfaces the raw value when env is set to 'https://undefined'", () => {
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = "https://undefined";
    const result = resolveReplitApiBaseStrict();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rawValue).toBe("https://undefined");
      expect(result.reason).toContain("invalid");
    }
  });

  it("fails loud when env is set without an http(s) scheme", () => {
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = "memtool.replit.app";
    expect(resolveReplitApiBaseStrict().ok).toBe(false);
  });

  it("returns ok with the env value when it validates", () => {
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = "https://staging.example.com";
    const result = resolveReplitApiBaseStrict();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://staging.example.com");
      expect(result.source).toBe("env");
    }
  });

  it("strips trailing slashes from a valid env value", () => {
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = "https://staging.example.com///";
    const result = resolveReplitApiBaseStrict();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://staging.example.com");
  });

  it("accepts the dev-script wiring (https://$REPLIT_DEV_DOMAIN)", () => {
    // Mirrors the dev script in artifacts/memtool/package.json which
    // sets EXPO_PUBLIC_REPLIT_API_BASE_URL=https://$REPLIT_DEV_DOMAIN
    // so the strict resolver succeeds for local Expo runs.
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] =
      "https://workspace.user.replit.dev";
    const result = resolveReplitApiBaseStrict();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://workspace.user.replit.dev");
    }
  });
});

describe("resolveReplitApiBase (lenient — used by raw-fetch libs)", () => {
  const originalEnv = process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"];
    } else {
      process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = originalEnv;
    }
  });

  it("falls back to memtool.replit.app when the override is unset", () => {
    delete process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"];
    expect(resolveReplitApiBase()).toBe(FALLBACK_REPLIT_API_BASE);
  });

  it("returns the override when set to a valid URL", () => {
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = "https://staging.example.com";
    expect(resolveReplitApiBase()).toBe("https://staging.example.com");
  });

  it("never returns a URL containing the literal 'undefined' even when env is set to one", () => {
    // The raw-fetch libs intentionally limp along with the
    // production fallback rather than crashing the whole app — but
    // they still must never produce `https://undefined/api/...`.
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = "https://undefined";
    const url = resolveReplitApiBase();
    expect(url.toLowerCase()).not.toContain("undefined");
    expect(url).toBe(FALLBACK_REPLIT_API_BASE);
  });

  it("falls back when the override is empty", () => {
    process.env["EXPO_PUBLIC_REPLIT_API_BASE_URL"] = "";
    expect(resolveReplitApiBase()).toBe(FALLBACK_REPLIT_API_BASE);
  });
});

describe("config.ts source — Expo babel inlining guard for AUTH override", () => {
  // Same constraint as the Replit URL: `babel-preset-expo` only
  // statically inlines `EXPO_PUBLIC_*` reads when written via direct
  // member access. Lock the auth override into the same shape so a
  // future tidy-up doesn't regress it to bracket notation and silently
  // resolve to `undefined` on device (Task #291).
  it("reads EXPO_PUBLIC_AUTH_API_BASE_URL via dot notation, never bracket notation", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs: typeof import("fs") = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path: typeof import("path") = require("path");
    const source = fs.readFileSync(
      path.join(__dirname, "config.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /process\.env\[\s*["']EXPO_PUBLIC_AUTH_API_BASE_URL["']\s*\]/,
    );
    expect(source).toMatch(
      /process\.env\.EXPO_PUBLIC_AUTH_API_BASE_URL\b/,
    );
  });
});

describe("resolveAuthApiBase (lenient — used by lib/auth.ts)", () => {
  const originalEnv = process.env["EXPO_PUBLIC_AUTH_API_BASE_URL"];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["EXPO_PUBLIC_AUTH_API_BASE_URL"];
    } else {
      process.env["EXPO_PUBLIC_AUTH_API_BASE_URL"] = originalEnv;
    }
  });

  it("falls back to the Polsia gateway when the override is unset", () => {
    delete process.env["EXPO_PUBLIC_AUTH_API_BASE_URL"];
    expect(resolveAuthApiBase()).toBe(FALLBACK_AUTH_API_BASE);
  });

  it("returns the override when set to a valid URL", () => {
    process.env["EXPO_PUBLIC_AUTH_API_BASE_URL"] =
      "https://staging-auth.example.com/api/memtool";
    expect(resolveAuthApiBase()).toBe(
      "https://staging-auth.example.com/api/memtool",
    );
  });

  it("strips trailing slashes from a valid env value", () => {
    process.env["EXPO_PUBLIC_AUTH_API_BASE_URL"] =
      "https://staging-auth.example.com/api/memtool///";
    expect(resolveAuthApiBase()).toBe(
      "https://staging-auth.example.com/api/memtool",
    );
  });

  it("never returns a URL containing the literal 'undefined' even when env is set to one", () => {
    // The auth gateway intentionally limps along with the production
    // fallback rather than crashing the whole app — but it still must
    // never produce `https://undefined/auth/...`.
    process.env["EXPO_PUBLIC_AUTH_API_BASE_URL"] = "https://undefined";
    const url = resolveAuthApiBase();
    expect(url.toLowerCase()).not.toContain("undefined");
    expect(url).toBe(FALLBACK_AUTH_API_BASE);
  });

  it("falls back when the override is empty / whitespace-only", () => {
    process.env["EXPO_PUBLIC_AUTH_API_BASE_URL"] = "";
    expect(resolveAuthApiBase()).toBe(FALLBACK_AUTH_API_BASE);
    process.env["EXPO_PUBLIC_AUTH_API_BASE_URL"] = "   ";
    expect(resolveAuthApiBase()).toBe(FALLBACK_AUTH_API_BASE);
  });

  it("falls back when the override is missing an http(s) scheme", () => {
    process.env["EXPO_PUBLIC_AUTH_API_BASE_URL"] = "oc2coos-2.polsia.app/api/memtool";
    expect(resolveAuthApiBase()).toBe(FALLBACK_AUTH_API_BASE);
  });

  it("accepts the dev-script wiring (https://$REPLIT_DEV_DOMAIN)", () => {
    process.env["EXPO_PUBLIC_AUTH_API_BASE_URL"] =
      "https://workspace.user.replit.dev/api/memtool";
    expect(resolveAuthApiBase()).toBe(
      "https://workspace.user.replit.dev/api/memtool",
    );
  });
});
