/**
 * Tiny audio helper for the Skills Bundle 1 mini-games (Task #355).
 *
 * Echo Count is the only consumer today — it needs to fire a short
 * chime N times per round. We deliberately keep this isolated from
 * the cognitive audio service: that singleton owns long-lived,
 * cross-faded ambient beds; chimes are short event SFX that should
 * play on top of (and duck) other audio without interfering with the
 * bed currently mounted by the games context.
 *
 * Audio session policy is coordinated through the shared
 * `lib/audioSession.ts` owner so we don't fight the cognitive
 * service over global mode flags. We push a `"skill-event"` override
 * (playsInSilentMode: true, duckOthers) on first chime and pop it on
 * `releaseSkillAudio` — the owner re-applies whatever base mode the
 * cognitive service registered, so the user's ambient bed keeps its
 * intended silent-switch behaviour after Echo Count exits.
 *
 * Other notes:
 *   - Loaded lazily via require so jest + web don't try to resolve
 *     the native module.
 *   - One reusable player per asset; we just `seekTo(0); play()` to
 *     re-trigger so we don't churn native objects each chime.
 *   - All errors are swallowed: the Echo Count screen still shows
 *     the visual pulse + counter, so silent fallback is acceptable.
 */
import { Platform } from "react-native";

import {
  popAudioModeOverride,
  pushAudioModeOverride,
  setAudioSessionModule,
} from "./audioSession";

type AudioPlayerLike = {
  play: () => void;
  pause: () => void;
  remove: () => void;
  seekTo?: (seconds: number) => void;
  volume?: number;
  loop?: boolean;
  currentTime?: number;
};

type AudioModuleLike = {
  createAudioPlayer: (source: number | { uri: string }) => AudioPlayerLike;
  setAudioModeAsync?: (mode: Record<string, unknown>) => Promise<unknown>;
};

const SKILL_EVENT_OVERRIDE_KEY = "skill-event";
const SKILL_EVENT_MODE = {
  // Chimes are core gameplay — the user has tapped "Start round" and
  // is staring at a "Listen and count…" prompt. Silent mode shouldn't
  // black-hole them.
  playsInSilentMode: true,
  shouldPlayInBackground: false,
  // Duck other audio (music, podcasts) so the chime cuts through
  // without fully pausing the user's media.
  interruptionMode: "duckOthers",
  interruptionModeAndroid: "duckOthers",
  shouldRouteThroughEarpiece: false,
} as const;

let audioModule: AudioModuleLike | null = null;
let audioModuleLoadAttempted = false;
let overrideAcquired = false;
const playerCache = new Map<number, AudioPlayerLike>();

function loadAudioModule(): AudioModuleLike | null {
  if (audioModuleLoadAttempted) return audioModule;
  audioModuleLoadAttempted = true;
  if (Platform.OS === "web") return null;
  try {
    audioModule = require("expo-audio") as AudioModuleLike;
  } catch {
    audioModule = null;
  }
  // Mirror the resolved expo-audio module into the shared
  // audio-session owner so the override push lands on the same
  // native binding as the player.
  if (audioModule?.setAudioModeAsync) {
    setAudioSessionModule({
      setAudioModeAsync: audioModule.setAudioModeAsync,
    });
  }
  return audioModule;
}

const CHIME_ASSET: number = require("../assets/audio/skills/bundle-1/chime.wav");

function getOrCreatePlayer(assetId: number): AudioPlayerLike | null {
  const cached = playerCache.get(assetId);
  if (cached) return cached;
  const mod = loadAudioModule();
  if (!mod) return null;
  try {
    const p = mod.createAudioPlayer(assetId);
    if (p) {
      try {
        p.loop = false;
      } catch {
        /* ignore */
      }
      try {
        p.volume = 1;
      } catch {
        /* ignore */
      }
      playerCache.set(assetId, p);
    }
    return p;
  } catch {
    return null;
  }
}

/**
 * Fire the Echo Count chime once. Resolves immediately (the player
 * is non-blocking) so callers can schedule the next chime via
 * `setTimeout` without waiting.
 */
export async function playEchoChime(): Promise<void> {
  if (!overrideAcquired) {
    overrideAcquired = true;
    await pushAudioModeOverride(SKILL_EVENT_OVERRIDE_KEY, SKILL_EVENT_MODE);
  }
  const player = getOrCreatePlayer(CHIME_ASSET);
  if (!player) return;
  try {
    if (typeof player.seekTo === "function") {
      player.seekTo(0);
    } else if (typeof player.currentTime === "number") {
      player.currentTime = 0;
    }
  } catch {
    /* ignore — first play() doesn't need a seek */
  }
  try {
    player.play();
  } catch {
    /* ignore */
  }
}

/**
 * Release any cached players AND drop the audio-session override so
 * the previously-registered base mode (e.g. cognitive ambient
 * playback policy) is re-applied. Echo Count calls this on unmount
 * so we don't keep a native player alive after the player leaves the
 * screen and so background audio policy snaps back.
 */
export function releaseSkillAudio(): void {
  for (const p of playerCache.values()) {
    try {
      p.pause();
    } catch {
      /* ignore */
    }
    try {
      p.remove();
    } catch {
      /* ignore */
    }
  }
  playerCache.clear();
  if (overrideAcquired) {
    overrideAcquired = false;
    // Fire and forget — restoration is best-effort and we don't want
    // to block the unmount path on a native round-trip.
    void popAudioModeOverride(SKILL_EVENT_OVERRIDE_KEY);
  }
}

/** Test-only: reset module state without touching real audio. */
export function __resetSkillAudioForTests(): void {
  playerCache.clear();
  audioModule = null;
  audioModuleLoadAttempted = false;
  overrideAcquired = false;
}
