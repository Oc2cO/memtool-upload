import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ChatMessage } from "@/components/ChatThread";
import type { MemMood } from "./aiGuide";

/**
 * Per-user AsyncStorage thread for the AI Guide chat.
 *
 * There's no server history endpoint yet (per task brief), so the
 * thread lives locally, keyed by user id, and survives app restart.
 *
 * If the JSON is missing or corrupt we always return an empty
 * thread (NEVER undefined) so the screen can unconditionally render
 * the warm intro. Per-user keying prevents account swaps from
 * showing the previous user's messages.
 *
 * StoredAiGuideMessage extends ChatMessage with an optional
 * `accentMood` so the latest Mem reply's mood tint can survive a
 * restart without a re-fetch (no server history to recover from).
 * `accentMood` is intentionally `string` rather than `MemMood` so
 * the persisted shape is forward-compatible if Polsia adds a new
 * mood literal — `normalizeMood` collapses unknown values back to
 * "neutral" at read time in the screen.
 */

const THREAD_KEY_PREFIX = "mt_ai_guide_thread_v1:";

export interface StoredAiGuideMessage extends ChatMessage {
  /** Mood the server returned with this Mem reply, if any. Only set on `mem` rows. */
  accentMood?: MemMood | string;
}

function keyFor(userId: string): string {
  return `${THREAD_KEY_PREFIX}${userId}`;
}

/** Load (and validate) the thread for a user. Always returns an array. */
export async function loadAiGuideThread(
  userId: string,
): Promise<StoredAiGuideMessage[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: StoredAiGuideMessage[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { text?: unknown }).text === "string" &&
        ((item as { role?: unknown }).role === "mem" ||
          (item as { role?: unknown }).role === "user")
      ) {
        const i = item as {
          id: string;
          text: string;
          role: "mem" | "user";
          accentMood?: unknown;
        };
        const msg: StoredAiGuideMessage = {
          id: i.id,
          role: i.role,
          text: i.text,
        };
        if (typeof i.accentMood === "string") {
          msg.accentMood = i.accentMood;
        }
        out.push(msg);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Persist the thread. Best-effort; swallows storage failures. */
export async function saveAiGuideThread(
  userId: string,
  thread: readonly StoredAiGuideMessage[],
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(thread));
  } catch {
    // best-effort
  }
}

/** Wipe the thread for a user (used by the "Clear conversation" header action). */
export async function clearAiGuideThread(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // ignore
  }
}
