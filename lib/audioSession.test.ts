import {
  __getEffectiveAudioModeForTests,
  __resetAudioSessionForTests,
  __setAudioSessionModuleForTests,
  popAudioModeOverride,
  pushAudioModeOverride,
  setBaseAudioMode,
} from "./audioSession";

const COGNITIVE_MODE = {
  playsInSilentMode: false,
  interruptionMode: "mixWithOthers",
} as const;

const SKILL_MODE = {
  playsInSilentMode: true,
  interruptionMode: "duckOthers",
} as const;

let setAudioModeAsync: jest.Mock;

beforeEach(() => {
  __resetAudioSessionForTests();
  setAudioModeAsync = jest.fn(() => Promise.resolve());
  __setAudioSessionModuleForTests({ setAudioModeAsync });
});

describe("audioSession owner", () => {
  it("applies the base mode when no override is on the stack", async () => {
    await setBaseAudioMode(COGNITIVE_MODE);
    expect(setAudioModeAsync).toHaveBeenLastCalledWith(COGNITIVE_MODE);
    expect(__getEffectiveAudioModeForTests()).toEqual(COGNITIVE_MODE);
  });

  it("override beats the base mode while pushed", async () => {
    await setBaseAudioMode(COGNITIVE_MODE);
    await pushAudioModeOverride("skill-event", SKILL_MODE);
    expect(setAudioModeAsync).toHaveBeenLastCalledWith(SKILL_MODE);
    expect(__getEffectiveAudioModeForTests()).toEqual(SKILL_MODE);
  });

  it("popping the override re-applies the base mode", async () => {
    await setBaseAudioMode(COGNITIVE_MODE);
    await pushAudioModeOverride("skill-event", SKILL_MODE);
    setAudioModeAsync.mockClear();
    await popAudioModeOverride("skill-event");
    expect(setAudioModeAsync).toHaveBeenCalledWith(COGNITIVE_MODE);
    expect(__getEffectiveAudioModeForTests()).toEqual(COGNITIVE_MODE);
  });

  it("does not reapply the base mode while overrides remain", async () => {
    await setBaseAudioMode(COGNITIVE_MODE);
    await pushAudioModeOverride("skill-event", SKILL_MODE);
    setAudioModeAsync.mockClear();
    await setBaseAudioMode({ ...COGNITIVE_MODE, shouldPlayInBackground: true });
    expect(setAudioModeAsync).not.toHaveBeenCalled();
  });

  it("re-pushing the same key updates the mode without stacking duplicates", async () => {
    await setBaseAudioMode(COGNITIVE_MODE);
    await pushAudioModeOverride("skill-event", SKILL_MODE);
    const updated = { ...SKILL_MODE, shouldRouteThroughEarpiece: false };
    await pushAudioModeOverride("skill-event", updated);
    expect(setAudioModeAsync).toHaveBeenLastCalledWith(updated);
    await popAudioModeOverride("skill-event");
    // After a single pop the base mode is back — no second override
    // copy lingering on the stack.
    expect(__getEffectiveAudioModeForTests()).toEqual(COGNITIVE_MODE);
  });

  it("popping an unknown key is a no-op", async () => {
    await setBaseAudioMode(COGNITIVE_MODE);
    setAudioModeAsync.mockClear();
    await popAudioModeOverride("nope");
    expect(setAudioModeAsync).not.toHaveBeenCalled();
    expect(__getEffectiveAudioModeForTests()).toEqual(COGNITIVE_MODE);
  });
});
