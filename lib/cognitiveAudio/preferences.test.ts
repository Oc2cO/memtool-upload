import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  COGNITIVE_AUDIO_PREFS_KEY,
  DEFAULT_COGNITIVE_AUDIO_PREFS,
  __resetCognitiveAudioPrefsForTests,
  ensureCognitiveAudioPrefsHydrated,
  getCognitiveAudioPrefsCached,
  getMasterVolumeCached,
  isBinauralEnabledCached,
  isCognitiveAudioEnabledCached,
  markHeadphonesHintShown,
  setBinauralEnabled,
  setCognitiveAudioEnabled,
  setMasterVolume,
  subscribeCognitiveAudioPrefs,
} from "./preferences";

const setItemMock = AsyncStorage.setItem as jest.Mock;
const getItemMock = AsyncStorage.getItem as jest.Mock;

beforeEach(() => {
  __resetCognitiveAudioPrefsForTests();
  setItemMock.mockClear();
  getItemMock.mockReset();
  getItemMock.mockResolvedValue(null);
});

describe("cognitive audio preferences", () => {
  it("defaults to off / 0.4 master volume / no hint shown", () => {
    const prefs = getCognitiveAudioPrefsCached();
    expect(prefs).toEqual(DEFAULT_COGNITIVE_AUDIO_PREFS);
    expect(prefs.enabled).toBe(false);
    expect(prefs.binauralEnabled).toBe(false);
    expect(prefs.masterVolume).toBeCloseTo(0.4);
    expect(prefs.headphonesHintShown).toBe(false);
  });

  it("hydrates from AsyncStorage and surfaces every field", async () => {
    getItemMock.mockResolvedValueOnce(
      JSON.stringify({
        enabled: true,
        binauralEnabled: true,
        masterVolume: 0.8,
        headphonesHintShown: true,
      }),
    );
    const hydrated = await ensureCognitiveAudioPrefsHydrated();
    expect(hydrated.enabled).toBe(true);
    expect(hydrated.binauralEnabled).toBe(true);
    expect(hydrated.masterVolume).toBeCloseTo(0.8);
    expect(hydrated.headphonesHintShown).toBe(true);
    expect(isCognitiveAudioEnabledCached()).toBe(true);
    expect(isBinauralEnabledCached()).toBe(true);
    expect(getMasterVolumeCached()).toBeCloseTo(0.8);
  });

  it("clamps malformed master volume back into [0, 1]", async () => {
    getItemMock.mockResolvedValueOnce(
      JSON.stringify({ masterVolume: 9000 }),
    );
    const hydrated = await ensureCognitiveAudioPrefsHydrated();
    expect(hydrated.masterVolume).toBe(1);
  });

  it("persists writes to AsyncStorage and notifies subscribers", async () => {
    const events: boolean[] = [];
    const unsub = subscribeCognitiveAudioPrefs((p) => events.push(p.enabled));
    await setCognitiveAudioEnabled(true);
    await setBinauralEnabled(true);
    await setMasterVolume(0.6);
    await markHeadphonesHintShown();
    unsub();

    expect(events.includes(true)).toBe(true);
    expect(setItemMock).toHaveBeenCalledTimes(4);
    const lastWrite = JSON.parse(setItemMock.mock.calls[3][1]);
    expect(setItemMock.mock.calls[3][0]).toBe(COGNITIVE_AUDIO_PREFS_KEY);
    expect(lastWrite).toEqual({
      enabled: true,
      binauralEnabled: true,
      masterVolume: 0.6,
      headphonesHintShown: true,
    });
  });

  it("survives a corrupted AsyncStorage blob and falls back to defaults", async () => {
    getItemMock.mockResolvedValueOnce("not json{{");
    const hydrated = await ensureCognitiveAudioPrefsHydrated();
    expect(hydrated).toEqual(DEFAULT_COGNITIVE_AUDIO_PREFS);
  });

  it("treats a failing read as defaults rather than throwing", async () => {
    getItemMock.mockRejectedValueOnce(new Error("nope"));
    const hydrated = await ensureCognitiveAudioPrefsHydrated();
    expect(hydrated).toEqual(DEFAULT_COGNITIVE_AUDIO_PREFS);
  });
});
