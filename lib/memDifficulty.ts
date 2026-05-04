/**
 * Per-game persistence for the player's chosen Mem difficulty
 * (Task #330). Stored in AsyncStorage under one shared key with two
 * independent buckets — one per game — so picking Hard on Memory
 * Match doesn't change the 24 Game default.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { MemDifficulty } from "./memOpponent";

export type DifficultyGame = "memoryMatch" | "game24";

const STORAGE_KEY = "mt_mem_difficulty_v1";

interface DifficultyMap {
  memoryMatch: MemDifficulty;
  game24: MemDifficulty;
}

const DEFAULTS: DifficultyMap = {
  memoryMatch: "normal",
  game24: "normal",
};

const VALID: readonly MemDifficulty[] = ["easy", "normal", "hard"];

function coerce(value: unknown): MemDifficulty | null {
  return typeof value === "string" && (VALID as readonly string[]).includes(value)
    ? (value as MemDifficulty)
    : null;
}

async function readMap(): Promise<DifficultyMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<DifficultyGame, unknown>>;
    return {
      memoryMatch: coerce(parsed.memoryMatch) ?? DEFAULTS.memoryMatch,
      game24: coerce(parsed.game24) ?? DEFAULTS.game24,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function loadMemDifficulty(
  game: DifficultyGame,
): Promise<MemDifficulty> {
  const map = await readMap();
  return map[game];
}

export async function saveMemDifficulty(
  game: DifficultyGame,
  difficulty: MemDifficulty,
): Promise<void> {
  const map = await readMap();
  if (map[game] === difficulty) return;
  map[game] = difficulty;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Best-effort: a write failure just means the next launch falls
    // back to the previous selection, which is harmless.
  }
}
