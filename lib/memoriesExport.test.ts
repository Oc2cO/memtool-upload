/**
 * Schema-lock tests for the memory export builders.
 *
 * Users build spreadsheets and scripts on top of these exports, so the
 * top-level shape, header row, JSON key set, ordering, and
 * null/undefined → empty-cell behaviour MUST only change intentionally.
 * These tests are the tripwire: a renamed column, a dropped key, or a
 * regressed empty-field handler will fail here before it ships.
 *
 * Cached-export coverage lives here too: the share-sheet warning is
 * gone the moment the file leaves the share dialog, so the file
 * itself has to carry the "older memories may be missing" note (JSON
 * `_export_metadata.note`, CSV leading `#` comment row). The wording
 * is centralised in `exportCacheWarning.ts` and we assert on that
 * source of truth so the share-sheet title and the in-file note
 * cannot drift.
 */

import { CACHED_COPY_SHARE_TITLE } from "./exportCachePrompt";
import {
  CACHED_EXPORT_WARNING_BODY,
  buildCachedExportFileNote,
} from "./exportCacheWarning";
import { buildCsvExport, buildJsonExport } from "./memoriesExport";
import type { Memory } from "./memories";

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "client-1",
    userId: "user-1",
    content: "Coffee with Sam",
    timestamp: "2026-04-30T10:00:00.000Z",
    kind: "memory",
    ...overrides,
  };
}

const FIXED_EXPORTED_AT = "2026-04-30T12:34:56.000Z";

describe("buildJsonExport", () => {
  it("wraps memories under `_export_metadata` + `memories` at the top level", () => {
    const json = buildJsonExport([makeMemory()], {
      exportedAt: FIXED_EXPORTED_AT,
    });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    // Top-level shape is locked: any new key needs an explicit test
    // update so downstream importers don't silently break.
    expect(Object.keys(parsed)).toEqual(["_export_metadata", "memories"]);
    expect(Array.isArray(parsed.memories)).toBe(true);
  });

  it("freezes the key set and order on every memory row", () => {
    const json = buildJsonExport([makeMemory()], {
      exportedAt: FIXED_EXPORTED_AT,
    });
    const parsed = JSON.parse(json) as { memories: Array<Record<string, unknown>> };
    expect(Object.keys(parsed.memories[0])).toEqual([
      "id",
      "client_id",
      "server_id",
      "kind",
      "body",
      "tags",
      "mood",
      "is_starred",
      "location",
      "person",
      "linked_event_id",
      "created_at",
      "updated_at",
    ]);
  });

  it("maps client + server fields onto the documented schema", () => {
    const json = buildJsonExport(
      [
        makeMemory({
          id: "client-abc",
          serverId: "srv-123",
          content: "Body text",
          tags: ["work", "deep"],
          mood: "calm",
          isStarred: true,
          person: "Sam",
          linkedEventId: "evt-9",
          kind: "call",
          timestamp: "2026-04-30T10:00:00.000Z",
        }),
      ],
      { exportedAt: FIXED_EXPORTED_AT },
    );
    const parsed = JSON.parse(json) as { memories: Array<Record<string, unknown>> };
    expect(parsed.memories[0]).toEqual({
      id: "client-abc",
      client_id: "client-abc",
      server_id: "srv-123",
      kind: "call",
      body: "Body text",
      tags: ["work", "deep"],
      mood: "calm",
      is_starred: true,
      location: null,
      person: "Sam",
      linked_event_id: "evt-9",
      created_at: "2026-04-30T10:00:00.000Z",
      updated_at: "2026-04-30T10:00:00.000Z",
    });
  });

  it("renders missing optional fields as null / [] / false (never undefined)", () => {
    const json = buildJsonExport([makeMemory()], {
      exportedAt: FIXED_EXPORTED_AT,
    });
    const parsed = JSON.parse(json) as { memories: Array<Record<string, unknown>> };
    const row = parsed.memories[0];
    expect(row.server_id).toBeNull();
    expect(row.tags).toEqual([]);
    expect(row.mood).toBeNull();
    expect(row.is_starred).toBe(false);
    expect(row.location).toBeNull();
    expect(row.person).toBeNull();
    expect(row.linked_event_id).toBeNull();
    // No key should ever serialise as the string "undefined".
    expect(json).not.toMatch(/"undefined"/);
  });

  it("returns the wrapper object with an empty memories array when there are no memories", () => {
    const json = buildJsonExport([], { exportedAt: FIXED_EXPORTED_AT });
    const parsed = JSON.parse(json) as { memories: unknown[] };
    expect(parsed.memories).toEqual([]);
  });

  describe("_export_metadata", () => {
    it("defaults to `cached: false` and omits the `note` field for fresh server data", () => {
      const json = buildJsonExport([makeMemory()], {
        exportedAt: FIXED_EXPORTED_AT,
      });
      const parsed = JSON.parse(json) as {
        _export_metadata: Record<string, unknown>;
      };
      expect(parsed._export_metadata).toEqual({
        cached: false,
        exported_at: FIXED_EXPORTED_AT,
      });
      // Absence of `note` is a positive "this export is complete"
      // signal; downstream tooling can branch on it.
      expect(parsed._export_metadata).not.toHaveProperty("note");
    });

    it("emits `cached: true` and a human-readable `note` when usedCache is true", () => {
      const json = buildJsonExport([makeMemory()], {
        usedCache: true,
        exportedAt: FIXED_EXPORTED_AT,
      });
      const parsed = JSON.parse(json) as {
        _export_metadata: { cached: boolean; exported_at: string; note: string };
      };
      expect(parsed._export_metadata.cached).toBe(true);
      expect(parsed._export_metadata.exported_at).toBe(FIXED_EXPORTED_AT);
      // Sourced from the centralised builder so the wording cannot
      // drift away from the share-sheet title.
      expect(parsed._export_metadata.note).toBe(
        buildCachedExportFileNote(FIXED_EXPORTED_AT),
      );
      expect(parsed._export_metadata.note).toContain(CACHED_EXPORT_WARNING_BODY);
    });

    it("defaults `exported_at` to the current ISO-8601 timestamp when not supplied", () => {
      const before = Date.now();
      const json = buildJsonExport([]);
      const after = Date.now();
      const parsed = JSON.parse(json) as {
        _export_metadata: { exported_at: string };
      };
      // Round-trip the default through Date so we can sanity-check
      // it without freezing the clock — the only contract we care
      // about is "ISO-8601, generated now".
      const ts = Date.parse(parsed._export_metadata.exported_at);
      expect(Number.isFinite(ts)).toBe(true);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });
});

describe("buildCsvExport", () => {
  it("freezes the header row order", () => {
    const csv = buildCsvExport([], { exportedAt: FIXED_EXPORTED_AT });
    expect(csv).toBe("created_at,kind,body,tags,person,is_starred,mood");
  });

  it("emits one CRLF-separated row per memory in the documented column order", () => {
    const csv = buildCsvExport(
      [
        makeMemory({
          timestamp: "2026-04-30T10:00:00.000Z",
          kind: "memory",
          content: "Hello",
          tags: ["a", "b"],
          person: "Sam",
          isStarred: true,
          mood: "calm",
        }),
      ],
      { exportedAt: FIXED_EXPORTED_AT },
    );
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      "2026-04-30T10:00:00.000Z,memory,Hello,a;b,Sam,true,calm",
    );
  });

  it("renders missing fields as empty cells, never the literal 'undefined' or 'null'", () => {
    const csv = buildCsvExport([makeMemory({ content: "x" })], {
      exportedAt: FIXED_EXPORTED_AT,
    });
    const [, dataRow] = csv.split("\r\n");
    // created_at, kind, body, tags, person, is_starred, mood
    // Only created_at, kind, body have values; the rest are empty cells.
    expect(dataRow).toBe("2026-04-30T10:00:00.000Z,memory,x,,,,");
    expect(csv).not.toMatch(/\bundefined\b/);
    expect(csv).not.toMatch(/(^|,)null(,|$)/m);
  });

  it("round-trips boolean is_starred as the strings 'true' / 'false'", () => {
    const csv = buildCsvExport(
      [
        makeMemory({ id: "a", isStarred: true }),
        makeMemory({ id: "b", isStarred: false }),
      ],
      { exportedAt: FIXED_EXPORTED_AT },
    );
    const rows = csv.split("\r\n").slice(1);
    // Column index 5 is is_starred.
    expect(rows[0].split(",")[5]).toBe("true");
    expect(rows[1].split(",")[5]).toBe("false");
  });

  it("leaves is_starred as an empty cell when the field is undefined", () => {
    const csv = buildCsvExport([makeMemory()], {
      exportedAt: FIXED_EXPORTED_AT,
    });
    const [, dataRow] = csv.split("\r\n");
    expect(dataRow.split(",")[5]).toBe("");
  });

  it("escapes commas by quoting the field", () => {
    const csv = buildCsvExport([makeMemory({ content: "hello, world" })], {
      exportedAt: FIXED_EXPORTED_AT,
    });
    const [, dataRow] = csv.split("\r\n");
    expect(dataRow).toContain('"hello, world"');
  });

  it("escapes embedded double-quotes by doubling them inside a quoted field", () => {
    const csv = buildCsvExport([makeMemory({ content: 'she said "hi"' })], {
      exportedAt: FIXED_EXPORTED_AT,
    });
    const [, dataRow] = csv.split("\r\n");
    expect(dataRow).toContain('"she said ""hi"""');
  });

  it("preserves embedded newlines inside a quoted field (RFC 4180)", () => {
    const csv = buildCsvExport(
      [makeMemory({ content: "line one\nline two" })],
      { exportedAt: FIXED_EXPORTED_AT },
    );
    // A naive split on \r\n would split the body in half; keeping it
    // inside the quoted cell is the whole point of RFC-4180 escaping.
    expect(csv).toContain('"line one\nline two"');
    // Header + one data row even though the body has a newline.
    const headerEnd = csv.indexOf("\r\n");
    expect(headerEnd).toBeGreaterThan(0);
    // No second \r\n separator should appear (only one data row).
    expect(csv.indexOf("\r\n", headerEnd + 2)).toBe(-1);
  });

  it("escapes an embedded carriage return the same way as a newline", () => {
    const csv = buildCsvExport([makeMemory({ content: "line\rone" })], {
      exportedAt: FIXED_EXPORTED_AT,
    });
    expect(csv).toContain('"line\rone"');
  });

  it("does not double-quote a plain field that has no special characters", () => {
    const csv = buildCsvExport([makeMemory({ content: "plain" })], {
      exportedAt: FIXED_EXPORTED_AT,
    });
    const [, dataRow] = csv.split("\r\n");
    expect(dataRow.split(",")[2]).toBe("plain");
  });

  describe("cached-export warning", () => {
    it("does NOT prepend a comment row when usedCache is false (or omitted)", () => {
      const csv = buildCsvExport([makeMemory()], {
        exportedAt: FIXED_EXPORTED_AT,
      });
      const firstLine = csv.split("\r\n")[0];
      // Must start straight at the schema-locked header row — adding
      // a leading note unconditionally would break every existing
      // spreadsheet importer pointed at fresh exports.
      expect(firstLine).toBe("created_at,kind,body,tags,person,is_starred,mood");
      expect(csv).not.toMatch(/^#/);
    });

    it("prepends a `# Cached export — ...` comment row carrying the centralised warning when usedCache is true", () => {
      const csv = buildCsvExport([makeMemory()], {
        usedCache: true,
        exportedAt: FIXED_EXPORTED_AT,
      });
      const lines = csv.split("\r\n");
      // Order is locked: comment row → header row → data rows.
      expect(lines[0]).toBe(`# ${buildCachedExportFileNote(FIXED_EXPORTED_AT)}`);
      expect(lines[1]).toBe(
        "created_at,kind,body,tags,person,is_starred,mood",
      );
      expect(lines).toHaveLength(3);
      // The wording must match the share-sheet title's tail so a
      // recipient comparing the two sees the same message.
      expect(lines[0]).toContain(CACHED_EXPORT_WARNING_BODY);
      expect(lines[0]).toContain(FIXED_EXPORTED_AT);
    });
  });
});

describe("centralised cached-export warning copy", () => {
  // Tripwire: if anyone edits the share-sheet title or the in-file
  // note independently, this test fails and forces them back into
  // exportCacheWarning.ts.
  it("share-sheet title shares its tail with the in-file note", () => {
    expect(CACHED_COPY_SHARE_TITLE).toContain(CACHED_EXPORT_WARNING_BODY);
    expect(buildCachedExportFileNote(FIXED_EXPORTED_AT)).toContain(
      CACHED_EXPORT_WARNING_BODY,
    );
  });
});
