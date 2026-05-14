import type { Memory } from "@/lib/memories";

/**
 * Pure helpers backing the Archive list (Task #80 / #106).
 *
 * Extracted so the row-building, filter, and per-row sync-status
 * derivations can be unit-tested without booting the Archive screen
 * itself (which pulls in expo-router, fonts, and a stack of animation
 * primitives that don't render under jest). The screen imports these
 * verbatim — keeping the production wiring and the tests pointed at
 * the same code path.
 */

/**
 * A row in the Archive FlatList. The pinned-header row is rendered
 * once at the top of the list when at least one memory is still
 * pending or has failed to sync; the remaining rows are ordinary
 * memory rows in their incoming order.
 */
export type ArchiveRow =
  | { kind: "pinned-header"; id: "pinned-header"; count: number }
  | { kind: "day-header"; id: string; day: ArchiveDayGroup }
  | { kind: "memory"; id: string; memory: Memory; index: number };

export interface ArchiveDayGroup {
  dateKey: string;
  displayDate: string;
  memoryCount: number;
  hasPhoto: boolean;
  hasSelfie: boolean;
  callCount: number;
  pendingSyncCount: number;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function localDayParts(timestamp: string): {
  dateKey: string;
  displayDate: string;
} {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return { dateKey: "unknown-date", displayDate: "Unknown date" };
  }
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  return {
    dateKey: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    displayDate: `${MONTH_NAMES[month]} ${day}, ${year}`,
  };
}

function memoryHasPhoto(memory: Memory): boolean {
  return (
    memory.photoPendingUpload === true ||
    typeof memory.photoUrl === "string" ||
    (Array.isArray(memory.photos) && memory.photos.length > 0)
  );
}

function memoryIsSelfie(memory: Memory): boolean {
  if (typeof memory.dailySelfieDate === "string") return true;
  return (
    Array.isArray(memory.tags) &&
    memory.tags.some(
      (tag) => typeof tag === "string" && tag.toLowerCase() === "daily-selfie",
    )
  );
}

/**
 * Map a memory's outbox-derived flags to the three states the
 * `MemorySyncStatus` indicator renders. Failed wins over pending so a
 * row that has already been tried and is now waiting on backoff
 * surfaces the warning glyph instead of the in-flight spinner.
 */
export function getMemorySyncStatus(
  memory: Memory,
): "synced" | "pending" | "failed" {
  if (memory.syncFailed === true) return "failed";
  if (memory.pendingSync === true) return "pending";
  return "synced";
}

/**
 * True when the memory still owes the server (mid-flight or failed).
 * The pinned section pulls these to the top of the list.
 */
export function isPendingOrFailed(memory: Memory): boolean {
  return memory.pendingSync === true || memory.syncFailed === true;
}

/**
 * Apply the local-only person + date filters that the Archive screen
 * runs after either the in-memory list or the server-side search
 * results. Search itself is server-side via `apiSearchMemories`, so
 * it is not modeled here — callers pass in the post-search list.
 *
 * `personFilter` is a strict, case-insensitive equality match on the
 * `person` annotation. `dateFilter` is a `YYYY-MM-DD` local-day match
 * against each memory's `timestamp`. Both filters compose; either may
 * be null to disable.
 */
export function applyArchiveClientFilters(
  memories: Memory[],
  options: { personFilter: string | null; dateFilter: string | null },
): Memory[] {
  const { personFilter, dateFilter } = options;
  let result = memories;
  if (personFilter) {
    const target = personFilter.toLowerCase();
    result = result.filter(
      (m) => typeof m.person === "string" && m.person.toLowerCase() === target,
    );
  }
  if (dateFilter) {
    result = result.filter((m) => {
      if (typeof m.timestamp !== "string") return false;
      const ts = new Date(m.timestamp);
      if (Number.isNaN(ts.getTime())) return false;
      const yyyy = ts.getFullYear();
      const mm = String(ts.getMonth() + 1).padStart(2, "0");
      const dd = String(ts.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}` === dateFilter;
    });
  }
  return result;
}

/**
 * Split a filtered memory list into the pinned ("Pending sync") group
 * and the timestamp-sorted rest. Order within each group is preserved
 * — callers are expected to sort upstream.
 */
export function splitPinnedMemories(memories: Memory[]): {
  pinned: Memory[];
  rest: Memory[];
} {
  const pinned: Memory[] = [];
  const rest: Memory[] = [];
  for (const m of memories) {
    if (isPendingOrFailed(m)) {
      pinned.push(m);
    } else {
      rest.push(m);
    }
  }
  return { pinned, rest };
}

export function buildArchiveDayGroups(memories: Memory[]): ArchiveDayGroup[] {
  const groups: ArchiveDayGroup[] = [];
  const byKey = new Map<string, ArchiveDayGroup>();
  for (const memory of memories) {
    const { dateKey, displayDate } = localDayParts(memory.timestamp);
    let group = byKey.get(dateKey);
    if (!group) {
      group = {
        dateKey,
        displayDate,
        memoryCount: 0,
        hasPhoto: false,
        hasSelfie: false,
        callCount: 0,
        pendingSyncCount: 0,
      };
      byKey.set(dateKey, group);
      groups.push(group);
    }
    group.memoryCount += 1;
    group.hasPhoto ||= memoryHasPhoto(memory);
    group.hasSelfie ||= memoryIsSelfie(memory);
    if (memory.kind === "call") group.callCount += 1;
    if (isPendingOrFailed(memory)) group.pendingSyncCount += 1;
  }
  return groups;
}

/**
 * Build the discriminated row list rendered by Archive's FlatList.
 *
 * - Emits a `pinned-header` row only when at least one row qualifies
 *   for the pinned section. No empty header, no zero-count slot.
 * - Pinned memory rows use a `pinned:` id prefix so a future filter
 *   surfacing the same memory in both groups (it doesn't today, but
 *   the prefix makes the keyExtractor unambiguous either way) won't
 *   collide on FlatList's keyExtractor and break Animated reorders.
 * - The `index` field on each memory row is its global position in
 *   the list, used by `BreatheCard` to stagger the on-mount animation.
 */
export function buildArchiveRows(filtered: Memory[]): ArchiveRow[] {
  const { pinned, rest } = splitPinnedMemories(filtered);
  const rows: ArchiveRow[] = [];
  if (pinned.length > 0) {
    rows.push({
      kind: "pinned-header",
      id: "pinned-header",
      count: pinned.length,
    });
    pinned.forEach((memory, i) => {
      rows.push({
        kind: "memory",
        id: `pinned:${memory.id}`,
        memory,
        index: i,
      });
    });
  }
  const dayGroups = buildArchiveDayGroups(rest);
  let dayIndex = 0;
  let currentDateKey: string | null = null;
  rest.forEach((memory, i) => {
    const { dateKey } = localDayParts(memory.timestamp);
    if (dateKey !== currentDateKey) {
      const day = dayGroups[dayIndex];
      if (day) {
        rows.push({
          kind: "day-header",
          id: `day:${day.dateKey}`,
          day,
        });
      }
      currentDateKey = dateKey;
      dayIndex += 1;
    }
    rows.push({
      kind: "memory",
      id: memory.id,
      memory,
      index: pinned.length + i,
    });
  });
  return rows;
}
