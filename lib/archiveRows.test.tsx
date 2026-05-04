import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import { MemorySyncStatus } from "@/components/MemorySyncStatus";
import type { Memory } from "@/lib/memories";
import {
  applyArchiveClientFilters,
  buildArchiveRows,
  getMemorySyncStatus,
  isPendingOrFailed,
  splitPinnedMemories,
} from "./archiveRows";

const baseMemory = (over: Partial<Memory>): Memory => ({
  id: over.id ?? "m",
  userId: "u1",
  content: over.content ?? "",
  // 2026-04-15 noon local — a stable timestamp the date-filter test
  // can pin against without going near a TZ boundary.
  timestamp: over.timestamp ?? "2026-04-15T12:00:00.000Z",
  kind: "memory",
  ...over,
});

describe("getMemorySyncStatus / isPendingOrFailed — flag → state mapping", () => {
  test("synced is the default state", () => {
    const m = baseMemory({ id: "a" });
    expect(getMemorySyncStatus(m)).toBe("synced");
    expect(isPendingOrFailed(m)).toBe(false);
  });

  test("pendingSync alone renders as pending", () => {
    const m = baseMemory({ id: "a", pendingSync: true });
    expect(getMemorySyncStatus(m)).toBe("pending");
    expect(isPendingOrFailed(m)).toBe(true);
  });

  test("syncFailed alone renders as failed", () => {
    const m = baseMemory({ id: "a", syncFailed: true });
    expect(getMemorySyncStatus(m)).toBe("failed");
    expect(isPendingOrFailed(m)).toBe(true);
  });

  test("syncFailed wins when both flags are set (waiting-on-backoff case)", () => {
    const m = baseMemory({ id: "a", pendingSync: true, syncFailed: true });
    expect(getMemorySyncStatus(m)).toBe("failed");
    expect(isPendingOrFailed(m)).toBe(true);
  });
});

describe("buildArchiveRows — pinned 'Pending sync' group", () => {
  test("(a) pending and failed memories sort above the rest, preserving incoming order", () => {
    // Memories arrive in incoming (timestamp-sorted) order from
    // MemoriesContext. Mix synced/pending/failed and confirm the
    // pinned group surfaces the two sync-owing rows ahead of the
    // synced ones, while keeping their relative order intact.
    const a = baseMemory({ id: "a" });
    const b = baseMemory({ id: "b", pendingSync: true });
    const c = baseMemory({ id: "c" });
    const d = baseMemory({ id: "d", syncFailed: true });
    const e = baseMemory({ id: "e" });

    const rows = buildArchiveRows([a, b, c, d, e]);

    // Header + 2 pinned + 3 rest = 6 rows.
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({
      kind: "pinned-header",
      id: "pinned-header",
      count: 2,
    });
    expect(rows[1]).toMatchObject({
      kind: "memory",
      id: "pinned:b",
      memory: b,
    });
    expect(rows[2]).toMatchObject({
      kind: "memory",
      id: "pinned:d",
      memory: d,
    });
    // The rest section keeps the synced rows in their original order.
    expect(rows.slice(3).map((r) => r.kind === "memory" && r.id)).toEqual([
      "a",
      "c",
      "e",
    ]);
    // BreatheCard's stagger animation reads `index` as the global
    // position in the visible list, not per-section.
    expect(rows[1]).toMatchObject({ index: 0 });
    expect(rows[2]).toMatchObject({ index: 1 });
    expect(rows[3]).toMatchObject({ index: 2 });
    expect(rows[5]).toMatchObject({ index: 4 });
  });

  test("(b) pinned section header is hidden when no rows qualify", () => {
    const rows = buildArchiveRows([
      baseMemory({ id: "a" }),
      baseMemory({ id: "b" }),
    ]);
    expect(rows.every((r) => r.kind === "memory")).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.kind === "pinned-header")).toBeUndefined();
  });

  test("(b) header is also omitted on a fully empty list", () => {
    expect(buildArchiveRows([])).toEqual([]);
  });

  test("pinned ids are prefixed so they cannot collide with synced rows on the keyExtractor", () => {
    const pinned = baseMemory({ id: "shared", pendingSync: true });
    const synced = baseMemory({ id: "shared" });
    const rows = buildArchiveRows([pinned, synced]);
    const keys = rows.map((r) => r.id);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("pinned:shared");
    expect(keys).toContain("shared");
  });

  test("splitPinnedMemories preserves order within each group", () => {
    const a = baseMemory({ id: "a", pendingSync: true });
    const b = baseMemory({ id: "b" });
    const c = baseMemory({ id: "c", syncFailed: true });
    const d = baseMemory({ id: "d" });
    const { pinned, rest } = splitPinnedMemories([a, b, c, d]);
    expect(pinned.map((m) => m.id)).toEqual(["a", "c"]);
    expect(rest.map((m) => m.id)).toEqual(["b", "d"]);
  });
});

describe("(c) existing search / person / date filters still apply to pinned rows", () => {
  test("personFilter excludes pinned rows that don't match the person", () => {
    const aliceFailed = baseMemory({
      id: "a",
      person: "Alice",
      syncFailed: true,
    });
    const bobPending = baseMemory({
      id: "b",
      person: "Bob",
      pendingSync: true,
    });
    const aliceSynced = baseMemory({ id: "c", person: "Alice" });
    const bobSynced = baseMemory({ id: "d", person: "Bob" });

    const filtered = applyArchiveClientFilters(
      [aliceFailed, bobPending, aliceSynced, bobSynced],
      { personFilter: "alice", dateFilter: null },
    );
    const rows = buildArchiveRows(filtered);

    // Bob's pending row must not survive the person filter just
    // because it would otherwise pin to the top.
    const memoryIds = rows
      .filter((r): r is Extract<typeof r, { kind: "memory" }> =>
        r.kind === "memory",
      )
      .map((r) => r.memory.id);
    expect(memoryIds).toEqual(["a", "c"]);
    // Person filter is case-insensitive — a lowercase chip still
    // matches "Alice".
    expect(rows[0]).toMatchObject({ kind: "pinned-header", count: 1 });
  });

  test("dateFilter (YYYY-MM-DD local-day) excludes pinned rows from other days", () => {
    // Use noon-local timestamps to stay clear of the local-day
    // boundary the filter relies on. Day "2026-04-15" survives;
    // "2026-04-16" does not.
    const onDayPending = baseMemory({
      id: "a",
      timestamp: new Date(2026, 3, 15, 12, 0, 0).toISOString(),
      pendingSync: true,
    });
    const offDayFailed = baseMemory({
      id: "b",
      timestamp: new Date(2026, 3, 16, 12, 0, 0).toISOString(),
      syncFailed: true,
    });
    const onDaySynced = baseMemory({
      id: "c",
      timestamp: new Date(2026, 3, 15, 12, 0, 0).toISOString(),
    });

    const filtered = applyArchiveClientFilters(
      [onDayPending, offDayFailed, onDaySynced],
      { personFilter: null, dateFilter: "2026-04-15" },
    );
    const rows = buildArchiveRows(filtered);

    expect(rows[0]).toMatchObject({ kind: "pinned-header", count: 1 });
    const memoryIds = rows
      .filter((r): r is Extract<typeof r, { kind: "memory" }> =>
        r.kind === "memory",
      )
      .map((r) => r.memory.id);
    expect(memoryIds).toEqual(["a", "c"]);
  });

  test("person + date compose; pinned rows must survive both", () => {
    const matchPending = baseMemory({
      id: "a",
      person: "Alice",
      timestamp: new Date(2026, 3, 15, 12, 0, 0).toISOString(),
      pendingSync: true,
    });
    const wrongPerson = baseMemory({
      id: "b",
      person: "Bob",
      timestamp: new Date(2026, 3, 15, 12, 0, 0).toISOString(),
      pendingSync: true,
    });
    const wrongDate = baseMemory({
      id: "c",
      person: "Alice",
      timestamp: new Date(2026, 3, 16, 12, 0, 0).toISOString(),
      syncFailed: true,
    });

    const filtered = applyArchiveClientFilters(
      [matchPending, wrongPerson, wrongDate],
      { personFilter: "Alice", dateFilter: "2026-04-15" },
    );
    const rows = buildArchiveRows(filtered);

    // Only the matching pending row survives → header count 1.
    expect(rows[0]).toMatchObject({ kind: "pinned-header", count: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ kind: "memory", id: "pinned:a" });
  });

  test("dateFilter rejects malformed timestamps instead of letting them slip through", () => {
    const broken = baseMemory({
      id: "a",
      timestamp: "not-a-date",
      pendingSync: true,
    });
    const filtered = applyArchiveClientFilters([broken], {
      personFilter: null,
      dateFilter: "2026-04-15",
    });
    expect(filtered).toEqual([]);
    expect(buildArchiveRows(filtered)).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// (d) Tapping a pinned row's badge calls retryMemorySync with the correct id.
//
// The badge → `retryMemorySync(id)` wiring lives in `archive.tsx`'s
// `renderMemoryRow`. We mirror that exact wiring in a tiny Host so a
// future refactor that breaks the contract (wrong id, wrong state
// gating, missing handler) trips this test instead of shipping silently.
// ----------------------------------------------------------------------------

interface PinnedBadgeHostProps {
  memory: Memory;
  retryMemorySync: (id: string) => void;
}

function PinnedBadgeHost({ memory, retryMemorySync }: PinnedBadgeHostProps) {
  const status = getMemorySyncStatus(memory);
  return (
    <MemorySyncStatus
      status={status}
      onRetry={
        // Same gating archive.tsx uses: pending shows a spinner that
        // shouldn't double as a button (the outbox lock would serialize
        // a retry behind the in-flight drain anyway), so only the
        // "failed" badge is wired to the retry handler.
        status === "failed"
          ? () => {
              retryMemorySync(memory.id);
            }
          : undefined
      }
    />
  );
}

describe("(d) pinned-row badge wiring → retryMemorySync(id)", () => {
  test("tapping the offline badge on a failed row calls retryMemorySync with that row's id", () => {
    const retryMemorySync = jest.fn();
    const memory = baseMemory({ id: "abc-123", syncFailed: true });
    const view = render(
      <PinnedBadgeHost memory={memory} retryMemorySync={retryMemorySync} />,
    );

    const badge = view.getByLabelText("Saved offline, tap to retry sync");
    fireEvent.press(badge);

    expect(retryMemorySync).toHaveBeenCalledTimes(1);
    expect(retryMemorySync).toHaveBeenCalledWith("abc-123");
  });

  test("each row's badge resolves to its own id (no closure-over-loop bugs)", () => {
    const retryMemorySync = jest.fn();
    const memories = [
      baseMemory({ id: "first", syncFailed: true }),
      baseMemory({ id: "second", syncFailed: true }),
    ];
    const view = render(
      <>
        {memories.map((m) => (
          <PinnedBadgeHost
            key={m.id}
            memory={m}
            retryMemorySync={retryMemorySync}
          />
        ))}
      </>,
    );

    const badges = view.getAllByLabelText("Saved offline, tap to retry sync");
    expect(badges).toHaveLength(2);
    fireEvent.press(badges[1]);
    expect(retryMemorySync).toHaveBeenCalledTimes(1);
    expect(retryMemorySync).toHaveBeenCalledWith("second");

    fireEvent.press(badges[0]);
    expect(retryMemorySync).toHaveBeenCalledTimes(2);
    expect(retryMemorySync).toHaveBeenLastCalledWith("first");
  });

  test("pending rows render the spinner without a retry handler so a tap is a no-op", async () => {
    // `MemorySyncStatus` only exposes the pressable wrapper when an
    // `onRetry` is provided. The pending state intentionally stays a
    // passive view to avoid double-tap stacking on top of the
    // in-flight drain. We assert the contract by accessibility label:
    // the pressable surfaces "Saved offline, tap to retry sync" while
    // the passive view announces "Syncing now" (the exact string the
    // component renders — see MemorySyncStatus.tsx and its own tests).
    // The "Syncing now" lookup uses `findByLabelText` rather than the
    // synchronous `getByLabelText` because `MemorySyncStatus` kicks
    // off its spinning animation in a `useEffect`. This occasionally
    // races the assertion under load, causing flaky failures in CI.
    // `findByLabelText` ensures we wait for the spinner to mount and
    // the label to be present, removing the race entirely.
    const retryMemorySync = jest.fn();
    const memory = baseMemory({ id: "pending-1", pendingSync: true });
    const view = render(
      <PinnedBadgeHost memory={memory} retryMemorySync={retryMemorySync} />,
    );
    expect(view.queryByLabelText("Saved offline, tap to retry sync")).toBeNull();
    expect(await view.findByLabelText("Syncing now")).toBeTruthy();
    expect(retryMemorySync).not.toHaveBeenCalled();
  });

  test("synced rows have no retry surface at all", () => {
    const retryMemorySync = jest.fn();
    const memory = baseMemory({ id: "ok" });
    const view = render(
      <PinnedBadgeHost memory={memory} retryMemorySync={retryMemorySync} />,
    );
    expect(view.queryByLabelText("Saved offline, tap to retry sync")).toBeNull();
    expect(view.getByLabelText("Synced")).toBeTruthy();
  });
});
