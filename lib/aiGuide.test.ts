import { AuthError } from "./auth";
import {
  AI_GUIDE_GENERIC_ERROR_MESSAGE,
  AI_GUIDE_NETWORK_ERROR_MESSAGE,
  AI_GUIDE_RATE_LIMIT_MESSAGE,
  AiGuideError,
  normalizeMood,
  sendAiGuideMessage,
} from "./aiGuide";

jest.mock("./auth", () => {
  class AuthError extends Error {
    status?: number;
    body?: unknown;
    constructor(message: string, status?: number, body?: unknown) {
      super(message);
      this.name = "AuthError";
      this.status = status;
      this.body = body;
    }
  }
  return {
    AuthError,
    authFetch: jest.fn(),
  };
});

const { authFetch } = jest.requireMock("./auth") as {
  authFetch: jest.Mock;
};

describe("normalizeMood", () => {
  it("passes through known moods", () => {
    expect(normalizeMood("calm")).toBe("calm");
    expect(normalizeMood("happy")).toBe("happy");
    expect(normalizeMood("sad")).toBe("sad");
    expect(normalizeMood("anxious")).toBe("anxious");
    expect(normalizeMood("neutral")).toBe("neutral");
  });

  it("trims + lowercases before comparing", () => {
    expect(normalizeMood("  Happy ")).toBe("happy");
    expect(normalizeMood("CALM")).toBe("calm");
  });

  it("collapses unknown / non-string moods to neutral", () => {
    expect(normalizeMood("frustrated")).toBe("neutral");
    expect(normalizeMood("")).toBe("neutral");
    expect(normalizeMood(undefined)).toBe("neutral");
    expect(normalizeMood(null)).toBe("neutral");
    expect(normalizeMood(42)).toBe("neutral");
    expect(normalizeMood({ mood: "happy" })).toBe("neutral");
  });
});

describe("sendAiGuideMessage", () => {
  beforeEach(() => {
    authFetch.mockReset();
  });

  it("posts the trimmed message and normalizes mood", async () => {
    authFetch.mockResolvedValueOnce({
      response: "I hear you. Let's slow down.",
      mood_detected: "anxious",
    });
    const out = await sendAiGuideMessage("  Hi Mem  ");
    expect(authFetch).toHaveBeenCalledWith("/ai-guide/chat", {
      method: "POST",
      body: JSON.stringify({ message: "Hi Mem" }),
    });
    expect(out).toEqual({
      response: "I hear you. Let's slow down.",
      mood: "anxious",
      rawMood: "anxious",
    });
  });

  it("trims whitespace from the server response", async () => {
    authFetch.mockResolvedValueOnce({
      response: "  Mem replies with padding.  ",
      mood_detected: "calm",
    });
    const out = await sendAiGuideMessage("hi");
    expect(out.response).toBe("Mem replies with padding.");
  });

  it("maps unknown mood_detected to neutral and preserves rawMood", async () => {
    authFetch.mockResolvedValueOnce({
      response: "Mem reply.",
      mood_detected: "ecstatic",
    });
    const out = await sendAiGuideMessage("hi");
    expect(out.mood).toBe("neutral");
    expect(out.rawMood).toBe("ecstatic");
  });

  it("treats missing mood_detected as neutral with null rawMood", async () => {
    authFetch.mockResolvedValueOnce({ response: "Mem reply." });
    const out = await sendAiGuideMessage("hi");
    expect(out.mood).toBe("neutral");
    expect(out.rawMood).toBeNull();
  });

  it("rejects empty client-side input without hitting the network", async () => {
    await expect(sendAiGuideMessage("   ")).rejects.toBeInstanceOf(AiGuideError);
    await expect(sendAiGuideMessage("   ")).rejects.toMatchObject({
      userMessage: AI_GUIDE_GENERIC_ERROR_MESSAGE,
    });
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("re-throws 401 AuthError unchanged so the screen can re-auth", async () => {
    const err = new AuthError("Invalid credentials", 401);
    authFetch.mockRejectedValueOnce(err);
    await expect(sendAiGuideMessage("hi")).rejects.toBe(err);
  });

  it("maps 5xx AuthError to network-friendly AiGuideError", async () => {
    const err = new AuthError("Server error — please try again", 503);
    authFetch.mockRejectedValueOnce(err);
    await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
      name: "AiGuideError",
      userMessage: AI_GUIDE_NETWORK_ERROR_MESSAGE,
      isServerOutage: true,
    });
  });

  it("flags 502 and 500 as server-outage strikes (Task #397)", async () => {
    for (const status of [500, 502, 504]) {
      authFetch.mockRejectedValueOnce(new AuthError("upstream", status));
      // eslint-disable-next-line no-await-in-loop
      await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
        name: "AiGuideError",
        isServerOutage: true,
      });
    }
  });

  it("does NOT flag 4xx, 429, network-down, or generic errors as outage strikes", async () => {
    authFetch.mockRejectedValueOnce(new AuthError("Bad request", 400));
    await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
      isServerOutage: false,
    });
    authFetch.mockRejectedValueOnce(new AuthError("Too many", 429));
    await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
      isServerOutage: false,
    });
    authFetch.mockRejectedValueOnce(new AuthError("offline"));
    await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
      isServerOutage: false,
    });
    authFetch.mockRejectedValueOnce(new Error("oops"));
    await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
      isServerOutage: false,
    });
  });

  it("maps fetch failure (no status) to network-friendly AiGuideError", async () => {
    const err = new AuthError("Couldn't reach the server — check your connection");
    authFetch.mockRejectedValueOnce(err);
    await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
      name: "AiGuideError",
      userMessage: AI_GUIDE_NETWORK_ERROR_MESSAGE,
    });
  });

  it("maps a 4xx (non-401) AuthError to a generic AiGuideError", async () => {
    const err = new AuthError("Bad request", 400);
    authFetch.mockRejectedValueOnce(err);
    await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
      name: "AiGuideError",
      userMessage: AI_GUIDE_GENERIC_ERROR_MESSAGE,
    });
  });

  it("maps 429 rate-limit to a calm rate-limit AiGuideError", async () => {
    const err = new AuthError("Too many requests", 429);
    authFetch.mockRejectedValueOnce(err);
    await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
      name: "AiGuideError",
      userMessage: AI_GUIDE_RATE_LIMIT_MESSAGE,
    });
  });

  it("maps a non-AuthError throw to network-friendly AiGuideError", async () => {
    authFetch.mockRejectedValueOnce(new Error("oops"));
    await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
      name: "AiGuideError",
      userMessage: AI_GUIDE_NETWORK_ERROR_MESSAGE,
    });
  });

  it("rejects an empty server response body with a generic AiGuideError", async () => {
    authFetch.mockResolvedValueOnce(null);
    await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
      userMessage: AI_GUIDE_GENERIC_ERROR_MESSAGE,
    });
  });

  it("rejects an empty response string with a generic AiGuideError", async () => {
    authFetch.mockResolvedValueOnce({ response: "   ", mood_detected: "calm" });
    await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
      userMessage: AI_GUIDE_GENERIC_ERROR_MESSAGE,
    });
  });

  it("rejects a missing response field with a generic AiGuideError", async () => {
    authFetch.mockResolvedValueOnce({ mood_detected: "happy" });
    await expect(sendAiGuideMessage("hi")).rejects.toMatchObject({
      userMessage: AI_GUIDE_GENERIC_ERROR_MESSAGE,
    });
  });
});
