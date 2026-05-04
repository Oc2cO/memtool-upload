/**
 * Shared owner of the global expo-audio session mode (Task #355).
 *
 * Multiple feature modules in MemTool need to influence
 * AVAudioSession / Android AudioFocus settings:
 *
 *   - The cognitive audio service (lib/cognitiveAudio/service.ts)
 *     plays long-lived ambient beds and wants
 *     `playsInSilentMode: false` (the silent switch must mute it)
 *     plus `mixWithOthers` so it sits under any music the user is
 *     already playing.
 *   - The Echo Count chime (lib/skillAudio.ts) is short event audio
 *     the user explicitly opted into by tapping "Start round" — it
 *     wants `playsInSilentMode: true` and `duckOthers` so the chime
 *     cuts through.
 *
 * Without coordination, whichever module called `setAudioModeAsync`
 * last would silently flip the policy for the other. This module
 * centralizes the policy as a small stack:
 *
 *   - `setBaseAudioMode(mode)`: long-lived background policy. The
 *     last writer wins; applied immediately if no override is on
 *     top of the stack.
 *   - `pushAudioModeOverride(key, mode)`: short-lived override (e.g.
 *     while a chime player is alive). Applied immediately. Repeated
 *     pushes for the same `key` move the entry to the top.
 *   - `popAudioModeOverride(key)`: removes the override and reapplies
 *     whatever's now on top (or the base mode).
 *
 * Errors from the native call are swallowed (best-effort, mirroring
 * the previous behaviour of every consumer); expo-audio falls back
 * to a sensible default when a mode rejects.
 */
import { Platform } from "react-native";

export type AudioMode = Record<string, unknown>;

type AudioModuleLike = {
  setAudioModeAsync?: (mode: AudioMode) => Promise<unknown>;
};

let audioModule: AudioModuleLike | null = null;
let audioModuleLoadAttempted = false;
let baseMode: AudioMode | null = null;
const overrideStack: { key: string; mode: AudioMode }[] = [];

function loadAudioModule(): AudioModuleLike | null {
  if (audioModuleLoadAttempted) return audioModule;
  audioModuleLoadAttempted = true;
  if (Platform.OS === "web") return null;
  try {
    audioModule = require("expo-audio") as AudioModuleLike;
  } catch {
    audioModule = null;
  }
  return audioModule;
}

async function applyToNative(mode: AudioMode | null): Promise<void> {
  if (!mode) return;
  const mod = loadAudioModule();
  if (!mod?.setAudioModeAsync) return;
  try {
    await mod.setAudioModeAsync(mode);
  } catch {
    /* best-effort */
  }
}

function topMode(): AudioMode | null {
  if (overrideStack.length > 0) {
    return overrideStack[overrideStack.length - 1]!.mode;
  }
  return baseMode;
}

/**
 * Register the long-lived background mode. Re-applied automatically
 * whenever the override stack drains. Calling repeatedly with a new
 * mode replaces the previous base.
 */
export async function setBaseAudioMode(mode: AudioMode): Promise<void> {
  baseMode = mode;
  if (overrideStack.length === 0) {
    await applyToNative(mode);
  }
}

/**
 * Push (or refresh) an override mode by key. The override becomes
 * the active mode immediately. Pushing the same `key` twice keeps
 * a single entry — its mode is updated and it's moved to the top of
 * the stack.
 */
export async function pushAudioModeOverride(
  key: string,
  mode: AudioMode,
): Promise<void> {
  const existing = overrideStack.findIndex((e) => e.key === key);
  if (existing >= 0) overrideStack.splice(existing, 1);
  overrideStack.push({ key, mode });
  await applyToNative(mode);
}

/**
 * Remove an override by key and re-apply whatever's now on top of
 * the stack (falling back to the base mode if the stack is empty).
 * No-op if the key isn't on the stack.
 */
export async function popAudioModeOverride(key: string): Promise<void> {
  const idx = overrideStack.findIndex((e) => e.key === key);
  if (idx < 0) return;
  overrideStack.splice(idx, 1);
  await applyToNative(topMode());
}

/** Test-only: drop owner state without touching the native module. */
export function __resetAudioSessionForTests(): void {
  baseMode = null;
  overrideStack.length = 0;
  audioModule = null;
  audioModuleLoadAttempted = false;
}

/**
 * Internal: install (or replace) the resolved audio module that
 * `setAudioModeAsync` calls go through. Production loaders
 * (`lib/skillAudio.ts`, `lib/cognitiveAudio/service.ts`) call this
 * after they `require("expo-audio")` so the owner targets the same
 * native binding the players use. Tests pass a jest mock here.
 *
 * Not strictly private (the module path matters more than the name
 * here) but treat it as an in-package hook, not a public API.
 */
export function setAudioSessionModule(mod: AudioModuleLike | null): void {
  audioModule = mod;
  audioModuleLoadAttempted = true;
}

/** @deprecated Renamed to `setAudioSessionModule`. Kept as an alias
 * so older test imports keep compiling — remove once no callers
 * remain. */
export const __setAudioSessionModuleForTests = setAudioSessionModule;

/** Test-only: introspect the current effective mode. */
export function __getEffectiveAudioModeForTests(): AudioMode | null {
  return topMode();
}
