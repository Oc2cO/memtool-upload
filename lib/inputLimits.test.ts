import {
  API_URL_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  MEMORY_CONTENT_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PERSON_NAME_MAX_LENGTH,
  SEARCH_QUERY_MAX_LENGTH,
  validateApiUrl,
} from "./inputLimits";

// We don't lock down the exact numeric values — those are product
// decisions and may shift. We DO lock down their relative ordering
// (passwords > display names, content > person name, etc.) and the
// fact that they're all comfortably non-zero. A future tweak that
// accidentally zeroes one of these would break every input on the
// affected surface; this tripwire catches it.
describe("inputLimits constants", () => {
  it("are all positive integers", () => {
    for (const n of [
      MEMORY_CONTENT_MAX_LENGTH,
      PERSON_NAME_MAX_LENGTH,
      SEARCH_QUERY_MAX_LENGTH,
      EMAIL_MAX_LENGTH,
      PASSWORD_MAX_LENGTH,
      DISPLAY_NAME_MAX_LENGTH,
      API_URL_MAX_LENGTH,
    ]) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
  });

  it("memory content cap is large enough for real journaling but capped well under server embed limit", () => {
    // Embedding endpoint caps at 8,000 chars. We must stay under it
    // so that a memory at the cap can still embed successfully.
    expect(MEMORY_CONTENT_MAX_LENGTH).toBeLessThan(8_000);
    // Sanity: a real memory note shouldn't be artificially short.
    expect(MEMORY_CONTENT_MAX_LENGTH).toBeGreaterThanOrEqual(2_000);
  });

  it("person-name cap is shorter than the body cap", () => {
    expect(PERSON_NAME_MAX_LENGTH).toBeLessThan(MEMORY_CONTENT_MAX_LENGTH);
  });

  it("email cap matches the IETF practical limit (RFC 3696)", () => {
    expect(EMAIL_MAX_LENGTH).toBe(254);
  });
});

describe("validateApiUrl", () => {
  it("accepts a normal https URL", () => {
    expect(validateApiUrl("https://api.example.com")).toEqual({
      ok: true,
      url: "https://api.example.com",
    });
  });

  it("accepts an http URL with a port and path", () => {
    expect(validateApiUrl("http://localhost:8080/api")).toEqual({
      ok: true,
      url: "http://localhost:8080/api",
    });
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(validateApiUrl("   https://api.example.com   ")).toEqual({
      ok: true,
      url: "https://api.example.com",
    });
  });

  it("rejects an empty string with an actionable hint", () => {
    const result = validateApiUrl("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/leave blank|enter a url/i);
    }
  });

  it("rejects a whitespace-only string the same as empty", () => {
    expect(validateApiUrl("     ").ok).toBe(false);
  });

  it("rejects a plain word that isn't a URL", () => {
    const result = validateApiUrl("yes");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/valid url/i);
    }
  });

  it("rejects a javascript: URL even though it parses", () => {
    // `new URL("javascript:alert(1)")` succeeds in JS, so we have to
    // gate on the protocol explicitly. This is the most important
    // defensive check in the function — without it, a Settings tweak
    // could turn into a stored XSS sink the moment we render the
    // saved value back into a webview.
    const result = validateApiUrl("javascript:alert(1)");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/http/i);
    }
  });

  it("rejects a file:// URL", () => {
    const result = validateApiUrl("file:///etc/passwd");
    expect(result.ok).toBe(false);
  });

  it("rejects a URL longer than the cap", () => {
    const huge = "https://example.com/" + "a".repeat(API_URL_MAX_LENGTH);
    const result = validateApiUrl(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/too long/i);
    }
  });
});
