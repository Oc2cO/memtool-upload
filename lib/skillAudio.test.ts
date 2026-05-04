/**
 * Verifies that the Echo Count chime helper coordinates with the
 * shared audio session owner: first play pushes the skill-event
 * override, releaseSkillAudio pops it, and overrides play nicely with
 * a previously-registered base mode (e.g. cognitive ambient).
 */
type FakePlayer = {
  play: jest.Mock;
  pause: jest.Mock;
  remove: jest.Mock;
  seekTo: jest.Mock;
  loop?: boolean;
  volume?: number;
};

const mockCreatedPlayers: FakePlayer[] = [];
const mockCreateAudioPlayer = jest.fn();
const mockSetAudioModeAsync = jest.fn(() => Promise.resolve());

jest.mock("expo-audio", () => ({
  createAudioPlayer: mockCreateAudioPlayer,
  setAudioModeAsync: mockSetAudioModeAsync,
}));

import {
  __getEffectiveAudioModeForTests,
  __resetAudioSessionForTests,
  setAudioSessionModule,
  setBaseAudioMode,
} from "./audioSession";
import {
  __resetSkillAudioForTests,
  playEchoChime,
  releaseSkillAudio,
} from "./skillAudio";

const COGNITIVE_BASE = {
  playsInSilentMode: false,
  interruptionMode: "mixWithOthers",
} as const;

function makePlayer(): FakePlayer {
  return {
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    seekTo: jest.fn(),
    loop: false,
    volume: 0,
  };
}

beforeEach(() => {
  __resetAudioSessionForTests();
  __resetSkillAudioForTests();
  mockCreatedPlayers.length = 0;
  mockCreateAudioPlayer.mockReset();
  mockCreateAudioPlayer.mockImplementation(() => {
    const p = makePlayer();
    mockCreatedPlayers.push(p);
    return p;
  });
  mockSetAudioModeAsync.mockClear();
  setAudioSessionModule({ setAudioModeAsync: mockSetAudioModeAsync });
});

describe("skillAudio", () => {
  it("pushes the skill-event override on first play and pops it on release", async () => {
    await setBaseAudioMode(COGNITIVE_BASE);
    expect(__getEffectiveAudioModeForTests()).toEqual(COGNITIVE_BASE);

    await playEchoChime();
    const effective = __getEffectiveAudioModeForTests();
    expect(effective?.playsInSilentMode).toBe(true);
    expect(effective?.interruptionMode).toBe("duckOthers");
    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockCreatedPlayers[0]!.play).toHaveBeenCalledTimes(1);

    releaseSkillAudio();
    // releaseSkillAudio fires the pop async; allow it to settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(__getEffectiveAudioModeForTests()).toEqual(COGNITIVE_BASE);
    expect(mockCreatedPlayers[0]!.pause).toHaveBeenCalled();
    expect(mockCreatedPlayers[0]!.remove).toHaveBeenCalled();
  });

  it("re-uses the cached player across repeated chimes", async () => {
    await playEchoChime();
    await playEchoChime();
    await playEchoChime();
    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockCreatedPlayers[0]!.play).toHaveBeenCalledTimes(3);
    expect(mockCreatedPlayers[0]!.seekTo).toHaveBeenCalledWith(0);
  });
});
