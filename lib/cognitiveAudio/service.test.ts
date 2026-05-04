import {
  __resetCognitiveAudioPrefsForTests,
  setBinauralEnabled,
  setCognitiveAudioEnabled,
  setMasterVolume,
} from "./preferences";
import { AMBIENT_BEDS, BINAURAL_TONES } from "./registry";
import {
  __getActiveTargetsForTests,
  __resetCognitiveAudioServiceForTests,
  __setCognitiveAudioModuleForTests,
  applyLiveMasterVolume,
  getActiveContext,
  playContext,
  stop,
} from "./service";

type FakePlayer = {
  play: jest.Mock;
  pause: jest.Mock;
  remove: jest.Mock;
  loop?: boolean;
  volume?: number;
};

function makePlayer(): FakePlayer {
  return {
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    loop: false,
    volume: 0,
  };
}

let createdPlayers: FakePlayer[];
let createAudioPlayer: jest.Mock;
let setAudioModeAsync: jest.Mock;

// Keep an immutable snapshot of what the registry SHIPS in the
// real binary so tests can restore it after mutating the registry
// to drive specific code paths (e.g. simulating a missing asset).
const SHIPPED_BEDS = { ...AMBIENT_BEDS };
const SHIPPED_BINAURAL = { ...BINAURAL_TONES };

beforeEach(() => {
  jest.useFakeTimers();
  __resetCognitiveAudioPrefsForTests();
  __resetCognitiveAudioServiceForTests();
  // Restore the registry between tests in case the previous test
  // poked an asset to null.
  for (const ctx of Object.keys(SHIPPED_BEDS) as (keyof typeof SHIPPED_BEDS)[]) {
    AMBIENT_BEDS[ctx] = SHIPPED_BEDS[ctx];
    BINAURAL_TONES[ctx] = SHIPPED_BINAURAL[ctx];
  }
  createdPlayers = [];
  createAudioPlayer = jest.fn(() => {
    const p = makePlayer();
    createdPlayers.push(p);
    return p;
  });
  setAudioModeAsync = jest.fn(() => Promise.resolve());
  __setCognitiveAudioModuleForTests({
    createAudioPlayer,
    setAudioModeAsync,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

/** Drain pending fade timers so an assertion sees the steady state. */
function runAllFades(): void {
  for (let i = 0; i < 50; i++) {
    jest.advanceTimersByTime(50);
  }
}

describe("cognitive audio service", () => {
  it("ships an asset for every context", () => {
    // Sanity check: the cognitive layer is supposed to be fully
    // wired. If any registry entry regresses to null this test is
    // the canary.
    expect(SHIPPED_BEDS.capture).not.toBeNull();
    expect(SHIPPED_BEDS.recap).not.toBeNull();
    expect(SHIPPED_BEDS.games).not.toBeNull();
    expect(SHIPPED_BEDS.sleep).not.toBeNull();
    expect(SHIPPED_BINAURAL.capture).not.toBeNull();
    expect(SHIPPED_BINAURAL.sleep).not.toBeNull();
  });

  it("no-ops when the master switch is off", async () => {
    await playContext("capture");
    expect(createAudioPlayer).not.toHaveBeenCalled();
    expect(getActiveContext()).toBeNull();
  });

  it("no-ops gracefully when no asset is bundled even if enabled", async () => {
    await setCognitiveAudioEnabled(true);
    AMBIENT_BEDS.capture = null;
    BINAURAL_TONES.capture = null;
    await playContext("capture");
    expect(createAudioPlayer).not.toHaveBeenCalled();
    expect(getActiveContext()).toBeNull();
  });

  it("plays the bed when master is on and an asset is bundled", async () => {
    await setCognitiveAudioEnabled(true);
    await playContext("capture");
    expect(setAudioModeAsync).toHaveBeenCalled();
    expect(createAudioPlayer).toHaveBeenCalledWith(SHIPPED_BEDS.capture);
    expect(createdPlayers).toHaveLength(1);
    expect(createdPlayers[0].play).toHaveBeenCalled();
    expect(createdPlayers[0].loop).toBe(true);
    expect(getActiveContext()).toBe("capture");
    // Fade-in starts at 0 and ramps to target.
    expect(createdPlayers[0].volume).toBe(0);
    runAllFades();
    expect(createdPlayers[0].volume).toBeCloseTo(0.4, 5);
  });

  it("layers binaural under the bed when both are bundled and enabled", async () => {
    await setCognitiveAudioEnabled(true);
    await setBinauralEnabled(true);
    await playContext("recap");
    expect(createAudioPlayer).toHaveBeenCalledTimes(2);
    expect(createdPlayers).toHaveLength(2);
    runAllFades();
    expect(createdPlayers[0].volume).toBeCloseTo(0.4, 5);
    // Binaural sits half-under the bed.
    expect(createdPlayers[1].volume).toBeCloseTo(0.2, 5);
  });

  it("transitions cleanly when the context changes (cross-fade)", async () => {
    await setCognitiveAudioEnabled(true);
    await playContext("capture");
    const firstPlayer = createdPlayers[0];
    await playContext("recap");
    // The previous player isn't torn down synchronously — fades run
    // on a setInterval. Drain the fade and then assert teardown.
    runAllFades();
    expect(firstPlayer.pause).toHaveBeenCalled();
    expect(firstPlayer.remove).toHaveBeenCalled();
    expect(getActiveContext()).toBe("recap");
  });

  it("stop() fades out and tears down active playback", async () => {
    await setCognitiveAudioEnabled(true);
    await playContext("capture");
    const player = createdPlayers[0];
    stop();
    expect(getActiveContext()).toBeNull();
    runAllFades();
    expect(player.pause).toHaveBeenCalled();
    expect(player.remove).toHaveBeenCalled();
  });

  it("applyLiveMasterVolume updates the live target without restarting", async () => {
    await setCognitiveAudioEnabled(true);
    await playContext("capture");
    runAllFades();
    applyLiveMasterVolume(0.9);
    const targets = __getActiveTargetsForTests();
    expect(targets?.bedTarget).toBeCloseTo(0.9, 5);
    expect(targets?.binauralTarget).toBeCloseTo(0.45, 5);
    expect(createdPlayers[0].volume).toBeCloseTo(0.9, 5);
  });

  it("re-calling playContext for the active context just syncs volume", async () => {
    await setCognitiveAudioEnabled(true);
    await playContext("capture");
    runAllFades();
    await setMasterVolume(0.7);
    await playContext("capture");
    // Only one player ever created.
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(createdPlayers[0].volume).toBeCloseTo(0.7, 5);
  });

  it("reconciles binaural toggle while staying on the same context", async () => {
    // Bed only at first.
    await setCognitiveAudioEnabled(true);
    await playContext("capture");
    runAllFades();
    expect(createdPlayers).toHaveLength(1);

    // Flip binaural on, replay same context — tone player spins up.
    await setBinauralEnabled(true);
    await playContext("capture");
    runAllFades();
    expect(createdPlayers).toHaveLength(2);
    expect(createdPlayers[1].play).toHaveBeenCalled();
    expect(createdPlayers[1].volume).toBeCloseTo(0.2, 5);

    // Flip binaural off, replay same context — tone fades out and
    // is removed; bed keeps running.
    await setBinauralEnabled(false);
    await playContext("capture");
    runAllFades();
    expect(createdPlayers[1].pause).toHaveBeenCalled();
    expect(createdPlayers[1].remove).toHaveBeenCalled();
    expect(createdPlayers[0].pause).not.toHaveBeenCalled();
    expect(getActiveContext()).toBe("capture");
  });

  it("turning master off and re-playing tears down active playback", async () => {
    await setCognitiveAudioEnabled(true);
    await playContext("capture");
    runAllFades();
    const player = createdPlayers[0];
    await setCognitiveAudioEnabled(false);
    await playContext("capture");
    runAllFades();
    expect(player.pause).toHaveBeenCalled();
    expect(getActiveContext()).toBeNull();
  });
});
