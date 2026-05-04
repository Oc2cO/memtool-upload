// Unit tests for the launch-time FoundationModels pre-warm (Task #263).
//
// We mock the entire `foundation-models` module so tests never touch native
// code and can control availability + cold-start state independently.

import {
  __resetPrewarmForTests,
  prewarmFoundationModels,
} from "./foundationModelsPrewarm";

jest.mock("../modules/foundation-models", () => ({
  getAvailability: jest.fn().mockReturnValue({ available: true, reason: null }),
  isFirstRunInProcess: jest.fn().mockReturnValue(true),
  summarize: jest
    .fn()
    .mockResolvedValue({ status: "ok", summary: "x", latencyMs: 100, approxTokens: 1 }),
}));

import {
  getAvailability,
  isFirstRunInProcess,
  summarize,
} from "../modules/foundation-models";

const mockGetAvailability = getAvailability as jest.Mock;
const mockIsFirstRunInProcess = isFirstRunInProcess as jest.Mock;
const mockSummarize = summarize as jest.Mock;

afterEach(() => {
  __resetPrewarmForTests();
  jest.clearAllMocks();
  mockGetAvailability.mockReturnValue({ available: true, reason: null });
  mockIsFirstRunInProcess.mockReturnValue(true);
  mockSummarize.mockResolvedValue({
    status: "ok",
    summary: "x",
    latencyMs: 100,
    approxTokens: 1,
  });
});

describe("prewarmFoundationModels", () => {
  it("fires summarize with the warm-up string when available and first run", () => {
    prewarmFoundationModels();

    expect(mockSummarize).toHaveBeenCalledTimes(1);
    expect(mockSummarize).toHaveBeenCalledWith("warm");
  });

  it("does NOT fire summarize when availability is unavailable", () => {
    mockGetAvailability.mockReturnValue({
      available: false,
      reason: "device_not_eligible",
    });

    prewarmFoundationModels();

    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it("does NOT fire summarize when availability reason is apple_intelligence_not_enabled", () => {
    mockGetAvailability.mockReturnValue({
      available: false,
      reason: "apple_intelligence_not_enabled",
    });

    prewarmFoundationModels();

    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it("does NOT fire summarize when isFirstRunInProcess returns false (cold cost already paid)", () => {
    mockIsFirstRunInProcess.mockReturnValue(false);

    prewarmFoundationModels();

    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it("only fires summarize once even when called multiple times", () => {
    prewarmFoundationModels();
    prewarmFoundationModels();
    prewarmFoundationModels();

    expect(mockSummarize).toHaveBeenCalledTimes(1);
  });

  it("does not fire on a second call even if the first call's promise is still pending", () => {
    // The prewarmFired flag is set synchronously before the Promise resolves,
    // so a second call before summarize completes is still a no-op.
    let resolveFirst!: () => void;
    mockSummarize.mockReturnValueOnce(
      new Promise<void>((res) => { resolveFirst = res; }),
    );

    prewarmFoundationModels(); // fires and sets prewarmFired=true immediately
    prewarmFoundationModels(); // must be a no-op

    expect(mockSummarize).toHaveBeenCalledTimes(1);

    // Cleanup — resolve the pending promise so there are no dangling timers.
    resolveFirst();
  });

  it("does not check availability when isFirstRunInProcess is false (short-circuit order)", () => {
    mockIsFirstRunInProcess.mockReturnValue(false);

    prewarmFoundationModels();

    // getAvailability should never be reached when cold cost is already paid
    expect(mockGetAvailability).not.toHaveBeenCalled();
    expect(mockSummarize).not.toHaveBeenCalled();
  });
});
