import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAuth } from "./AuthContext";
import {
  apiCreateMood,
  apiListMood,
  newClientId,
  todayLocalDate,
  type MoodLog,
} from "@/lib/mood";

export type { MoodLog } from "@/lib/mood";

interface MoodContextType {
  history: MoodLog[];
  todayLog: MoodLog | null;
  setRating: (rating: number) => Promise<void>;
  setStress: (stress: number) => Promise<void>;
  setNote: (note: string) => Promise<void>;
  refreshHistory: () => Promise<void>;
  isLoading: boolean;
}

const MoodContext = createContext<MoodContextType | null>(null);

const cacheKey = (email: string) => `mood_history_${email}`;

function sortByDateDesc(list: MoodLog[]): MoodLog[] {
  return [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function dedupeByDate(list: MoodLog[]): MoodLog[] {
  const byDate = new Map<string, MoodLog>();
  for (const log of list) {
    const existing = byDate.get(log.date);
    if (!existing) {
      byDate.set(log.date, log);
    } else {
      // Prefer the entry with a serverId; otherwise merge fields.
      byDate.set(log.date, {
        ...existing,
        ...log,
        serverId: log.serverId ?? existing.serverId,
        client_id: existing.client_id || log.client_id,
        pendingSync: log.pendingSync ?? existing.pendingSync,
      });
    }
  }
  return sortByDateDesc(Array.from(byDate.values()));
}

async function readCache(email: string): Promise<MoodLog[]> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(email));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<MoodLog>[];
    if (!Array.isArray(parsed)) return [];
    // Backfill client_id for entries written by the previous (pre-sync)
    // implementation that didn't have one.
    return parsed
      .filter((m): m is Partial<MoodLog> & { date: string } => typeof m?.date === "string")
      .map((m) => ({
        date: m.date,
        rating: typeof m.rating === "number" ? m.rating : 0,
        stress: typeof m.stress === "number" ? m.stress : undefined,
        note: typeof m.note === "string" ? m.note : undefined,
        client_id: typeof m.client_id === "string" && m.client_id ? m.client_id : newClientId(),
        serverId: typeof m.serverId === "string" ? m.serverId : undefined,
        pendingSync: m.pendingSync ? true : undefined,
      }));
  } catch {
    return [];
  }
}

async function writeCache(email: string, list: MoodLog[]): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(email), JSON.stringify(list));
  } catch {
    // ignore
  }
}

/**
 * Best-effort flush of any locally cached entries that still have
 * `pendingSync: true`. Returns the same list with `pendingSync` cleared
 * (and `serverId` updated) on entries we successfully upserted. Failures
 * are kept as-is so the next refresh / online write tries again.
 */
async function replayPending(cached: MoodLog[]): Promise<MoodLog[]> {
  const out: MoodLog[] = [];
  for (const entry of cached) {
    if (!entry.pendingSync) {
      out.push(entry);
      continue;
    }
    try {
      const res = await apiCreateMood({
        date: entry.date,
        rating: entry.rating,
        stress: entry.stress,
        note: entry.note,
        client_id: entry.client_id,
      });
      out.push({
        ...entry,
        pendingSync: undefined,
        serverId: res?.server_id ?? entry.serverId,
      });
    } catch {
      out.push(entry);
    }
  }
  return out;
}

export function MoodProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [history, setHistory] = useState<MoodLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      setHistory([]);
      setIsLoading(false);
      return;
    }
    const email = user.email;
    setIsLoading(true);

    // Replay any still-pending offline writes BEFORE fetching the
    // server list, so we don't drop unsynced local entries when merging.
    const cached = await readCache(email);
    const replayed = await replayPending(cached);
    if (replayed.some((r, i) => r !== cached[i])) {
      await writeCache(email, replayed);
    }

    try {
      const fromApi = await apiListMood();
      // Pending local writes (offline / failed sync) are the source of
      // truth for their date and must never be overwritten by a stale
      // server row for the same date. Drop any server row whose date has
      // a pending local entry, then merge.
      const pendingDates = new Set(
        replayed.filter((c) => c.pendingSync).map((c) => c.date),
      );
      const pending = replayed.filter((c) => c.pendingSync);
      const apiKept = fromApi.filter((s) => !pendingDates.has(s.date));
      const merged = dedupeByDate([...apiKept, ...pending]);
      setHistory(merged);
      await writeCache(email, merged);
    } catch (err) {
      console.warn("[mood] API list failed, falling back to cache", err);
      setHistory(dedupeByDate(replayed));
    } finally {
      setIsLoading(false);
    }
  }, [user, authLoading]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const upsertToday = useCallback(
    async (updates: Partial<Pick<MoodLog, "rating" | "stress" | "note">>) => {
      if (!user) return;
      const email = user.email;
      const today = todayLocalDate();

      // Find or create today's entry, preserving stable client_id.
      const existing = history.find((h) => h.date === today);
      const merged: MoodLog = existing
        ? { ...existing, ...updates }
        : {
            date: today,
            rating: 0,
            ...updates,
            client_id: newClientId(),
          };
      // Clear any stale pendingSync flag — we're about to retry.
      merged.pendingSync = undefined;

      const next = dedupeByDate([
        merged,
        ...history.filter((h) => h.date !== today),
      ]);
      setHistory(next);
      await writeCache(email, next);

      try {
        const res = await apiCreateMood({
          date: merged.date,
          rating: merged.rating,
          stress: merged.stress,
          note: merged.note,
          client_id: merged.client_id,
        });
        // authFetch throws on non-2xx, so reaching here means the upsert
        // landed on the server. Clear pendingSync unconditionally and
        // pick up server_id when the API surfaces one.
        const afterToday = next.map((h) =>
          h.date === today
            ? {
                ...h,
                pendingSync: undefined,
                serverId: res?.server_id ?? h.serverId,
              }
            : h,
        );
        // Network is clearly back — opportunistically flush any other
        // mood entries that were stuck pending from previous offline
        // sessions, so users don't have to wait for the next refresh.
        const flushed = await replayPending(afterToday);
        const deduped = dedupeByDate(flushed);
        setHistory(deduped);
        await writeCache(email, deduped);
      } catch (err) {
        console.warn("[mood] sync failed, kept locally", err);
        const flagged = next.map((h) =>
          h.date === today ? { ...h, pendingSync: true } : h,
        );
        setHistory(flagged);
        await writeCache(email, flagged);
      }
    },
    [user, history],
  );

  const setRating = useCallback((rating: number) => upsertToday({ rating }), [upsertToday]);
  const setStress = useCallback((stress: number) => upsertToday({ stress }), [upsertToday]);
  const setNote = useCallback((note: string) => upsertToday({ note }), [upsertToday]);

  const todayLog = history.find((h) => h.date === todayLocalDate()) || null;

  return (
    <MoodContext.Provider
      value={{
        history,
        todayLog,
        setRating,
        setStress,
        setNote,
        refreshHistory: loadHistory,
        isLoading,
      }}
    >
      {children}
    </MoodContext.Provider>
  );
}

export const useMood = () => {
  const ctx = useContext(MoodContext);
  if (!ctx) throw new Error("useMood must be used within MoodProvider");
  return ctx;
};
