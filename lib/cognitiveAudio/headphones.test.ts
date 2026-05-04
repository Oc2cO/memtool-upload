import {
  __resetHeadphonesCacheForTests,
  __setHeadphonesCacheForTests,
  areHeadphonesConnected,
  shouldShowHeadphonesHint,
} from "./headphones";

beforeEach(() => {
  __resetHeadphonesCacheForTests();
});

describe("headphones detection", () => {
  it("treats 'connected' override as headphones present", async () => {
    __setHeadphonesCacheForTests("connected");
    expect(await areHeadphonesConnected()).toBe(true);
    expect(await shouldShowHeadphonesHint()).toBe(false);
  });

  it("treats 'disconnected' override as no headphones", async () => {
    __setHeadphonesCacheForTests("disconnected");
    expect(await areHeadphonesConnected()).toBe(false);
    expect(await shouldShowHeadphonesHint()).toBe(true);
  });

  it("treats 'unknown' override as 'show the hint' (best-effort)", async () => {
    __setHeadphonesCacheForTests("unknown");
    expect(await areHeadphonesConnected()).toBe(null);
    expect(await shouldShowHeadphonesHint()).toBe(true);
  });

  it("re-probes on every call (no session cache) so unplug → re-enable surfaces the hint", async () => {
    // Simulate "headphones connected" at first call, then a later
    // unplug. With the previous session-long cache, the second
    // call would still report `true` and `shouldShowHeadphonesHint`
    // would stay `false` forever — breaking the one-time hint
    // requirement on a real unplug + re-enable flow.
    __setHeadphonesCacheForTests("connected");
    expect(await shouldShowHeadphonesHint()).toBe(false);

    // User unplugs.
    __setHeadphonesCacheForTests("disconnected");
    expect(await shouldShowHeadphonesHint()).toBe(true);

    // And plugs back in.
    __setHeadphonesCacheForTests("connected");
    expect(await shouldShowHeadphonesHint()).toBe(false);
  });
});
