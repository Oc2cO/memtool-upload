// Central audio service for the cognitive sound layer (Task #341).
//
// One module owns playback for the four cognitive contexts. The
// public API is small on purpose:
//
//   playContext(ctx)   start the bed (and optional binaural) for a
//                      context, cross-fading whatever was playing
//   stop()             fade out and tear down current playback
//   applyLiveMasterVolume(v)
//                      update the live volume without restarting
//
// Why a singleton instead of one player per screen: contexts can
// transition rapidly (capture → home → recap) and we want a smooth
// cross-fade, not two players fighting for the audio session. A
// single owner also makes "duck for system audio" trivial — when
// AVAudioSession reports an interruption, we pause one player.
//
// Fades: every start ramps from 0 to target volume over
// `FADE_IN_MS`; every stop / transition ramps the previous players
// from current to 0 over `FADE_OUT_MS` before tearing them down.
// The fades are scheduled with `setInterval` so they survive even
// when the surrounding promise chain is suspended.

import { Platform } from "react-native";

import {
  __resetAudioSessionForTests,
  setAudioSessionModule,
  setBaseAudioMode,
} from "../audioSession";
import {
  ensureCognitiveAudioPrefsHydrated,
  getMasterVolumeCached,
  isBinauralEnabledCached,
  isCognitiveAudioEnabledCached,
} from "./preferences";
import { AMBIENT_BEDS, BINAURAL_TONES } from "./registry";
import type { CognitiveAudioContext } from "./types";

// expo-audio's `createAudioPlayer` returns an instance with
// `.play()`, `.pause()`, `.remove()`, and a `.volume` setter.
// We type-erase here so the service file doesn't have to import
// expo-audio's RN-only types — keeps web/jest happy without a
// dedicated module shim.
type AudioPlayerLike = {
  play: () => void;
  pause: () => void;
  remove: () => void;
  loop?: boolean;
  volume?: number;
};

type AudioModuleLike = {
  createAudioPlayer: (source: number | { uri: string }) => AudioPlayerLike;
  /**
   * Retained on the type so existing tests can still pass a mock
   * `setAudioModeAsync`, which is forwarded to the shared
   * `audioSession` owner via `__setAudioSessionModuleForTests`.
   */
  setAudioModeAsync?: (mode: Record<string, unknown>) => Promise<unknown>;
};

const FADE_IN_MS = 600;
const FADE_OUT_MS = 500;
const FADE_STEP_MS = 50;

let audioModule: AudioModuleLike | null = null;
let audioModuleLoadAttempted = false;

function loadAudioModule(): AudioModuleLike | null {
  if (audioModuleLoadAttempted) return audioModule;
  audioModuleLoadAttempted = true;
  if (Platform.OS === "web") {
    return null;
  }
  try {
    audioModule = require("expo-audio") as AudioModuleLike;
  } catch {
    audioModule = null;
  }
  return audioModule;
}

type ActivePlayback = {
  context: CognitiveAudioContext;
  bed: AudioPlayerLike | null;
  binaural: AudioPlayerLike | null;
  bedTargetVolume: number;
  binauralTargetVolume: number;
  fadeTimer: ReturnType<typeof setInterval> | null;
};

let active: ActivePlayback | null = null;
let configuredAudioMode = false;

async function configureAudioMode(): Promise<void> {
  if (configuredAudioMode) return;
  // Register cognitive audio's preferred policy as the long-lived
  // base mode through the shared `audioSession` owner. This survives
  // short-lived overrides (e.g. Echo Count chimes) which push their
  // own mode and pop it again — the owner re-applies the base when
  // the override stack drains. See lib/audioSession.ts for the
  // contract.
  await setBaseAudioMode({
    // Respect the device silent switch — cognitive ambience is
    // explicitly NOT event audio.
    playsInSilentMode: false,
    // Contextual layer, not background meditation.
    shouldPlayInBackground: false,
    // Mix with system audio (calls, navigation, foreground music)
    // and let the system dominate. iOS will auto-pause us when an
    // interrupting category (call) takes the session.
    interruptionMode: "mixWithOthers",
    interruptionModeAndroid: "duckOthers",
    shouldRouteThroughEarpiece: false,
  });
  configuredAudioMode = true;
}

function safeStop(player: AudioPlayerLike | null): void {
  if (!player) return;
  try {
    player.pause();
  } catch {
    /* ignore */
  }
  try {
    player.remove();
  } catch {
    /* ignore */
  }
}

function applyVolume(player: AudioPlayerLike | null, volume: number): void {
  if (!player) return;
  try {
    player.volume = volume;
  } catch {
    /* ignore — some platforms surface volume as a method */
  }
}

/**
 * Fade `players` from their current volume down to 0 over
 * `FADE_OUT_MS`, then tear them down. Used for both stop() and
 * cross-fade transitions so the user never hears a hard cut.
 */
function fadeOutAndStop(
  players: { player: AudioPlayerLike | null; from: number }[],
): void {
  const real = players.filter((p) => p.player);
  if (real.length === 0) return;
  const steps = Math.max(1, Math.round(FADE_OUT_MS / FADE_STEP_MS));
  let i = 0;
  const timer = setInterval(() => {
    i++;
    const k = 1 - i / steps;
    for (const p of real) {
      applyVolume(p.player, Math.max(0, p.from * k));
    }
    if (i >= steps) {
      clearInterval(timer);
      for (const p of real) safeStop(p.player);
    }
  }, FADE_STEP_MS);
}

/**
 * Fade the active playback from 0 up to its target volumes over
 * `FADE_IN_MS`. Cancelled if the active context changes mid-fade
 * (the next play() call clears `fadeTimer` first).
 */
function fadeInActive(): void {
  if (!active) return;
  if (active.fadeTimer) clearInterval(active.fadeTimer);
  applyVolume(active.bed, 0);
  applyVolume(active.binaural, 0);
  const steps = Math.max(1, Math.round(FADE_IN_MS / FADE_STEP_MS));
  let i = 0;
  active.fadeTimer = setInterval(() => {
    if (!active) return;
    i++;
    const k = Math.min(1, i / steps);
    applyVolume(active.bed, active.bedTargetVolume * k);
    applyVolume(active.binaural, active.binauralTargetVolume * k);
    if (i >= steps && active.fadeTimer) {
      clearInterval(active.fadeTimer);
      active.fadeTimer = null;
    }
  }, FADE_STEP_MS);
}

function tearDownActiveImmediately(): void {
  if (!active) return;
  if (active.fadeTimer) clearInterval(active.fadeTimer);
  safeStop(active.bed);
  safeStop(active.binaural);
  active = null;
}

function cancelActiveFade(): void {
  if (active?.fadeTimer) {
    clearInterval(active.fadeTimer);
    active.fadeTimer = null;
  }
}

/**
 * Start (or transition to) the bed for `context`. Idempotent — if
 * the same context is already playing this is a cheap no-op so
 * screens can safely re-call on every focus.
 */
export async function playContext(
  context: CognitiveAudioContext,
): Promise<void> {
  await ensureCognitiveAudioPrefsHydrated();
  if (!isCognitiveAudioEnabledCached()) {
    // Master switch off — fade out anything still playing.
    if (active) {
      const bed = active.bed;
      const binaural = active.binaural;
      const bedFrom = active.bedTargetVolume;
      const binauralFrom = active.binauralTargetVolume;
      cancelActiveFade();
      active = null;
      fadeOutAndStop([
        { player: bed, from: bedFrom },
        { player: binaural, from: binauralFrom },
      ]);
    }
    return;
  }
  if (active && active.context === context) {
    // Already playing the right context — sync the live target
    // volumes (the user may have moved the slider) AND reconcile
    // the binaural sub-layer in case its toggle changed while we
    // stayed on the same screen. Without this reconciliation a
    // user who flips binaural on inside Settings while a context
    // hook is still mounted would see no effect until they navigated
    // away and back.
    const v = getMasterVolumeCached();
    const wantBinaural = isBinauralEnabledCached();
    const binauralAsset = BINAURAL_TONES[context];
    active.bedTargetVolume = v;
    active.binauralTargetVolume = v * 0.5;

    if (wantBinaural && !active.binaural && binauralAsset != null) {
      // Binaural just turned on — spin up the tone player and let
      // the next fade tick (or direct apply below) bring it in.
      const mod = loadAudioModule();
      if (mod) {
        try {
          const tone = mod.createAudioPlayer(binauralAsset);
          tone.loop = true;
          applyVolume(tone, 0);
          tone.play();
          active.binaural = tone;
          // Brief fade-in for the new layer so it doesn't pop in.
          fadeInActive();
          return;
        } catch {
          /* ignore */
        }
      }
    } else if (!wantBinaural && active.binaural) {
      // Binaural just turned off — fade the tone alone, leave the
      // bed running.
      const tone = active.binaural;
      const from = active.binauralTargetVolume;
      active.binaural = null;
      active.binauralTargetVolume = 0;
      fadeOutAndStop([{ player: tone, from }]);
    }

    if (!active.fadeTimer) {
      applyVolume(active.bed, v);
      applyVolume(active.binaural, v * 0.5);
    }
    return;
  }

  // Cross-fade: capture the previous players, drop them from
  // `active`, then schedule their fade-out independently of the
  // new players' fade-in.
  if (active) {
    const prevBed = active.bed;
    const prevBinaural = active.binaural;
    const prevBedFrom = active.bedTargetVolume;
    const prevBinauralFrom = active.binauralTargetVolume;
    cancelActiveFade();
    active = null;
    fadeOutAndStop([
      { player: prevBed, from: prevBedFrom },
      { player: prevBinaural, from: prevBinauralFrom },
    ]);
  }

  await configureAudioMode();
  const mod = loadAudioModule();
  if (!mod) return;

  const bedAsset = AMBIENT_BEDS[context];
  const binauralAsset = BINAURAL_TONES[context];
  const wantBinaural = isBinauralEnabledCached();
  const v = getMasterVolumeCached();

  let bed: AudioPlayerLike | null = null;
  let binaural: AudioPlayerLike | null = null;

  if (bedAsset != null) {
    try {
      bed = mod.createAudioPlayer(bedAsset);
      if (bed) {
        bed.loop = true;
        applyVolume(bed, 0);
        bed.play();
      }
    } catch {
      bed = null;
    }
  }

  if (wantBinaural && binauralAsset != null) {
    try {
      binaural = mod.createAudioPlayer(binauralAsset);
      if (binaural) {
        binaural.loop = true;
        applyVolume(binaural, 0);
        binaural.play();
      }
    } catch {
      binaural = null;
    }
  }

  if (bed || binaural) {
    active = {
      context,
      bed,
      binaural,
      bedTargetVolume: v,
      binauralTargetVolume: v * 0.5,
      fadeTimer: null,
    };
    fadeInActive();
  }
}

/** Stop any active playback. Safe to call when nothing is playing. */
export function stop(): void {
  if (!active) return;
  const bed = active.bed;
  const binaural = active.binaural;
  const bedFrom = active.bedTargetVolume;
  const binauralFrom = active.binauralTargetVolume;
  cancelActiveFade();
  active = null;
  fadeOutAndStop([
    { player: bed, from: bedFrom },
    { player: binaural, from: binauralFrom },
  ]);
}

/**
 * Update the live volume for whatever's playing. Called by the
 * Settings panel as the user drags the master volume so the change
 * is audible immediately.
 */
export function applyLiveMasterVolume(volume: number): void {
  if (!active) return;
  active.bedTargetVolume = volume;
  active.binauralTargetVolume = volume * 0.5;
  // Only nudge volume directly if no fade is in progress; otherwise
  // the fade-in loop will pick up the new target on its next tick.
  if (!active.fadeTimer) {
    applyVolume(active.bed, volume);
    applyVolume(active.binaural, volume * 0.5);
  }
}

/**
 * Returns the context that is currently playing, or null. Used by
 * tests + the Settings hint logic.
 */
export function getActiveContext(): CognitiveAudioContext | null {
  return active?.context ?? null;
}

/** Test-only: drop active state without touching real audio. */
export function __resetCognitiveAudioServiceForTests(): void {
  if (active?.fadeTimer) clearInterval(active.fadeTimer);
  active = null;
  configuredAudioMode = false;
  audioModule = null;
  audioModuleLoadAttempted = false;
  // Drop the shared audio-session owner state too so each test starts
  // from a clean stack/base.
  __resetAudioSessionForTests();
}

/** Test-only: inject a fake audio module to drive playback paths. */
export function __setCognitiveAudioModuleForTests(
  mod: AudioModuleLike | null,
): void {
  audioModule = mod;
  audioModuleLoadAttempted = true;
  // Mirror the same fake into the shared audio-session owner so its
  // setAudioModeAsync calls (issued via setBaseAudioMode) reach the
  // jest mock the test wired up.
  setAudioSessionModule(
    mod && mod.setAudioModeAsync
      ? { setAudioModeAsync: mod.setAudioModeAsync }
      : null,
  );
}

/** Test-only: read internal target volumes for fade assertions. */
export function __getActiveTargetsForTests():
  | { bedTarget: number; binauralTarget: number }
  | null {
  if (!active) return null;
  return {
    bedTarget: active.bedTargetVolume,
    binauralTarget: active.binauralTargetVolume,
  };
}

/** Test-only: synchronously immediately tear down without fades. */
export function __forceTearDownForTests(): void {
  tearDownActiveImmediately();
}
