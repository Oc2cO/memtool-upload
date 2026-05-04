/**
 * Tracks which level-ladder milestones the player has already seen
 * the celebration toast for. Stored in AsyncStorage so the toast
 * never re-fires on re-runs of the same milestone level.
 *
 * Two independent buckets — one per game — so clearing level 5 on
 * Memory Match doesn't suppress the celebration on the 24 Game.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type MilestoneGame = "memoryMatch" | "game24";

const STORAGE_KEY = "mt_milestones_seen_v1";

interface SeenMap {
  memoryMatch: number[];
  game24: number[];
}

async function readMap(): Promise<SeenMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { memoryMatch: [], game24: [] };
    const parsed = JSON.parse(raw) as Partial<SeenMap>;
    return {
      memoryMatch: Array.isArray(parsed.memoryMatch) ? parsed.memoryMatch : [],
      game24: Array.isArray(parsed.game24) ? parsed.game24 : [],
    };
  } catch {
    return { memoryMatch: [], game24: [] };
  }
}

export async function hasSeenMilestone(
  game: MilestoneGame,
  level: number,
): Promise<boolean> {
  const map = await readMap();
  return map[game].includes(level);
}

export async function markMilestoneSeen(
  game: MilestoneGame,
  level: number,
): Promise<void> {
  const map = await readMap();
  if (map[game].includes(level)) return;
  map[game] = [...map[game], level];
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Best-effort: a write failure just means the celebration may
    // re-fire next time, which is harmless.
  }
}
