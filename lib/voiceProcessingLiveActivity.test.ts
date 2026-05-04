import {
  __resetNativeModuleForTests,
  __setNativeModuleForTests,
} from "../modules/voice-processing-live-activity";
import {
  cleanUpStaleProcessingActivities,
  endProcessingActivity,
  getLiveActivityAvailability,
  isLiveActivityAvailable,
  markProcessingActivityReady,
  startProcessingActivity,
  VOICE_CAPTURE_DEEP_LINK,
} from "./voiceProcessingLiveActivity";

afterEach(() => {
  __resetNativeModuleForTests();
});

describe("availability", () => {
  it("reports unavailable when the native module is not linked", () => {
    __setNativeModuleForTests(null);
    expect(isLiveActivityAvailable()).toBe(false);
    expect(getLiveActivityAvailability()).toEqual({
      available: false,
      reason: "module_not_linked",
    });
  });

  it("reports available when the native module says so", () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn(),
      updateActivity: jest.fn(),
      endActivity: jest.fn(),
      endAllActivities: jest.fn(),
    });
    expect(isLiveActivityAvailable()).toBe(true);
    expect(getLiveActivityAvailability().reason).toBeNull();
  });

  it("normalizes unknown unavailable reasons", () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: false, reason: "ufo_landed" }),
      startActivity: jest.fn(),
      updateActivity: jest.fn(),
      endActivity: jest.fn(),
      endAllActivities: jest.fn(),
    });
    expect(getLiveActivityAvailability()).toEqual({
      available: false,
      reason: "unknown",
    });
  });
});

describe("startProcessingActivity", () => {
  it("returns null when the native module is not linked", async () => {
    __setNativeModuleForTests(null);
    const handle = await startProcessingActivity();
    expect(handle).toBeNull();
  });

  it("returns the activity id when the native module starts one", async () => {
    const startActivity = jest
      .fn()
      .mockResolvedValue({ status: "ok", activityId: "activity-42" });
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity,
      updateActivity: jest.fn(),
      endActivity: jest.fn(),
      endAllActivities: jest.fn(),
    });

    const handle = await startProcessingActivity();
    expect(handle).toBe("activity-42");
    expect(startActivity).toHaveBeenCalledWith({
      deepLinkUrl: VOICE_CAPTURE_DEEP_LINK,
    });
  });

  it("forwards a custom deep link", async () => {
    const startActivity = jest
      .fn()
      .mockResolvedValue({ status: "ok", activityId: "id" });
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity,
      updateActivity: jest.fn(),
      endActivity: jest.fn(),
      endAllActivities: jest.fn(),
    });
    await startProcessingActivity({ deepLinkUrl: "memtool:///somewhere" });
    expect(startActivity).toHaveBeenCalledWith({
      deepLinkUrl: "memtool:///somewhere",
    });
  });

  it("returns null when the native start call resolves unavailable", async () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest
        .fn()
        .mockResolvedValue({ status: "unavailable", reason: "start_failed" }),
      updateActivity: jest.fn(),
      endActivity: jest.fn(),
      endAllActivities: jest.fn(),
    });
    const handle = await startProcessingActivity();
    expect(handle).toBeNull();
  });

  it("returns null when the native start call rejects", async () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn().mockRejectedValue(new Error("boom")),
      updateActivity: jest.fn(),
      endActivity: jest.fn(),
      endAllActivities: jest.fn(),
    });
    const handle = await startProcessingActivity();
    expect(handle).toBeNull();
  });
});

describe("markProcessingActivityReady", () => {
  it("is a no-op when the handle is null", async () => {
    const updateActivity = jest.fn();
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn(),
      updateActivity,
      endActivity: jest.fn(),
      endAllActivities: jest.fn(),
    });
    await markProcessingActivityReady(null);
    expect(updateActivity).not.toHaveBeenCalled();
  });

  it("forwards the 'ready' phase to the native module", async () => {
    const updateActivity = jest.fn().mockResolvedValue({ status: "ok" });
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn(),
      updateActivity,
      endActivity: jest.fn(),
      endAllActivities: jest.fn(),
    });
    await markProcessingActivityReady("activity-7");
    expect(updateActivity).toHaveBeenCalledWith("activity-7", "ready");
  });

  it("swallows native rejections so the save flow never crashes", async () => {
    const updateActivity = jest.fn().mockRejectedValue(new Error("nope"));
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn(),
      updateActivity,
      endActivity: jest.fn(),
      endAllActivities: jest.fn(),
    });
    await expect(
      markProcessingActivityReady("activity-7"),
    ).resolves.toBeUndefined();
  });
});

describe("endProcessingActivity", () => {
  it("is a no-op when the handle is null", async () => {
    const endActivity = jest.fn();
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn(),
      updateActivity: jest.fn(),
      endActivity,
      endAllActivities: jest.fn(),
    });
    await endProcessingActivity(null);
    expect(endActivity).not.toHaveBeenCalled();
  });

  it("ends the activity by id", async () => {
    const endActivity = jest.fn().mockResolvedValue({ status: "ok" });
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn(),
      updateActivity: jest.fn(),
      endActivity,
      endAllActivities: jest.fn(),
    });
    await endProcessingActivity("activity-9");
    expect(endActivity).toHaveBeenCalledWith("activity-9");
  });

  it("swallows native rejections", async () => {
    const endActivity = jest.fn().mockRejectedValue(new Error("nope"));
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn(),
      updateActivity: jest.fn(),
      endActivity,
      endAllActivities: jest.fn(),
    });
    await expect(endProcessingActivity("activity-9")).resolves.toBeUndefined();
  });
});

describe("cleanUpStaleProcessingActivities", () => {
  it("resolves quietly when the native module is not linked", async () => {
    __setNativeModuleForTests(null);
    await expect(
      cleanUpStaleProcessingActivities(),
    ).resolves.toBeUndefined();
  });

  it("calls endAllActivities on the native module", async () => {
    const endAllActivities = jest
      .fn()
      .mockResolvedValue({ status: "ok", endedCount: 0 });
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn(),
      updateActivity: jest.fn(),
      endActivity: jest.fn(),
      endAllActivities,
    });
    await cleanUpStaleProcessingActivities();
    expect(endAllActivities).toHaveBeenCalledTimes(1);
  });

  it("resolves when the sweep ends one or more leftover activities", async () => {
    const endAllActivities = jest
      .fn()
      .mockResolvedValue({ status: "ok", endedCount: 2 });
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn(),
      updateActivity: jest.fn(),
      endActivity: jest.fn(),
      endAllActivities,
    });
    await expect(
      cleanUpStaleProcessingActivities(),
    ).resolves.toBeUndefined();
    expect(endAllActivities).toHaveBeenCalledTimes(1);
  });

  it("swallows native rejections so app launch never crashes", async () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn(),
      updateActivity: jest.fn(),
      endActivity: jest.fn(),
      endAllActivities: jest.fn().mockRejectedValue(new Error("boom")),
    });
    await expect(
      cleanUpStaleProcessingActivities(),
    ).resolves.toBeUndefined();
  });

  it("swallows synchronous bridge throws so app launch never crashes", async () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn(),
      updateActivity: jest.fn(),
      endActivity: jest.fn(),
      endAllActivities: jest.fn(() => {
        throw new Error("bridge exploded");
      }),
    });
    await expect(
      cleanUpStaleProcessingActivities(),
    ).resolves.toBeUndefined();
  });

  it("resolves quietly when the sweep reports unavailable", async () => {
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity: jest.fn(),
      updateActivity: jest.fn(),
      endActivity: jest.fn(),
      endAllActivities: jest
        .fn()
        .mockResolvedValue({ status: "unavailable", reason: "ios_below_16_1" }),
    });
    await expect(
      cleanUpStaleProcessingActivities(),
    ).resolves.toBeUndefined();
  });
});

describe("end-to-end lifecycle", () => {
  it("start → ready → end calls the native module in order", async () => {
    const calls: string[] = [];
    const startActivity = jest.fn(async () => {
      calls.push("start");
      return { status: "ok" as const, activityId: "abc" };
    });
    const updateActivity = jest.fn(async () => {
      calls.push("update");
      return { status: "ok" as const };
    });
    const endActivity = jest.fn(async () => {
      calls.push("end");
      return { status: "ok" as const };
    });
    __setNativeModuleForTests({
      getAvailability: () => ({ available: true, reason: null }),
      startActivity,
      updateActivity,
      endActivity,
      endAllActivities: jest.fn(),
    });

    const handle = await startProcessingActivity();
    await markProcessingActivityReady(handle);
    await endProcessingActivity(handle);

    expect(calls).toEqual(["start", "update", "end"]);
    expect(updateActivity).toHaveBeenCalledWith("abc", "ready");
    expect(endActivity).toHaveBeenCalledWith("abc");
  });
});
